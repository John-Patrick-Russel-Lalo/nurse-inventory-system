import { db } from "@/lib/db";
import { lastDayOfMonth, monthOf, previousMonth } from "@/lib/dates";
import type { ClosedMonth, CountRow, MonthEndResponse, MonthsResponse } from "@/lib/api-types";
import { audit, serverMonth, type Ctx } from "./context";
import { ApiError } from "./http";
import { balancesAtMonthEnd } from "./inventory";

/** The month an admin would normally close: last month. */
export function suggestedMonth(today: string): string {
  return previousMonth(monthOf(today));
}

export async function listMonths(ctx: Ctx): Promise<MonthsResponse> {
  const rows = await db.closedMonth.findMany({
    orderBy: { month: "desc" },
    include: { closedBy: { select: { name: true } } },
  });
  const closed: ClosedMonth[] = rows.map((r) => ({
    month: r.month,
    closedAt: r.closedAt.toISOString(),
    closedByName: r.closedBy.name,
  }));
  return { today: ctx.today, closed, suggest: suggestedMonth(ctx.today) };
}

/**
 * The counting sheet for one month: every active item with the system balance at that
 * month's end and whatever count has been entered for it.
 */
export async function monthEndSheet(ctx: Ctx, rawMonth: string): Promise<MonthEndResponse> {
  const month = serverMonth(rawMonth);
  const closed = await db.closedMonth.findUnique({ where: { month } });

  const [items, saved, system] = await Promise.all([
    db.item.findMany({ where: { active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.monthClosing.findMany({ where: { month } }),
    balancesAtMonthEnd(month),
  ]);

  const savedBy = new Map(saved.map((s) => [s.itemId, s]));
  const counts: CountRow[] = items.map((item) => {
    const systemQty = system.get(item.id) ?? 0;
    const row = savedBy.get(item.id);
    return {
      itemId: item.id,
      itemName: item.name,
      variant: item.variant,
      unit: item.unit,
      category: item.category,
      system: systemQty,
      counted: row ? row.counted : null,
      difference: row ? row.counted - systemQty : null,
    };
  });

  const counted = counts.filter((c) => c.counted !== null);
  return {
    month,
    closed: !!closed,
    closedAt: closed ? closed.closedAt.toISOString() : null,
    counts,
    summary: {
      items: counts.length,
      counted: counted.length,
      varianceUnits: counted.reduce((s, c) => s + (c.difference ?? 0), 0),
    },
  };
}

/** Saves the physical counts. Either role may count; only an admin can close the month. */
export async function saveCounts(ctx: Ctx, month: string, counts: { itemId: string; counted: number }[]) {
  serverMonth(month);
  if (ctx.closed.has(month)) {
    throw ApiError.conflict(`${month} is closed. An admin must reopen it first.`, "MONTH_CLOSED");
  }
  if (counts.length === 0) throw ApiError.badRequest("There is nothing to save.");

  const known = new Set((await db.item.findMany({ where: { id: { in: counts.map((c) => c.itemId) } } })).map((i) => i.id));
  for (const c of counts) {
    if (!known.has(c.itemId)) throw ApiError.badRequest(`No item with ID "${c.itemId}".`);
    if (!Number.isInteger(c.counted) || c.counted < 0) {
      throw ApiError.badRequest(`Count for ${c.itemId} must be zero or more.`);
    }
  }

  // The system side is frozen at the moment of save, so the difference stays meaningful
  // even if entries are added before the month is closed.
  const system = await balancesAtMonthEnd(month);
  await db.$transaction(async (tx) => {
    for (const c of counts) {
      const systemQty = system.get(c.itemId) ?? 0;
      await tx.monthClosing.upsert({
        where: { month_itemId: { month, itemId: c.itemId } },
        update: { counted: c.counted, system: systemQty, difference: c.counted - systemQty },
        create: { month, itemId: c.itemId, counted: c.counted, system: systemQty, difference: c.counted - systemQty },
      });
    }
    await audit(tx, ctx, "month.count", "month", month, { saved: counts.length });
  });

  return monthEndSheet(ctx, month);
}

/** Closes a month. Every active item must have a count first, otherwise the month is not a count. */
export async function closeMonth(ctx: Ctx, rawMonth: string) {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can close a month.");
  const month = serverMonth(rawMonth);
  if (ctx.closed.has(month)) throw ApiError.conflict(`${month} is already closed.`, "MONTH_CLOSED");

  const current = monthOf(ctx.today);
  if (month >= current) {
    throw ApiError.conflict(`${month} has not finished yet. Close it after it ends.`, "MONTH_NOT_ENDED");
  }

  const sheet = await monthEndSheet(ctx, month);
  const uncounted = sheet.counts.filter((c) => c.counted === null);
  if (uncounted.length > 0) {
    throw ApiError.conflict(
      `${uncounted.length} of ${sheet.counts.length} items still need a count: ` +
        uncounted.slice(0, 5).map((c) => c.itemId).join(", ") +
        (uncounted.length > 5 ? "…" : ""),
      "COUNT_INCOMPLETE",
    );
  }

  const lastDay = lastDayOfMonth(month);
  await db.$transaction(async (tx) => {
    await tx.closedMonth.create({ data: { month, closedById: ctx.user.id } });
    await audit(tx, ctx, "month.close", "month", month, {
      asOf: lastDay,
      items: sheet.counts.length,
      varianceUnits: sheet.summary.varianceUnits,
    });
  });
  return monthEndSheet(ctx, month);
}

/** Reopens a month: the closing rows go and the reason is kept in the audit log. */
export async function reopenMonth(ctx: Ctx, rawMonth: string, reason: string) {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can reopen a month.");
  const month = serverMonth(rawMonth);
  if (!ctx.closed.has(month)) throw ApiError.conflict(`${month} is not closed.`, "MONTH_OPEN");

  const trimmed = reason.trim();
  if (trimmed.length < 3) throw ApiError.badRequest("Give a reason for reopening.");

  await db.$transaction(async (tx) => {
    await tx.monthClosing.deleteMany({ where: { month } });
    await tx.closedMonth.delete({ where: { month } });
    await audit(tx, ctx, "month.reopen", "month", month, { reason: trimmed });
  });
  return monthEndSheet(ctx, month);
}

export interface AuditQuery {
  action?: string;
  entity?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export async function listAudit(query: AuditQuery) {
  const where = {
    ...(query.action && query.action !== "ALL" ? { action: query.action } : {}),
    ...(query.entity && query.entity !== "ALL" ? { entity: query.entity } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
  };
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      take: limit,
      skip: offset,
      include: { user: { select: { name: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    total,
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      detail: r.detail ?? null,
      userName: r.user?.name ?? null,
    })),
  };
}
