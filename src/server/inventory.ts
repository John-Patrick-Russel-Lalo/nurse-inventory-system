import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  allocateFefo,
  assertBatchStaysNonNegative,
  canVoid,
  checkEntryDate,
  daysBetween,
  expiryStatus,
  isExpired,
  isLowStock,
  itemBalance,
  parseExpiry,
  signedQty,
  validateAllocations,
  type BatchStock,
  type TxType as StockTxType,
} from "@/lib/stock";
import type {
  AllocationLine,
  BatchView,
  DashboardData,
  ItemDetail,
  ItemSummary,
  MovementBody,
  MovementResult,
  StockResponse,
  TransactionView,
} from "@/lib/api-types";
import {
  audit,
  serverDate,
  type Ctx,
  NURSE_BACKDATE_DAYS,
} from "./context";
import { fromDbDate, lastDayOfMonth, lastMonths, monthOf, monthsBetween, today, toDbDate } from "@/lib/dates";
import { ApiError } from "./http";

// ---------- retry ----------

/**
 * Runs a serializable transaction, retrying the two errors that are safe to retry:
 * a serialization conflict (someone else wrote at the same time) and a unique-key race
 * (two people creating the same batch). Nothing else is retried, so a real rule
 * violation fails on the first try.
 */
async function serializable<T>(fn: (tx: TxClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      const retryable =
        e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2034" || e.code === "P2002");
      if (!retryable || attempt >= attempts) throw e;
    }
  }
}

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ---------- balances ----------

/**
 * Balances per batch. Stock is never stored, so this sums the non-voided entries
 * (see src/lib/stock.ts). Restricted to the batches asked for so a filtered list stays cheap.
 */
async function balancesByBatch(client: TxClient, batchIds: number[]): Promise<Map<number, number>> {
  if (batchIds.length === 0) return new Map();
  const rows = await client.transaction.groupBy({
    by: ["batchId"],
    where: { batchId: { in: batchIds }, voidedAt: null },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.batchId, r._sum.qty ?? 0]));
}

interface BatchRow {
  id: number;
  itemId: string;
  expiry: Date | null;
  label: string | null;
  source: string | null;
  receivedOn: Date | null;
  qtyReceived: number;
}

function toBatchView(batch: BatchRow, balance: number, today: string): BatchView {
  const expiry = fromDbDate(batch.expiry);
  return {
    id: batch.id,
    expiry,
    label: batch.label,
    source: batch.source,
    receivedOn: fromDbDate(batch.receivedOn),
    qtyReceived: batch.qtyReceived,
    balance,
    expiryStatus: expiryStatus(expiry, today),
    daysToExpiry: expiry ? daysBetween(today, expiry) : null,
  };
}

/** The list-shaped projection of an item: its balance and the two flags the UI colours by. */
function summarise(
  item: {
    id: string;
    name: string;
    variant: string | null;
    category: ItemSummary["category"];
    unit: string | null;
    reorderLevel: number | null;
    active: boolean;
  },
  batches: BatchView[],
  today: string,
): ItemSummary {
  const balance = itemBalance(batches.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance })));
  const stocked = batches.filter((b) => b.balance > 0);
  const withExpiry = stocked.filter((b) => b.expiry !== null);
  const nearest = withExpiry.length ? withExpiry.map((b) => b.expiry!).sort()[0] : null;
  return {
    ...item,
    balance,
    lowStock: isLowStock(balance, item.reorderLevel),
    nearestExpiry: nearest,
    expiredQty: stocked.filter((b) => isExpired(b.expiry, today)).reduce((s, b) => s + b.balance, 0),
    batchCount: stocked.length,
  };
}

// ---------- reads ----------

export interface ItemFilter {
  q?: string;
  category?: string;
  includeInactive?: boolean;
  lowOnly?: boolean;
}

function itemWhere(filter: ItemFilter): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {};
  if (!filter.includeInactive) where.active = true;
  if (filter.category && filter.category !== "ALL") where.category = filter.category as ItemSummary["category"];
  if (filter.q) {
    const q = filter.q.trim();
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { variant: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** One pass over the items and batches that match the filter, then balances for those batches. */
async function itemsWithBatches(ctx: Ctx, filter: ItemFilter) {
  const items = await db.item.findMany({
    where: itemWhere(filter),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { batches: { orderBy: [{ expiry: { sort: "asc", nulls: "last" } }, { id: "asc" }] } },
  });
  const balances = await balancesByBatch(
    db,
    items.flatMap((i) => i.batches.map((b) => b.id)),
  );
  return items.map((item) => {
    const views = item.batches.map((b) => toBatchView(b, balances.get(b.id) ?? 0, ctx.today));
    return { item, views, summary: summarise(item, views, ctx.today) };
  });
}

export async function listItems(ctx: Ctx, filter: ItemFilter): Promise<ItemSummary[]> {
  const rows = await itemsWithBatches(ctx, filter);
  return rows.map((r) => r.summary).filter((s) => (filter.lowOnly ? s.lowStock : true));
}

export async function stockReport(ctx: Ctx, filter: ItemFilter): Promise<StockResponse> {
  const rows = await itemsWithBatches(ctx, filter);
  const kept = rows.filter((r) => (filter.lowOnly ? r.summary.lowStock : true));
  return {
    rows: kept.map((r) => ({ item: r.summary, batches: r.views.filter((b) => b.balance !== 0) })),
    total: {
      items: kept.length,
      units: kept.reduce((s, r) => s + r.summary.balance, 0),
      lowStock: kept.filter((r) => r.summary.lowStock).length,
      expired: kept.filter((r) => r.summary.expiredQty > 0).length,
    },
  };
}

/** Drops the computed fields, leaving just the item's own columns. */
function plainItem(
  item: ItemSummary,
): Omit<ItemSummary, "balance" | "lowStock" | "nearestExpiry" | "expiredQty" | "batchCount"> {
  return {
    id: item.id,
    name: item.name,
    variant: item.variant,
    category: item.category,
    unit: item.unit,
    reorderLevel: item.reorderLevel,
    active: item.active,
  };
}

export async function getItem(ctx: Ctx, id: string): Promise<ItemDetail> {
  const [item, batches] = await Promise.all([
    db.item.findUnique({ where: { id } }),
    db.batch.findMany({ where: { itemId: id }, orderBy: [{ expiry: { sort: "asc", nulls: "last" } }, { id: "asc" }] }),
  ]);
  if (!item) throw ApiError.notFound(`No item with ID "${id}".`);

  const balances = await balancesByBatch(db, batches.map((b) => b.id));
  const views = batches.map((b) => toBatchView(b, balances.get(b.id) ?? 0, ctx.today));
  const summary = summarise(item, views, ctx.today);
  const [{ transactions }, series] = await Promise.all([
    listTransactions(ctx, { itemId: id, limit: 100 }),
    itemSeries(id, monthOf(ctx.today)),
  ]);

  return {
    item: plainItem(summary),
    balance: summary.balance,
    lowStock: summary.lowStock,
    batches: views,
    transactions,
    monthly: series.monthly,
    balances: series.balances,
  };
}

export interface TxFilter {
  itemId?: string;
  from?: string;
  to?: string;
  type?: string;
  /** Defaults to hiding voided entries. */
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export async function listTransactions(
  _ctx: Ctx,
  filter: TxFilter,
): Promise<{ transactions: TransactionView[]; total: number }> {
  const where: Prisma.TransactionWhereInput = {};
  if (filter.itemId) where.itemId = filter.itemId;
  if (filter.from || filter.to) {
    where.date = {};
    if (filter.from) where.date.gte = toDbDate(filter.from);
    if (filter.to) where.date.lte = toDbDate(filter.to);
  }
  if (filter.type && filter.type !== "ALL") where.type = filter.type as StockTxType;
  if (!filter.includeVoided) where.voidedAt = null;

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
      include: {
        user: { select: { name: true } },
        voidedBy: { select: { name: true } },
        batch: { select: { expiry: true, label: true } },
        item: { select: { name: true } },
      },
    }),
    db.transaction.count({ where }),
  ]);

  return {
    total,
    transactions: rows.map((t) => ({
      id: t.id,
      date: fromDbDate(t.date)!,
      itemId: t.itemId,
      itemName: t.item.name,
      batchId: t.batchId,
      batchExpiry: fromDbDate(t.batch.expiry),
      batchLabel: t.batch.label,
      type: t.type,
      qty: t.qty,
      source: t.source,
      remarks: t.remarks,
      userName: t.user.name,
      voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
      voidedByName: t.voidedBy?.name ?? null,
      voidReason: t.voidReason,
    })),
  };
}

// ---------- allocation ----------

/** The batches of one item with their live balances, in the shape src/lib/stock.ts wants. */
async function stockOf(client: TxClient, itemId: string, today: string): Promise<BatchView[]> {
  const batches = await client.batch.findMany({
    where: { itemId },
    orderBy: [{ expiry: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  const balances = await balancesByBatch(client, batches.map((b) => b.id));
  return batches.map((b) => toBatchView(b, balances.get(b.id) ?? 0, today));
}

function toStockStock(batches: BatchView[]): BatchStock[] {
  return batches.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance }));
}

function toLines(batches: BatchView[], allocations: { batchId: number; qty: number }[]): AllocationLine[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  return allocations.map((a) => {
    const b = byId.get(a.batchId)!;
    return { batchId: a.batchId, qty: a.qty, expiry: b.expiry, label: b.label, balance: b.balance };
  });
}

/** How the server would split a dispense, earliest expiry first. Read-only, so no lock needed. */
export async function suggestAllocation(ctx: Ctx, itemId: string, qty: number): Promise<{
  allocations: AllocationLine[];
  usable: number;
  requested: number;
}> {
  await assertItemExists(ctx, itemId, false);
  const batches = await stockOf(db, itemId, ctx.today);
  const usable = toStockStock(batches)
    .filter((b) => b.balance > 0 && !isExpired(b.expiry, ctx.today))
    .reduce((s, b) => s + b.balance, 0);
  const split = allocateFefo(toStockStock(batches), qty, ctx.today);
  return { allocations: toLines(batches, split), usable, requested: qty };
}

// ---------- writes ----------

async function assertItemExists(ctx: Ctx, itemId: string, requireActive: boolean) {
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) throw ApiError.notFound(`No item with ID "${itemId}".`);
  if (requireActive && !item.active) {
    throw ApiError.conflict(`${item.name} is not active, so it cannot receive entries.`, "ITEM_INACTIVE");
  }
  return item;
}

/** The entry date, checked against the role and the closed months. */
function resolveDate(ctx: Ctx, given?: string): string {
  const date = given ? serverDate(given, "date") : ctx.today;
  const check = checkEntryDate({
    role: ctx.user.role,
    entryDate: date,
    today: ctx.today,
    closedMonths: ctx.closed,
    nurseBackdateDays: NURSE_BACKDATE_DAYS,
  });
  if (!check.ok) throw ApiError.conflict(check.reason, "DATE_NOT_ALLOWED");
  return date;
}

/** Find the item's batch for this expiry, or create it. Items get at most one unknown-expiry batch. */
async function batchForExpiry(
  tx: TxClient,
  args: { itemId: string; expiry: string | null; label: string | null; source: string | null; receivedOn: string; qty: number },
): Promise<number> {
  const expiryDate = args.expiry ? toDbDate(args.expiry) : null;
  const found = await tx.batch.findFirst({ where: { itemId: args.itemId, expiry: expiryDate } });
  if (found) return found.id;
  const created = await tx.batch.create({
    data: {
      itemId: args.itemId,
      expiry: expiryDate,
      label: args.label,
      source: args.source,
      receivedOn: toDbDate(args.receivedOn),
      qtyReceived: args.qty,
    },
  });
  return created.id;
}

/**
 * Records a stock movement. DISPENSE and DISPOSE become one transaction row per batch, so a
 * single entry can span several batches and still leave an auditable trail.
 *
 * Everything runs in one serializable transaction: the batch balances are read, validated
 * and written together, and the audit entry commits with them. Two nurses dispensing the
 * last box at the same time cannot both succeed, and a stock change is never left unaudited.
 */
export async function recordMovement(ctx: Ctx, body: MovementBody): Promise<MovementResult> {
  if (body.type === "OPENING" && ctx.user.role !== "ADMIN") {
    throw ApiError.forbidden("Only an admin can record an opening balance.");
  }

  await assertItemExists(ctx, body.itemId, true);
  const date = resolveDate(ctx, body.date);
  const signed = signedQty(body.type, body.qty);

  // Pulled out before the transaction callback: TypeScript does not carry a narrowing on a
  // parameter into a closure.
  const incoming = body.type === "OPENING" || body.type === "RECEIVE" ? body : null;
  const outgoing = body.type === "DISPENSE" || body.type === "DISPOSE" ? body : null;
  const adjustment = body.type === "ADJUST" ? body : null;

  const common = {
    date: toDbDate(date),
    itemId: body.itemId,
    type: body.type,
    userId: ctx.user.id,
    source: body.source?.trim() || null,
    remarks: body.remarks?.trim() || null,
  };
  const magnitude = Math.abs(signed);

  const written = await serializable(async (tx) => {
    let ids: number[];
    let allocations: AllocationLine[] | undefined;

    if (incoming) {
      // The workbook stores expiry as "8/2027"; accept that and a full date.
      const expiry = incoming.expiry ? (parseExpiry(incoming.expiry) ?? assertExpiry(incoming.expiry)) : null;
      const batchId = await batchForExpiry(tx, {
        itemId: incoming.itemId,
        expiry,
        label: incoming.lot?.trim() || null,
        source: common.source,
        receivedOn: date,
        qty: magnitude,
      });
      const created = await tx.transaction.create({
        data: { ...common, batchId, qty: signed },
        select: { id: true },
      });
      ids = [created.id];
    } else if (outgoing) {
      const batches = await stockOf(tx, outgoing.itemId, ctx.today);
      const stock = toStockStock(batches);
      // No manual split: let the rules take the earliest expiry first.
      let split: { batchId: number; qty: number }[];
      if (outgoing.allocations?.length) {
        validateAllocations(stock, outgoing.allocations, magnitude);
        split = outgoing.allocations;
      } else {
        split = allocateFefo(stock, magnitude, ctx.today);
      }
      ids = [];
      for (const line of split) {
        const created = await tx.transaction.create({
          data: { ...common, batchId: line.batchId, qty: -line.qty },
          select: { id: true },
        });
        ids.push(created.id);
      }
      allocations = toLines(batches, split);
    } else if (adjustment) {
      // ADJUST carries its own sign and always names its batch.
      const batches = await stockOf(tx, adjustment.itemId, ctx.today);
      const batch = batches.find((b) => b.id === adjustment.batchId);
      if (!batch) {
        throw ApiError.badRequest(
          `Batch ${adjustment.batchId} does not belong to ${adjustment.itemId}.`,
          "UNKNOWN_BATCH",
        );
      }
      assertBatchStaysNonNegative(batch.balance, signed, batch.id);
      const created = await tx.transaction.create({
        data: { ...common, batchId: adjustment.batchId, qty: signed },
        select: { id: true },
      });
      ids = [created.id];
    } else {
      // Unreachable: the schema is a closed union. Thrown rather than asserted so a future
      // type added without a branch fails loudly instead of writing nothing.
      throw ApiError.badRequest(`Cannot record a "${body.type}" entry.`);
    }

    await audit(tx, ctx, `transaction.${body.type.toLowerCase()}`, "transaction", String(ids[0]), {
      itemId: body.itemId,
      date,
      qty: signed,
      allocations: allocations?.map((a) => ({ batchId: a.batchId, qty: a.qty })) ?? null,
    });

    return { ids, allocations };
  });

  // stockOf already reads live balances, so this is the post-write balance of the item.
  const batches = await stockOf(db, body.itemId, ctx.today);
  const views = (await listTransactions(ctx, { itemId: body.itemId, limit: 200 })).transactions;

  return {
    transactions: written.ids.map((id) => views.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t),
    allocations: written.allocations,
    balances: { [body.itemId]: itemBalance(toStockStock(batches)) },
  };
}

function assertExpiry(value: string): string {
  const parsed = parseExpiry(value);
  if (!parsed) throw ApiError.badRequest(`Expiry "${value}" is not readable. Try "8/2027" or "2027-08-31".`);
  return parsed;
}

/**
 * Voids an entry. Nothing is deleted: the row stays with voidedAt set, so the balance
 * ignores it while the history still shows what was recorded and who reversed it.
 */
export async function voidTransaction(ctx: Ctx, id: number, reason: string): Promise<TransactionView> {
  const existing = await db.transaction.findUnique({ where: { id }, include: { batch: true } });
  if (!existing) throw ApiError.notFound(`No entry with ID ${id}.`);
  if (existing.voidedAt) throw ApiError.conflict(`Entry ${id} is already voided.`, "ALREADY_VOIDED");

  const entryDate = fromDbDate(existing.date)!;
  const check = canVoid(ctx.user.role, entryDate, ctx.closed);
  if (!check.ok) throw ApiError.forbidden(check.reason);

  const trimmed = reason.trim();
  if (trimmed.length < 3) throw ApiError.badRequest("Give a reason for the void.");

  await db.$transaction(async (tx) => {
    // Voids add back stock, so the batch must not have been drawn down past zero meanwhile.
    if (existing.qty < 0) {
      const balance = (await balancesByBatch(tx, [existing.batchId])).get(existing.batchId) ?? 0;
      assertBatchStaysNonNegative(balance, -existing.qty, existing.batchId);
    }
    await tx.transaction.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: ctx.user.id, voidReason: trimmed },
    });
    await audit(tx, ctx, "transaction.void", "transaction", String(id), { reason: trimmed, qty: existing.qty });
  });

  const { transactions } = await listTransactions(ctx, { includeVoided: true, limit: 200 });
  const view = transactions.find((t) => t.id === id);
  if (!view) throw new Error(`Entry ${id} vanished after being voided.`);
  return view;
}

// ---------- usage over time ----------

export interface MonthUsage {
  month: string;
  received: number;
  dispensed: number;
}

export interface MonthBalance {
  month: string;
  balance: number;
}

/**
 * Sums signed entries into one bucket per month, oldest first, with the quiet months present as
 * zeros so a chart shows a dip rather than a gap.
 *
 * The split is the same one the Excel export uses: an entry is a receipt or an issue by the
 * direction it moved the stock, so OPENING and a positive ADJUST count as received and DISPOSE
 * and a negative ADJUST count as dispensed. Anything that way, "received minus dispensed" is
 * always the change in stock, which is what makes a usage chart mean anything.
 */
function bucketByMonth(
  entries: readonly { date: string; qty: number }[],
  first: string,
  last: string,
): MonthUsage[] {
  const months = monthsBetween(first.slice(0, 7), last.slice(0, 7));
  const buckets = months.map((month) => ({ month, received: 0, dispensed: 0 }));
  const byMonth = new Map(buckets.map((b) => [b.month, b]));
  for (const entry of entries) {
    const bucket = byMonth.get(entry.date.slice(0, 7));
    if (!bucket) continue;
    if (entry.qty > 0) bucket.received += entry.qty;
    else if (entry.qty < 0) bucket.dispensed -= entry.qty;
  }
  return buckets;
}

/** Received and dispensed per month across the whole office. */
export async function monthlyUsage(from: string, to: string): Promise<MonthUsage[]> {
  const rows = await db.transaction.findMany({
    where: { date: { gte: toDbDate(from), lte: toDbDate(to) }, voidedAt: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { date: true, qty: true },
  });
  return bucketByMonth(
    rows.map((r) => ({ date: fromDbDate(r.date)!, qty: r.qty })),
    from,
    to,
  );
}

/** What the office used most this month, for the dashboard's usage chart. */
export async function topDispensed(month: string, limit = 8): Promise<{ itemId: string; itemName: string; dispensed: number }[]> {
  const rows = await db.transaction.groupBy({
    by: ["itemId"],
    where: {
      date: { gte: toDbDate(`${month}-01`), lte: toDbDate(lastDayOfMonth(month)) },
      type: "DISPENSE",
      voidedAt: null,
    },
    // Dispenses are stored negative, so the most negative sum is the most used.
    orderBy: { _sum: { qty: "asc" } },
    take: limit,
    _sum: { qty: true },
  });
  if (rows.length === 0) return [];

  const names = await db.item.findMany({
    where: { id: { in: rows.map((r) => r.itemId) } },
    select: { id: true, name: true, variant: true },
  });
  const nameById = new Map(names.map((n) => [n.id, n.variant ? `${n.name} ${n.variant}` : n.name]));
  return rows.map((r) => ({
    itemId: r.itemId,
    itemName: nameById.get(r.itemId) ?? r.itemId,
    dispensed: Math.abs(r._sum.qty ?? 0),
  }));
}

/** One item's monthly usage, and its balance at each month end, over its whole life. */
// The series runs from the item's first entry to the month in progress, not just to its last entry,
// so the chart always ends at today's balance. Months with no entries carry the previous balance
// forward, which is also what stops a one-month item drawing a line with nothing on it.
export async function itemSeries(
  itemId: string,
  through = monthOf(today()),
): Promise<{ monthly: MonthUsage[]; balances: MonthBalance[] }> {
  const rows = await db.transaction.findMany({
    where: { itemId, voidedAt: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { date: true, qty: true },
  });
  if (rows.length === 0) return { monthly: [], balances: [] };

  const entries = rows.map((r) => ({ date: fromDbDate(r.date)!, qty: r.qty }));
  const monthly: MonthUsage[] = monthsBetween(monthOf(entries[0].date), through).map((month) => ({
    month,
    received: 0,
    dispensed: 0,
  }));
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  for (const entry of entries) {
    const bucket = byMonth.get(monthOf(entry.date));
    if (!bucket) continue;
    if (entry.qty > 0) bucket.received += entry.qty;
    else bucket.dispensed += -entry.qty;
  }

  // Entries and months are both in order, so one pass is enough.
  const balances: MonthBalance[] = [];
  let balance = 0;
  let cursor = 0;
  for (const m of monthly) {
    while (cursor < entries.length && monthOf(entries[cursor].date) <= m.month) {
      balance += entries[cursor].qty;
      cursor++;
    }
    balances.push({ month: m.month, balance });
  }

  return { monthly, balances };
}

// ---------- dashboard ----------

export async function dashboard(ctx: Ctx): Promise<DashboardData> {
  const report = await stockReport(ctx, {});

  const soon = report.rows
    .flatMap((row) =>
      row.batches
        .filter((b) => b.balance > 0 && b.expiry !== null && b.daysToExpiry !== null && b.daysToExpiry <= 90)
        .map((b) => ({
          itemId: row.item.id,
          itemName: row.item.variant ? `${row.item.name} ${row.item.variant}` : row.item.name,
          expiry: b.expiry!,
          balance: b.balance,
          daysLeft: b.daysToExpiry!,
        })),
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // A year of months, so the trend chart shows how usage has moved. Anything older is a line
  // away in the export.
  const current = monthOf(ctx.today);
  const from = `${lastMonths(current, 12)[0]}-01`;
  const [monthly, topUsed, { transactions }] = await Promise.all([
    monthlyUsage(from, ctx.today),
    topDispensed(current),
    listTransactions(ctx, { limit: 12 }),
  ]);

  return {
    itemCount: report.total.items,
    lowStock: report.rows
      .filter((r) => r.item.lowStock)
      .map((r) => r.item)
      .sort((a, b) => a.balance - b.balance)
      .slice(0, 12),
    expiringSoon: soon.filter((b) => b.daysLeft >= 0).slice(0, 12),
    expired: report.rows
      .filter((r) => r.item.expiredQty > 0)
      .map((r) => ({ itemId: r.item.id, itemName: r.item.name, balance: r.item.expiredQty })),
    monthTotals: monthly,
    topUsed,
    recent: transactions,
  };
}

/** Convenience for the month-end screen: each item's balance at the last day of a month. */
export async function balancesAtMonthEnd(month: string): Promise<Map<string, number>> {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const cutoff = lastDay.toISOString().slice(0, 10);
  const rows = await db.$queryRaw<{ itemId: string; balance: bigint }[]>`
    SELECT b."itemId",
           COALESCE(SUM(t."qty"), 0)::bigint AS balance
    FROM "batches" b
    LEFT JOIN "transactions" t
      ON t."batchId" = b."id" AND t."voidedAt" IS NULL AND t."date" <= ${toDbDate(cutoff)}
    GROUP BY b."itemId"
  `;
  return new Map(rows.map((r) => [r.itemId, Number(r.balance)]));
}
