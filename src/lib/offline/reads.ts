// The local read model: the same answers the server's services give, rebuilt in the browser
// from the mirrored rows plus whatever movements are still queued.
//
// The stock rules are the shared ones in src/lib/stock.ts, so a balance on screen and a
// balance on the server are produced by the same arithmetic.

import type {
  AllocationLine,
  AllocationResponse,
  BatchView,
  DashboardData,
  ExpiryResponse,
  ExpiryRow,
  ItemDetail,
  ItemSummary,
  MonthsResponse,
  MonthUsage,
  MovementBody,
  MovementResult,
  OutboxMovement,
  StockResponse,
  SyncItem,
  TransactionView,
} from "@/lib/api-types";
import {
  allocateFefo,
  checkEntryDate,
  daysBetween,
  expiryStatus,
  isExpired,
  isLowStock,
  itemBalance,
  signedQty,
  StockError,
  validateAllocations,
  type BatchStock,
  type TxType,
} from "@/lib/stock";
import { lastMonths, lastDayOfMonth, monthOf, monthsBetween, previousMonth } from "@/lib/dates";
import { ApiError } from "@/lib/api-error";
import { ensureReady } from "./sync";
import { store, type CachedSession } from "./store";
import { balancesOf, buildView, type View, type ViewBatch } from "./view";

export interface ItemFilter {
  q?: string;
  category?: string;
  includeInactive?: boolean;
  lowOnly?: boolean;
}

export interface TxFilter {
  itemId?: string;
  from?: string;
  to?: string;
  type?: string;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

interface Loaded {
  view: View;
  session: CachedSession;
}

async function load(): Promise<Loaded> {
  await ensureReady();
  const [snapshot, outbox, session] = await Promise.all([
    store.readSnapshot(),
    store.listOutbox(),
    store.getSession(),
  ]);
  if (!session) throw ApiError.unauthorized();
  return { view: buildView(snapshot, outbox, session), session };
}

// ---------- shaping ----------

function toBatchView(b: ViewBatch, balance: number, today: string): BatchView {
  return {
    id: b.id,
    expiry: b.expiry,
    label: b.label,
    source: b.source,
    receivedOn: b.receivedOn,
    qtyReceived: b.qtyReceived,
    balance,
    expiryStatus: expiryStatus(b.expiry, today),
    daysToExpiry: b.expiry ? daysBetween(today, b.expiry) : null,
  };
}

function summarise(item: SyncItem, batches: BatchView[], today: string): ItemSummary {
  const balance = itemBalance(batches.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance })));
  const stocked = batches.filter((b) => b.balance > 0);
  const withExpiry = stocked.filter((b) => b.expiry !== null);
  const nearest = withExpiry.length ? withExpiry.map((b) => b.expiry!).sort()[0] : null;
  return {
    id: item.id,
    name: item.name,
    variant: item.variant,
    category: item.category,
    unit: item.unit,
    reorderLevel: item.reorderLevel,
    active: item.active,
    balance,
    lowStock: isLowStock(balance, item.reorderLevel),
    nearestExpiry: nearest,
    expiredQty: stocked.filter((b) => isExpired(b.expiry, today)).reduce((s, b) => s + b.balance, 0),
    batchCount: stocked.length,
  };
}

function matches(item: SyncItem, filter: ItemFilter): boolean {
  if (!filter.includeInactive && !item.active) return false;
  if (filter.category && filter.category !== "ALL" && item.category !== filter.category) return false;
  if (filter.q) {
    const q = filter.q.trim().toLowerCase();
    const hay = `${item.id} ${item.name} ${item.variant ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

interface ItemWithBatches {
  item: SyncItem;
  views: BatchView[];
  summary: ItemSummary;
}

function itemsWithBatches(view: View, filter: ItemFilter): ItemWithBatches[] {
  const balances = balancesOf(view.transactions);
  const batchesByItem = new Map<string, ViewBatch[]>();
  for (const b of view.batches) {
    const list = batchesByItem.get(b.itemId);
    if (list) list.push(b);
    else batchesByItem.set(b.itemId, [b]);
  }
  return view.items
    .filter((item) => matches(item, filter))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((item) => {
      const views = (batchesByItem.get(item.id) ?? [])
        .slice()
        .sort(byExpiryThenId)
        .map((b) => toBatchView(b, balances.get(b.id) ?? 0, view.today));
      return { item, views, summary: summarise(item, views, view.today) };
    });
}

function byExpiryThenId(a: ViewBatch, b: ViewBatch): number {
  if (a.expiry === b.expiry) return a.id - b.id;
  if (a.expiry === null) return 1;
  if (b.expiry === null) return -1;
  return a.expiry < b.expiry ? -1 : 1;
}

function plainItem(item: ItemSummary): ItemDetail["item"] {
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

// ---------- reads ----------

export async function listItems(filter: ItemFilter): Promise<ItemSummary[]> {
  const { view } = await load();
  return itemsWithBatches(view, filter)
    .map((r) => r.summary)
    .filter((s) => (filter.lowOnly ? s.lowStock : true));
}

export async function stockReport(filter: ItemFilter): Promise<StockResponse> {
  const { view } = await load();
  const kept = itemsWithBatches(view, filter).filter((r) => (filter.lowOnly ? r.summary.lowStock : true));
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

export async function getItem(id: string): Promise<ItemDetail> {
  const { view } = await load();
  const item = view.items.find((i) => i.id === id);
  if (!item) throw ApiError.notFound(`No item with ID "${id}".`);

  const balances = balancesOf(view.transactions);
  const views = view.batches
    .filter((b) => b.itemId === id)
    .sort(byExpiryThenId)
    .map((b) => toBatchView(b, balances.get(b.id) ?? 0, view.today));
  const summary = summarise(item, views, view.today);
  const { transactions } = listTransactionsInView(view, { itemId: id, limit: 100 });
  const series = itemSeriesInView(view, id, monthOf(view.today));

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

export function listTransactionsInView(view: View, filter: TxFilter): { transactions: TransactionView[]; total: number } {
  const itemName = new Map(view.items.map((i) => [i.id, i.name]));
  const batchById = new Map(view.batches.map((b) => [b.id, b]));

  let rows = view.transactions.filter((t) => {
    if (filter.itemId && t.itemId !== filter.itemId) return false;
    if (filter.from && t.date < filter.from) return false;
    if (filter.to && t.date > filter.to) return false;
    if (filter.type && filter.type !== "ALL" && t.type !== filter.type) return false;
    if (!filter.includeVoided && t.voidedAt) return false;
    return true;
  });

  rows = rows.sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  const total = rows.length;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  rows = rows.slice(offset, offset + limit);

  return {
    total,
    transactions: rows.map((t) => {
      const batch = batchById.get(t.batchId);
      return {
        id: t.id,
        date: t.date,
        itemId: t.itemId,
        itemName: itemName.get(t.itemId) ?? t.itemId,
        batchId: t.batchId,
        batchExpiry: batch?.expiry ?? null,
        batchLabel: batch?.label ?? null,
        type: t.type,
        qty: t.qty,
        source: t.source,
        remarks: t.remarks,
        userName: t.userName,
        voidedAt: t.voidedAt,
        voidedByName: null,
        voidReason: t.voidReason,
      };
    }),
  };
}

export async function listTransactions(filter: TxFilter): Promise<{ transactions: TransactionView[]; total: number }> {
  const { view } = await load();
  return listTransactionsInView(view, filter);
}

export async function suggestAllocation(itemId: string, qty: number): Promise<AllocationResponse> {
  const { view } = await load();
  const item = view.items.find((i) => i.id === itemId);
  if (!item) throw ApiError.notFound(`No item with ID "${itemId}".`);

  const balances = balancesOf(view.transactions);
  const views = view.batches
    .filter((b) => b.itemId === itemId)
    .sort(byExpiryThenId)
    .map((b) => toBatchView(b, balances.get(b.id) ?? 0, view.today));
  const stock: BatchStock[] = views.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance }));
  const usable = stock.filter((b) => b.balance > 0 && !isExpired(b.expiry, view.today)).reduce((s, b) => s + b.balance, 0);

  const split = allocateFefo(stock, qty, view.today);
  const byId = new Map(views.map((b) => [b.id, b]));
  return {
    allocations: split.map((a) => {
      const b = byId.get(a.batchId)!;
      return { batchId: a.batchId, qty: a.qty, expiry: b.expiry, label: b.label, balance: b.balance };
    }),
    usable,
    requested: qty,
  };
}

export async function expiryReport(filter: ItemFilter = {}): Promise<ExpiryResponse> {
  const { view } = await load();
  const report = stockReportInView(view, filter);
  const rows: ExpiryRow[] = [];
  for (const row of report.rows) {
    for (const b of row.batches) {
      if (b.balance <= 0 || b.expiry === null || b.daysToExpiry === null) continue;
      rows.push({
        itemId: row.item.id,
        itemName: row.item.name,
        variant: row.item.variant,
        unit: row.item.unit,
        batchId: b.id,
        batchLabel: b.label,
        expiry: b.expiry,
        daysToExpiry: b.daysToExpiry,
        status: b.expiryStatus,
        balance: b.balance,
      });
    }
  }
  rows.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  const sum = (list: ExpiryRow[]) => list.reduce((s, r) => s + r.balance, 0);
  return {
    today: view.today,
    expired: rows.filter((r) => r.status === "EXPIRED"),
    buckets: {
      DAYS_30: rows.filter((r) => r.status === "DAYS_30"),
      DAYS_60: rows.filter((r) => r.status === "DAYS_60"),
      DAYS_90: rows.filter((r) => r.status === "DAYS_90"),
    },
    totalUnits: sum(rows),
  };
}

function stockReportInView(view: View, filter: ItemFilter): StockResponse {
  const kept = itemsWithBatches(view, filter).filter((r) => (filter.lowOnly ? r.summary.lowStock : true));
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

function bucketByMonth(entries: readonly { date: string; qty: number }[], first: string, last: string): MonthUsage[] {
  const buckets = monthsBetween(first.slice(0, 7), last.slice(0, 7)).map((month) => ({ month, received: 0, dispensed: 0 }));
  const byMonth = new Map(buckets.map((b) => [b.month, b]));
  for (const entry of entries) {
    const bucket = byMonth.get(entry.date.slice(0, 7));
    if (!bucket) continue;
    if (entry.qty > 0) bucket.received += entry.qty;
    else if (entry.qty < 0) bucket.dispensed -= entry.qty;
  }
  return buckets;
}

function itemSeriesInView(view: View, itemId: string, through: string) {
  const rows = view.transactions
    .filter((t) => t.itemId === itemId && !t.voidedAt)
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  if (rows.length === 0) return { monthly: [], balances: [] };

  const monthly = monthsBetween(monthOf(rows[0].date), through).map((month) => ({ month, received: 0, dispensed: 0 }));
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  for (const entry of rows) {
    const bucket = byMonth.get(monthOf(entry.date));
    if (!bucket) continue;
    if (entry.qty > 0) bucket.received += entry.qty;
    else bucket.dispensed += -entry.qty;
  }

  const balances: { month: string; balance: number }[] = [];
  let balance = 0;
  let cursor = 0;
  for (const m of monthly) {
    while (cursor < rows.length && monthOf(rows[cursor].date) <= m.month) {
      balance += rows[cursor].qty;
      cursor++;
    }
    balances.push({ month: m.month, balance });
  }
  return { monthly, balances };
}

export async function dashboard(): Promise<DashboardData> {
  const { view } = await load();
  const report = stockReportInView(view, {});

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

  const current = monthOf(view.today);
  const from = `${lastMonths(current, 12)[0]}-01`;
  const monthTotals = monthlyUsageInView(view, from, view.today);
  const topUsed = topDispensedInView(view, current);
  const { transactions } = listTransactionsInView(view, { limit: 12 });

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
    monthTotals,
    topUsed,
    recent: transactions,
  };
}

function monthlyUsageInView(view: View, from: string, to: string): MonthUsage[] {
  const rows = view.transactions.filter((t) => !t.voidedAt && t.date >= from && t.date <= to);
  return bucketByMonth(rows.map((r) => ({ date: r.date, qty: r.qty })), from, to);
}

function topDispensedInView(view: View, month: string, limit = 8) {
  const start = `${month}-01`;
  const end = lastDayOfMonth(month);
  const totals = new Map<string, number>();
  for (const t of view.transactions) {
    if (t.voidedAt || t.type !== "DISPENSE") continue;
    if (t.date < start || t.date > end) continue;
    totals.set(t.itemId, (totals.get(t.itemId) ?? 0) + t.qty);
  }
  const nameById = new Map(view.items.map((i) => [i.id, i.variant ? `${i.name} ${i.variant}` : i.name]));
  return [...totals.entries()]
    .map(([itemId, sum]) => ({ itemId, itemName: nameById.get(itemId) ?? itemId, dispensed: Math.abs(sum) }))
    .sort((a, b) => b.dispensed - a.dispensed)
    .slice(0, limit);
}

export async function months(): Promise<MonthsResponse> {
  const { session } = await load();
  return {
    today: session.today,
    closed: session.closedMonths.map((month) => ({ month, closedAt: "", closedByName: "" })),
    suggest: previousMonth(monthOf(session.today)),
  };
}

// ---------- offline write ----------

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function asApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof StockError) return new ApiError(e.message, 409, e.code);
  return new ApiError(e instanceof Error ? e.message : "Could not record the entry.", 400);
}

/**
 * Queues a movement in the browser and returns the balance it produces, so the Record screen
 * behaves the same offline as it does online. The server still has the final say when the
 * queue is replayed; the same rules are checked here so obvious mistakes never leave the device.
 */
export async function enqueueMovement(body: MovementBody): Promise<MovementResult> {
  await ensureReady();
  const session = await store.getSession();
  if (!session) throw ApiError.unauthorized();

  const date = body.date ?? session.today;

  try {
    if (body.type === "OPENING" && session.user.role !== "ADMIN") {
      throw new ApiError("Only an admin can record an opening balance.", 403, "FORBIDDEN");
    }
    const check = checkEntryDate({
      role: session.user.role,
      entryDate: date,
      today: session.today,
      closedMonths: new Set(session.closedMonths),
      nurseBackdateDays: session.nurseBackdateDays,
    });
    if (!check.ok) throw new ApiError(check.reason, 409, "DATE_NOT_ALLOWED");

    const signed = signedQty(body.type as TxType, body.qty);

    const snapshot = await store.readSnapshot();
    const outbox = await store.listOutbox();
    const view = buildView(snapshot, outbox, session);
    const item = view.items.find((i) => i.id === body.itemId);
    if (!item) throw ApiError.notFound(`No item with ID "${body.itemId}".`);
    if ((body.type === "RECEIVE" || body.type === "OPENING") && !item.active) {
      throw new ApiError(`${item.name} is not active, so it cannot receive entries.`, 409, "ITEM_INACTIVE");
    }

    if (body.type === "DISPENSE" || body.type === "DISPOSE") {
      const balances = balancesOf(view.transactions);
      const stock: BatchStock[] = view.batches
        .filter((b) => b.itemId === body.itemId)
        .map((b) => ({ batchId: b.id, expiry: b.expiry, balance: balances.get(b.id) ?? 0 }));
      if (body.allocations?.length) validateAllocations(stock, body.allocations, Math.abs(signed));
      else allocateFefo(stock, Math.abs(signed), session.today);
    } else if (body.type === "ADJUST") {
      const balances = balancesOf(view.transactions);
      const balance = balances.get(body.batchId);
      if (balance === undefined) throw new ApiError(`Batch ${body.batchId} does not belong to ${body.itemId}.`, 400, "UNKNOWN_BATCH");
      const batch = view.batches.find((b) => b.id === body.batchId);
      if (!batch || batch.itemId !== body.itemId) {
        throw new ApiError(`Batch ${body.batchId} does not belong to ${body.itemId}.`, 400, "UNKNOWN_BATCH");
      }
      if (balance + signed < 0) {
        throw new ApiError(`Batch ${body.batchId} has ${balance}; a change of ${signed} would make it negative.`, 409, "NEGATIVE_BATCH");
      }
    }
  } catch (e) {
    throw asApiError(e);
  }

  const clientId = newClientId();
  const entry: OutboxMovement = {
    clientId,
    body: { ...body, clientId },
    createdAt: new Date().toISOString(),
    userName: session.user.name,
    status: "pending",
  };
  await store.addOutbox(entry);

  return resultFor(clientId);
}

export async function queuedResult(clientId: string): Promise<MovementResult> {
  return resultFor(clientId);
}

async function resultFor(clientId: string): Promise<MovementResult> {
  const [snapshot, outbox, session] = await Promise.all([
    store.readSnapshot(),
    store.listOutbox(),
    store.getSession(),
  ]);
  if (!session) throw ApiError.unauthorized();
  const view = buildView(snapshot, outbox, session);
  const entry = outbox.find((o) => o.clientId === clientId);
  const itemId = entry?.body.itemId ?? "";

  const pendingRows = view.transactions.filter((t) => t.clientId === clientId);
  const itemName = view.items.find((i) => i.id === itemId)?.name ?? itemId;
  const batchById = new Map(view.batches.map((b) => [b.id, b]));
  const transactions: TransactionView[] = pendingRows.map((t) => ({
    id: t.id,
    date: t.date,
    itemId: t.itemId,
    itemName,
    batchId: t.batchId,
    batchExpiry: batchById.get(t.batchId)?.expiry ?? null,
    batchLabel: batchById.get(t.batchId)?.label ?? null,
    type: t.type,
    qty: t.qty,
    source: t.source,
    remarks: t.remarks,
    userName: t.userName,
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
  }));

  const balances = balancesOf(view.transactions);
  let allocations: AllocationLine[] | undefined;
  const entryBody = entry?.body;
  if (entryBody && (entryBody.type === "DISPENSE" || entryBody.type === "DISPOSE")) {
    allocations = pendingRows.map((t) => {
      const b = batchById.get(t.batchId)!;
      return { batchId: t.batchId, qty: Math.abs(t.qty), expiry: b?.expiry ?? null, label: b?.label ?? null, balance: balances.get(t.batchId) ?? 0 };
    });
  }

  return {
    transactions,
    allocations,
    balances: { [itemId]: itemBalance(view.batches.filter((b) => b.itemId === itemId).map((b) => ({ batchId: b.id, expiry: b.expiry, balance: balances.get(b.id) ?? 0 }))) },
  };
}
