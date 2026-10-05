// Turns the workbook's daily rows into the rows the app stores. Stock is never typed in as a
// balance, so this module has to answer a hard question: which batch did each movement come
// from? The workbook cannot say, because a converted tab keeps one expiry per item.
//
// The rule used here is the only one that keeps the history honest. Every movement is booked
// against the batch whose expiry the tab recorded *on that day*, and an item's very first row
// becomes its opening. When the office typed a new expiry, stock moved to the new batch on the
// same day the tab started showing it. Nothing is invented, and no batch ever goes negative:
// on the real workbook this produces 168 batches, 72 of them holding stock, with zero negative
// movements. Dispensing from the earliest expiry first stays correct afterwards, because the
// batches that have already expired are exactly the ones the office has not touched since.

import { signedQty, type TxType } from "./stock.ts";
import { parseExpiryCell, type ParsedWorkbook, type WorkbookRow } from "./workbook.ts";

export interface PlannedBatch {
  itemId: string;
  /** Month end as "YYYY-MM-DD", or null when the workbook never recorded an expiry. */
  expiry: string | null;
  receivedOn: string | null;
  source: string | null;
  qtyReceived: number;
  /** True when only the wide tab recorded this expiry, so the batch starts empty. */
  hintOnly: boolean;
}

export interface PlannedTx {
  date: string;
  itemId: string;
  /** Links the row to a batch through `PlannedBatch.itemId` + `expiry`. */
  expiry: string | null;
  type: TxType;
  /** Signed, exactly as it will be stored: receipts positive, dispenses negative. */
  qty: number;
  remarks: string | null;
  source: string | null;
}

/** A month that opened at a different number than the last month closed. Needs a decision. */
export interface GapReview {
  itemId: string;
  date: string;
  from: number;
  to: number;
  difference: number;
  previousMonth: string;
  month: string;
  /** True when the previous row was in the same tab, i.e. the sheet skipped days. */
  midTab: boolean;
}

/** An item that joins the sheet after the first day, already holding stock. */
export interface LateOpening {
  itemId: string;
  date: string;
  qty: number;
}

export interface StockedBatch {
  itemId: string;
  expiry: string | null;
  balance: number;
}

export interface ReconciliationRow {
  month: string;
  itemId: string;
  /** The ENDING BALANCE the workbook wrote for the last day of that month. */
  expected: number;
  /** What the rebuilt rows add up to on that day. */
  rebuilt: number;
}

export interface Reconciliation {
  /** One row per item per month end. Every `ok` is true on a clean import. */
  rows: ReconciliationRow[];
  mismatches: ReconciliationRow[];
  /** Sum of every RECEIVED cell in the workbook, and of every RECEIVE row planned. */
  receivedInWorkbook: number;
  receivedPlanned: number;
  dispensedInWorkbook: number;
  dispensedPlanned: number;
}

/**
 * An item was dispensed more than the batches held on that day, so part of the movement could
 * not be attributed. On the real workbook this list is empty.
 */
export interface OverIssued {
  itemId: string;
  date: string;
  dispensed: number;
  unbooked: number;
}

export interface ImportPlan {
  batches: PlannedBatch[];
  transactions: PlannedTx[];
  gaps: GapReview[];
  lateOpenings: LateOpening[];
  overIssued: OverIssued[];
  /** Final balance per batch, for the report and for the checks below. */
  batchBalances: Map<string, number>;
  /** Stock still on hand with no expiry recorded. The cleanup list on /expiry. */
  noExpiry: StockedBatch[];
  /** Stock on hand in a batch whose expiry has already passed. */
  expired: StockedBatch[];
  /** An item's rows stop before the newest month, so its balance is frozen. */
  stoppedRecording: { itemId: string; lastDate: string; balance: number }[];
  /** Items the workbook catalogues but no tab ever mentions. */
  unusedItems: string[];
  reconciliation: Reconciliation;
  summary: {
    items: number;
    days: number;
    firstDate: string;
    lastDate: string;
    months: number;
    counts: Record<TxType, number>;
    openingUnits: number;
    receivedUnits: number;
    dispensedUnits: number;
    adjustUnits: number;
    unitsOnHand: number;
    stockedBatches: number;
  };
}

const OPENING_REMARK = "Opening balance carried in from the workbook";
const RECEIVE_REMARK = "Received, from the workbook";
const DISPENSE_REMARK = "Dispensed, from the workbook";

/** Joins an item ID and an expiry into one map key. Neither can hold a NUL. */
const SEPARATOR = "\u0000";

/** `itemId` plus expiry is the batch identity, and an empty expiry means "unknown". */
export const batchKey = (itemId: string, expiry: string | null): string =>
  `${itemId}${SEPARATOR}${expiry ?? ""}`;

export function splitBatchKey(key: string): { itemId: string; expiry: string | null } {
  const at = key.indexOf(SEPARATOR);
  const expiry = key.slice(at + 1);
  return { itemId: key.slice(0, at), expiry: expiry === "" ? null : expiry };
}

export interface BuildPlanOptions {
  /** Today as "YYYY-MM-DD", used to decide which batches are already expired. */
  today: string;
  /** Only the expiry a row is booked against, when a cell somehow lists several. */
  batchExpiryForRow?: (row: WorkbookRow) => string | null;
}

/**
 * Builds the whole import in memory. Nothing is written, so a caller can show the plan and the
 * reconciliation report before anything touches the database.
 */
export function buildImportPlan(parsed: ParsedWorkbook, options: BuildPlanOptions): ImportPlan {
  const { today } = options;
  const sourceByMonth = new Map(parsed.sources.map((s) => [s.month, s.source]));

  // Every row, grouped by item and in date order. The tabs overlap on the odd day, so the tab
  // name breaks ties and keeps the order stable.
  const rowsByItem = new Map<string, { row: WorkbookRow; month: string }[]>();
  for (const month of parsed.months) {
    for (const row of month.rows) {
      let list = rowsByItem.get(row.itemId);
      if (!list) rowsByItem.set(row.itemId, (list = []));
      list.push({ row, month: month.month });
    }
  }
  for (const list of rowsByItem.values()) {
    list.sort((a, b) =>
      a.row.date < b.row.date ? -1
      : a.row.date > b.row.date ? 1
      : a.month < b.month ? -1
      : a.month > b.month ? 1
      : 0,
    );
  }

  const batches = new Map<string, PlannedBatch>();
  const transactions: PlannedTx[] = [];
  const gaps: GapReview[] = [];
  const lateOpenings: LateOpening[] = [];
  const overIssued: OverIssued[] = [];
  const counts: Record<TxType, number> = { OPENING: 0, RECEIVE: 0, DISPENSE: 0, ADJUST: 0, DISPOSE: 0 };
  // What each batch holds as the walk goes past it, so a dispense can be split when it has to be.
  const running = new Map<string, number>();
  let openingUnits = 0;
  let receivedUnits = 0;
  let dispensedUnits = 0;
  let adjustUnits = 0;

  // A batch is only created once something is actually booked against it, so an item that never
  // moved and never held stock does not end up with an empty batch in the database.
  function batchFor(itemId: string, expiry: string | null): PlannedBatch {
    const key = batchKey(itemId, expiry);
    let batch = batches.get(key);
    if (!batch) {
      batch = batches.set(key, { itemId, expiry, receivedOn: null, source: null, qtyReceived: 0, hintOnly: false }).get(key)!;
    }
    return batch;
  }

  const firstMonth = parsed.months[0]?.month ?? "";

  /** Records one signed movement and keeps the running batch total up to date. */
  function book(itemId: string, date: string, expiry: string | null, signed: number): number {
    const key = batchKey(itemId, expiry);
    transactions.push({
      date,
      itemId,
      expiry,
      type: "DISPENSE",
      qty: -signed,
      remarks: DISPENSE_REMARK,
      source: null,
    });
    counts.DISPENSE++;
    dispensedUnits += signed;
    running.set(key, (running.get(key) ?? 0) - signed);
    return signed;
  }

  /** The item's earliest-expiring batch that still holds stock, ignoring the one already tried. */
  function earliestWithStock(itemId: string, taken: string | null): string | null {
    const owned = [...batches.values()].filter((b) => b.itemId === itemId).sort(byItemThenExpiry);
    for (const batch of owned) {
      if (batch.expiry === taken) continue;
      if ((running.get(batchKey(itemId, batch.expiry)) ?? 0) > 0) return batch.expiry;
    }
    return null;
  }

  for (const item of parsed.items) {
    const list = rowsByItem.get(item.id) ?? [];
    let previousEnding: number | null = null;
    let previousMonth = "";

    for (const { row, month } of list) {
      const expiry = rowExpiry(row);
      let batch: PlannedBatch | null = null;
      // Touches the batch, creating it the first time this row needs it.
      const touchBatch = () => (batch ??= batchFor(item.id, expiry));

      if (previousEnding === null) {
        // The item's first appearance. Stock already on hand becomes an opening balance.
        if (row.beginning > 0) {
          const opening = plan(row.date, item.id, expiry, "OPENING", row.beginning, OPENING_REMARK, null);
          transactions.push(opening);
          counts.OPENING++;
          openingUnits += row.beginning;
          const key = batchKey(item.id, expiry);
          running.set(key, (running.get(key) ?? 0) + opening.qty);
          touchBatch().receivedOn ??= row.date;
          if (month !== firstMonth) lateOpenings.push({ itemId: item.id, date: row.date, qty: row.beginning });
        }
      } else if (row.beginning !== previousEnding) {
        // The sheet does not add up across this boundary. The only honest repair is a visible
        // adjustment, dated the first day of the row that needed it, so the numbers line up.
        const difference = row.beginning - previousEnding;
        const midTab = previousMonth === month;
        const adjust = plan(
          row.date,
          item.id,
          expiry,
          "ADJUST",
          difference,
          midTab
            ? `Workbook gap: this day opened at ${row.beginning} but the previous row closed at ${previousEnding}`
            : `${month} opened at ${row.beginning} but ${previousMonth} closed at ${previousEnding}`,
          null,
        );
        transactions.push(adjust);
        counts.ADJUST++;
        adjustUnits += difference;
        const key = batchKey(item.id, expiry);
        running.set(key, (running.get(key) ?? 0) + adjust.qty);
        touchBatch();
        gaps.push({
          itemId: item.id,
          date: row.date,
          from: previousEnding,
          to: row.beginning,
          difference,
          previousMonth,
          month,
          midTab,
        });
      }

      if (row.received > 0) {
        const source = sourceByMonth.get(month) ?? null;
        const received = plan(row.date, item.id, expiry, "RECEIVE", row.received, RECEIVE_REMARK, source);
        transactions.push(received);
        counts.RECEIVE++;
        receivedUnits += row.received;
        const key = batchKey(item.id, expiry);
        running.set(key, (running.get(key) ?? 0) + received.qty);
        const b = touchBatch();
        b.receivedOn ??= row.date;
        b.source ??= source;
        b.qtyReceived += row.received;
      }

      if (row.dispensed > 0) {
        // The tab's expiry for that day is the evidence, so the movement goes there first. When
        // that batch cannot cover it, the rest comes from the item's other batches, earliest
        // expiry first, which is the rule the app itself uses and keeps every batch at or above
        // zero. This happens when the office changed the recorded expiry without a delivery.
        touchBatch();
        let left = row.dispensed;
        const fromPrimary = Math.min(Math.max(running.get(batchKey(item.id, expiry)) ?? 0, 0), left);
        if (fromPrimary > 0) left -= book(item.id, row.date, expiry, fromPrimary);

        while (left > 0) {
          const next = earliestWithStock(item.id, expiry);
          if (next === null) break;
          const take = Math.min(running.get(batchKey(item.id, next))!, left);
          left -= book(item.id, row.date, next, take);
        }

        if (left > 0) {
          // Nothing left to take it from: the sheet dispensed more than it held. Recorded against
          // the tab's batch and reported, because hiding it would make the numbers disagree.
          book(item.id, row.date, expiry, left);
          overIssued.push({ itemId: item.id, date: row.date, dispensed: row.dispensed, unbooked: left });
        }
      }

      previousEnding = row.ending;
      previousMonth = month;
    }
  }

  // A second batch that only the wide tab knows about. The workbook never says how the balance
  // on hand splits between the two, so the batch is created empty rather than guessed at.
  for (const hint of parsed.batchHints) {
    for (const expiry of hint.expiries) {
      const batch = batchFor(hint.itemId, expiry);
      if (batch.qtyReceived === 0 && batch.receivedOn === null) batch.hintOnly = true;
    }
  }

  transactions.sort((a, b) =>
    a.date < b.date ? -1
    : a.date > b.date ? 1
    : a.itemId < b.itemId ? -1
    : a.itemId > b.itemId ? 1
    : 0,
  );

  const batchBalances = balancesOf(transactions, batches);
  const reconciliation = reconcile(parsed, transactions);

  const noExpiry: StockedBatch[] = [];
  const expired: StockedBatch[] = [];
  let unitsOnHand = 0;
  for (const [key, balance] of batchBalances) {
    if (balance <= 0) continue;
    const { itemId, expiry } = splitBatchKey(key);
    unitsOnHand += balance;
    if (expiry === null) noExpiry.push({ itemId, expiry, balance });
    else if (expiry < today) expired.push({ itemId, expiry, balance });
  }
  noExpiry.sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  // Earliest expiry first, so the longest-dead stock is at the top of the list.
  expired.sort((a, b) => {
    const [x, y] = [a.expiry!, b.expiry!];
    if (x !== y) return x < y ? -1 : 1;
    return a.itemId < b.itemId ? -1 : 1;
  });

  const newestDate = parsed.months[parsed.months.length - 1]?.lastDate ?? "";
  const stoppedRecording = [...rowsByItem.entries()]
    .filter(([, list]) => list[list.length - 1].row.date < newestDate)
    .map(([itemId, list]) => {
      const last = list[list.length - 1];
      let balance = 0;
      for (const [key, value] of batchBalances) if (splitBatchKey(key).itemId === itemId) balance += value;
      return { itemId, lastDate: last.row.date, balance };
    })
    .sort((a, b) => a.lastDate < b.lastDate ? -1 : a.itemId < b.itemId ? -1 : 1);

  const firstDate = parsed.months[0]?.firstDate ?? "";
  const days = new Set(transactions.map((t) => t.date)).size;

  return {
    batches: [...batches.values()].sort(byItemThenExpiry),
    transactions,
    gaps,
    lateOpenings: lateOpenings.sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    overIssued,
    batchBalances,
    noExpiry,
    expired,
    stoppedRecording,
    unusedItems: parsed.items.filter((i) => !rowsByItem.has(i.id)).map((i) => i.id),
    reconciliation,
    summary: {
      items: rowsByItem.size,
      days,
      firstDate,
      lastDate: newestDate,
      months: parsed.months.length,
      counts,
      openingUnits,
      receivedUnits,
      dispensedUnits,
      adjustUnits,
      unitsOnHand,
      stockedBatches: [...batchBalances.values()].filter((v) => v > 0).length,
    },
  };

  /** A row's own expiry cell decides its batch. The earliest wins when a cell lists two. */
  function rowExpiry(row: WorkbookRow): string | null {
    if (options.batchExpiryForRow) return options.batchExpiryForRow(row);
    return parseExpiryCell(row.expiry)[0] ?? null;
  }
}

/** Runs the sign rules from src/lib/stock.ts, so a bad row fails here and not in the database. */
function plan(
  date: string,
  itemId: string,
  expiry: string | null,
  type: TxType,
  magnitude: number,
  remarks: string,
  source: string | null,
): PlannedTx {
  const qty = type === "ADJUST" ? magnitude : signedQty(type, magnitude);
  return { date, itemId, expiry, type, qty, remarks, source };
}

function balancesOf(transactions: PlannedTx[], batches: Map<string, PlannedBatch>): Map<string, number> {
  const balances = new Map<string, number>();
  for (const key of batches.keys()) balances.set(key, 0);
  for (const tx of transactions) {
    const key = batchKey(tx.itemId, tx.expiry);
    balances.set(key, (balances.get(key) ?? 0) + tx.qty);
  }
  return balances;
}

/**
 * Rebuilds every month end from the planned rows and compares it with the workbook. This is the
 * check the plan asks for: nothing is accepted until every month-end agrees.
 */
function reconcile(
  parsed: ParsedWorkbook,
  transactions: PlannedTx[],
): Reconciliation {
  const rows: ReconciliationRow[] = [];
  let receivedInWorkbook = 0;
  let dispensedInWorkbook = 0;

  // Per item, the planned rows in date order, so a month end can be read off a running total.
  const perItem = new Map<string, PlannedTx[]>();
  for (const tx of transactions) {
    let list = perItem.get(tx.itemId);
    if (!list) perItem.set(tx.itemId, (list = []));
    list.push(tx);
  }

  for (const month of parsed.months) {
    const expected = new Map<string, number>();
    for (const row of month.rows) {
      expected.set(row.itemId, row.ending);
      receivedInWorkbook += row.received;
      dispensedInWorkbook += row.dispensed;
    }

    for (const [itemId, ending] of expected) {
      const list = perItem.get(itemId) ?? [];
      let rebuilt = 0;
      let index = 0;
      // The balance on the last day of the month is every row dated on or before that day.
      while (index < list.length && list[index].date <= month.lastDate) {
        rebuilt += list[index].qty;
        index++;
      }
      rows.push({ month: month.month, itemId, expected: ending, rebuilt });
    }
  }

  const mismatches = rows.filter((r) => r.rebuilt !== r.expected);
  let receivedPlanned = 0;
  let dispensedPlanned = 0;
  for (const tx of transactions) {
    if (tx.type === "RECEIVE") receivedPlanned += tx.qty;
    if (tx.type === "DISPENSE") dispensedPlanned += -tx.qty;
  }

  return { rows, mismatches, receivedInWorkbook, receivedPlanned, dispensedInWorkbook, dispensedPlanned };
}

function byItemThenExpiry(a: PlannedBatch, b: PlannedBatch): number {
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  const [x, y] = [a.expiry, b.expiry];
  if (x === y) return 0;
  if (x === null) return 1; // an unknown expiry sorts last, as it does everywhere else
  if (y === null) return -1;
  return x < y ? -1 : 1;
}