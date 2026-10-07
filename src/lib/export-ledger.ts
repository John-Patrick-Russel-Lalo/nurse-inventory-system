// Regenerates the workbook's long-format tab from the stored movements.
//
// The app never keeps those daily rows. All 73,719 of them are derived here, on demand, from
// the entries that actually caused them, which is the whole reason the old format can be retired
// without losing anything.
//
// Pure on purpose: no database, no ExcelJS, so the arithmetic the office trusts can be tested on
// its own. One rule matters more than any other — BEGINNING + RECEIVED - DISPENSED = ENDING on
// every row, with no exceptions — because that identity is what makes the sheet believable.

import { addDays, dayDiff } from "./dates.ts";

/**
 * One converted tab's columns, in order. Shared with the reader in src/lib/workbook.ts so the
 * app can read back a file it wrote itself.
 */
export const LEDGER_HEADERS = [
  "DATE",
  "ITEM ID",
  "BEGINNING BALANCE",
  "RECEIVED",
  "DISPENSED",
  "ENDING BALANCE",
  "EXPIRATION DATE",
] as const;

/** One stored entry, reduced to what a ledger row needs. */
export interface LedgerMovement {
  date: string;
  itemId: string;
  /** Signed, exactly as stored: OPENING/RECEIVE positive, DISPENSE/DISPOSE negative. */
  qty: number;
  /** The batch's month-end expiry, or null when the office never recorded one. */
  expiry: string | null;
}

export interface LedgerItem {
  id: string;
  name: string;
  variant: string | null;
}

export interface LedgerRow {
  date: string;
  itemId: string;
  beginning: number;
  received: number;
  dispensed: number;
  ending: number;
  /**
   * The soonest expiry among the batches holding stock at the end of that day, which is the date
   * a nurse reads off the shelf. Null when nothing in stock carries an expiry.
   */
  expiry: string | null;
}

const MONTH_WORDS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

/** "2026-09" as the tab name the workbook uses: "SEPTEMBER 2026". */
export function monthTitle(month: string): string {
  const [year, index] = month.split("-");
  const word = MONTH_WORDS[Number(index) - 1];
  if (!word) throw new Error(`"${month}" is not a month.`);
  return `${word} ${year}`;
}

/** Every calendar day from `from` to `to`, both ends. Empty when `to` is earlier. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** How many days a range covers, counting both ends. Zero when `to` is earlier. */
export function spanDays(from: string, to: string): number {
  return dayDiff(from, to) + 1 > 0 ? dayDiff(from, to) + 1 : 0;
}

export interface LedgerOptions {
  items: readonly LedgerItem[];
  /**
   * Every movement up to `to`, not only those inside the range: the ones before `from` are why
   * the first BEGINNING is not zero.
   */
  movements: readonly LedgerMovement[];
  /** Inclusive "YYYY-MM-DD". */
  from: string;
  /** Inclusive "YYYY-MM-DD". */
  to: string;
}

/**
 * Builds one row per item per day, in the order the workbook used: by date, then by item ID.
 *
 * Every item appears on every day of the range, including the quiet ones. That is what the
 * office's sheet does, and it is why an empty day is still countable.
 *
 * The old tab has one column per direction, so an entry is placed by the direction it moved the
 * stock and nothing else: OPENING and a positive ADJUST are receipts, DISPOSE and a negative
 * ADJUST are issues. That is the only mapping that leaves the four columns adding up.
 */
export function ledgerRows(options: LedgerOptions): LedgerRow[] {
  const { items, movements, from, to } = options;
  const days = datesBetween(from, to);
  if (days.length === 0) return [];

  const catalogue = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sorted = [...movements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Item total, and the balance of each of its batches keyed by expiry ("" = unknown).
  const balances = new Map<string, number>();
  const batches = new Map<string, Map<string, number>>();
  const moved = new Set<string>();

  const apply = (m: LedgerMovement): void => {
    let owned = batches.get(m.itemId);
    if (!owned) batches.set(m.itemId, (owned = new Map()));
    const expiry = m.expiry ?? "";
    owned.set(expiry, (owned.get(expiry) ?? 0) + m.qty);
    balances.set(m.itemId, (balances.get(m.itemId) ?? 0) + m.qty);
    moved.add(m.itemId);
  };

  for (const m of sorted) if (m.date < from) apply(m);
  const inRange = sorted.filter((m) => m.date >= from && m.date <= to);

  /** The soonest expiry among the batches that hold stock, ignoring unknown expiries. */
  const soonest = (itemId: string): string | null => {
    let best: string | null = null;
    for (const [expiry, balance] of batches.get(itemId) ?? []) {
      if (!expiry || balance <= 0) continue;
      if (best === null || expiry < best) best = expiry;
    }
    return best;
  };

  const rows: LedgerRow[] = [];
  const received = new Map<string, number>();
  const dispensed = new Map<string, number>();
  const expiryCache = new Map<string, string | null>();
  let index = 0;

  for (const day of days) {
    received.clear();
    dispensed.clear();
    while (index < inRange.length && inRange[index].date === day) {
      const m = inRange[index++];
      if (m.qty > 0) received.set(m.itemId, (received.get(m.itemId) ?? 0) + m.qty);
      else if (m.qty < 0) dispensed.set(m.itemId, (dispensed.get(m.itemId) ?? 0) - m.qty);
      apply(m);
    }

    for (const item of catalogue) {
      const ending = balances.get(item.id) ?? 0;
      // Only an item that moved can have a different expiry, so the rest reuse the answer.
      if (moved.has(item.id) || !expiryCache.has(item.id)) expiryCache.set(item.id, soonest(item.id));
      const got = received.get(item.id) ?? 0;
      const went = dispensed.get(item.id) ?? 0;
      rows.push({
        date: day,
        itemId: item.id,
        // Solved from the balance rather than snapshotted, so it cannot drift from ENDING.
        beginning: ending - got + went,
        received: got,
        dispensed: went,
        ending,
        expiry: expiryCache.get(item.id) ?? null,
      });
    }

    moved.clear();
  }

  return rows;
}

/** The grand totals of a ledger, which is what the office checks a month against by eye. */
export function ledgerTotals(rows: readonly LedgerRow[]): {
  received: number;
  dispensed: number;
  net: number;
  opening: number;
  closing: number;
} {
  let received = 0;
  let dispensed = 0;
  for (const row of rows) {
    received += row.received;
    dispensed += row.dispensed;
  }
  // Opening is the balance the first row of each item began with, so it is read off the first
  // BEGINNING per item rather than the last ENDING: a tab cut mid-history still totals correctly.
  const opening = new Map<string, number>();
  for (const row of rows) if (!opening.has(row.itemId)) opening.set(row.itemId, row.beginning);
  const openingTotal = [...opening.values()].reduce((s, v) => s + v, 0);
  const closing = new Map<string, number>(opening);
  for (const row of rows) closing.set(row.itemId, row.ending);

  return {
    received,
    dispensed,
    net: received - dispensed,
    opening: openingTotal,
    closing: [...closing.values()].reduce((s, v) => s + v, 0),
  };
}