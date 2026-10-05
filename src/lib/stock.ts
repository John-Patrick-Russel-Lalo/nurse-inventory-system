// Pure stock rules. No database, no framework imports, so they can be tested on their own.
// Dates are plain "YYYY-MM-DD" strings to avoid time zone shifts (the office is in Asia/Manila).

export type TxType = "OPENING" | "RECEIVE" | "DISPENSE" | "ADJUST" | "DISPOSE";
export type Role = "NURSE" | "ADMIN";

export interface Tx {
  batchId: number;
  type: TxType;
  /** Signed quantity as stored: OPENING/RECEIVE positive, DISPENSE/DISPOSE negative, ADJUST either. */
  qty: number;
  voided: boolean;
}

export interface BatchStock {
  batchId: number;
  /** Month-end date "YYYY-MM-DD", or null when the expiry is unknown. */
  expiry: string | null;
  balance: number;
}

export interface Allocation {
  batchId: number;
  qty: number;
}

export type StockErrorCode = "INSUFFICIENT_STOCK" | "NEGATIVE_BATCH" | "INVALID_QTY" | "UNKNOWN_BATCH";

export class StockError extends Error {
  code: StockErrorCode;
  constructor(message: string, code: StockErrorCode) {
    super(message);
    this.name = "StockError";
    this.code = code;
  }
}

// ---------- dates ----------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date "${date}"`);
  }
  return ms;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** Last day of the given month as "YYYY-MM-DD". month is 1 to 12. */
export function endOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/**
 * Parses the expiry formats found in the workbook ("8/2027", "01/2027", a full date) into a
 * month-end date. Returns null for empty or unreadable input.
 */
export function parseExpiry(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const my = /^(\d{1,2})\s*[/-]\s*(\d{4})$/.exec(s);
  if (my) {
    const month = Number(my[1]);
    if (month < 1 || month > 12) return null;
    return endOfMonth(Number(my[2]), month);
  }
  const full = DATE_RE.exec(s);
  if (full) {
    const month = Number(full[2]);
    if (month < 1 || month > 12) return null;
    return endOfMonth(Number(full[1]), month);
  }
  return null;
}

export function monthKey(date: string): string {
  toUtcMs(date);
  return date.slice(0, 7);
}

// ---------- quantities ----------

/**
 * Turns the quantity a person typed into the signed value that is stored.
 * RECEIVE/OPENING must be positive and become positive. DISPENSE/DISPOSE must be positive input
 * and become negative. ADJUST keeps its sign and must not be zero.
 */
export function signedQty(type: TxType, qty: number): number {
  if (!Number.isInteger(qty) || qty === 0) {
    throw new StockError("Quantity must be a whole number and not zero.", "INVALID_QTY");
  }
  switch (type) {
    case "OPENING":
    case "RECEIVE":
      if (qty < 0) throw new StockError(`${type} quantity must be positive.`, "INVALID_QTY");
      return qty;
    case "DISPENSE":
    case "DISPOSE":
      if (qty < 0) throw new StockError(`${type} quantity must be entered as a positive number.`, "INVALID_QTY");
      return -qty;
    case "ADJUST":
      return qty;
  }
}

// ---------- balances ----------

export function batchBalances(txs: Tx[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of txs) {
    if (t.voided) continue;
    out.set(t.batchId, (out.get(t.batchId) ?? 0) + t.qty);
  }
  return out;
}

export function itemBalance(batches: BatchStock[]): number {
  return batches.reduce((sum, b) => sum + b.balance, 0);
}

export function isLowStock(balance: number, reorderLevel: number | null | undefined): boolean {
  if (reorderLevel == null || reorderLevel <= 0) return false;
  return balance <= reorderLevel;
}

// ---------- expiry ----------

export type ExpiryStatus = "NO_EXPIRY" | "EXPIRED" | "DAYS_30" | "DAYS_60" | "DAYS_90" | "OK";

/** A batch is expired once today is after its expiry date (month end). */
export function isExpired(expiry: string | null, today: string): boolean {
  return expiry !== null && daysBetween(expiry, today) > 0;
}

export function expiryStatus(expiry: string | null, today: string): ExpiryStatus {
  if (expiry === null) return "NO_EXPIRY";
  const left = daysBetween(today, expiry);
  if (left < 0) return "EXPIRED";
  if (left <= 30) return "DAYS_30";
  if (left <= 60) return "DAYS_60";
  if (left <= 90) return "DAYS_90";
  return "OK";
}

// ---------- allocation (earliest expiry first) ----------

function byExpiryThenId(a: BatchStock, b: BatchStock): number {
  if (a.expiry === b.expiry) return a.batchId - b.batchId;
  if (a.expiry === null) return 1; // unknown expiry goes last
  if (b.expiry === null) return -1;
  return a.expiry < b.expiry ? -1 : 1;
}

/**
 * Splits a dispense across batches, earliest expiry first. Expired and empty batches are skipped.
 * Batches with unknown expiry are used last. Throws INSUFFICIENT_STOCK when usable stock is short.
 */
export function allocateFefo(batches: BatchStock[], qty: number, today: string): Allocation[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new StockError("Quantity must be a positive whole number.", "INVALID_QTY");
  }
  const usable = batches
    .filter((b) => b.balance > 0 && !isExpired(b.expiry, today))
    .sort(byExpiryThenId);
  const available = usable.reduce((s, b) => s + b.balance, 0);
  if (available < qty) {
    throw new StockError(`Only ${available} usable in stock, ${qty} requested.`, "INSUFFICIENT_STOCK");
  }
  const out: Allocation[] = [];
  let left = qty;
  for (const b of usable) {
    if (left === 0) break;
    const take = Math.min(b.balance, left);
    out.push({ batchId: b.batchId, qty: take });
    left -= take;
  }
  return out;
}

/** Checks a person's own split (override of the earliest-expiry-first suggestion). */
export function validateAllocations(batches: BatchStock[], allocations: Allocation[], qty: number): void {
  const byId = new Map(batches.map((b) => [b.batchId, b]));
  let total = 0;
  const seen = new Set<number>();
  for (const a of allocations) {
    if (!Number.isInteger(a.qty) || a.qty <= 0) {
      throw new StockError("Each batch quantity must be a positive whole number.", "INVALID_QTY");
    }
    const b = byId.get(a.batchId);
    if (!b) throw new StockError(`Batch ${a.batchId} does not belong to this item.`, "UNKNOWN_BATCH");
    if (seen.has(a.batchId)) throw new StockError(`Batch ${a.batchId} is listed twice.`, "INVALID_QTY");
    seen.add(a.batchId);
    if (a.qty > b.balance) {
      throw new StockError(`Batch ${a.batchId} has ${b.balance}, ${a.qty} requested.`, "NEGATIVE_BATCH");
    }
    total += a.qty;
  }
  if (total !== qty) {
    throw new StockError(`Batch quantities add up to ${total}, expected ${qty}.`, "INVALID_QTY");
  }
}

/** Used for ADJUST and DISPOSE: the change must not push the batch below zero. */
export function assertBatchStaysNonNegative(balance: number, signedChange: number, batchId: number): void {
  if (balance + signedChange < 0) {
    throw new StockError(
      `Batch ${batchId} has ${balance}; a change of ${signedChange} would make it negative.`,
      "NEGATIVE_BATCH",
    );
  }
}

// ---------- who may record an entry, and for which date ----------

export type EntryDateCheck = { ok: true } | { ok: false; reason: string };

export interface EntryDateInput {
  role: Role;
  entryDate: string;
  today: string;
  /** Months that have been closed, as "YYYY-MM". */
  closedMonths: ReadonlySet<string>;
  /** How many days back a NURSE may record. Default 3. */
  nurseBackdateDays?: number;
}

export function checkEntryDate(input: EntryDateInput): EntryDateCheck {
  const { role, entryDate, today, closedMonths, nurseBackdateDays = 3 } = input;
  const age = daysBetween(entryDate, today);
  if (age < 0) return { ok: false, reason: "The date is in the future." };
  if (closedMonths.has(monthKey(entryDate))) {
    return { ok: false, reason: `${monthKey(entryDate)} is closed. An admin must reopen it first.` };
  }
  if (role === "NURSE" && age > nurseBackdateDays) {
    return { ok: false, reason: `Nurses can record up to ${nurseBackdateDays} days back. Ask an admin.` };
  }
  return { ok: true };
}

/** Voiding an entry is admin only, and follows the same closed-month rule. */
export function canVoid(role: Role, entryDate: string, closedMonths: ReadonlySet<string>): EntryDateCheck {
  if (role !== "ADMIN") return { ok: false, reason: "Only an admin can void an entry." };
  if (closedMonths.has(monthKey(entryDate))) {
    return { ok: false, reason: `${monthKey(entryDate)} is closed. Reopen it first.` };
  }
  return { ok: true };
}
