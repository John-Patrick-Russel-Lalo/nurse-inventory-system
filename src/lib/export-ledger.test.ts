// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  datesBetween,
  formatExpiry,
  LEDGER_HEADERS,
  ledgerRows,
  ledgerTotals,
  monthDays,
  monthTitle,
  recordedMonths,
  spanDays,
  wideMonthSheet,
  type LedgerItem,
  type LedgerMovement,
} from "./export-ledger.ts";

const ITEMS: LedgerItem[] = [
  { id: "MED-001", name: "PARACETAMOL", variant: null },
  { id: "SUP-002", name: "GLOVES", variant: "LATEX" },
];

function row(
  date: string,
  itemId: string,
  beginning: number,
  received: number,
  dispensed: number,
  ending: number,
  expiry: string | null = null,
) {
  return { date, itemId, beginning, received, dispensed, ending, expiry };
}

test("datesBetween covers both ends and can be empty", () => {
  assert.deepEqual(datesBetween("2026-09-01", "2026-09-03"), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.deepEqual(datesBetween("2026-09-03", "2026-09-03"), ["2026-09-03"]);
  assert.deepEqual(datesBetween("2026-09-04", "2026-09-01"), []);
  assert.equal(spanDays("2026-09-01", "2026-09-30"), 30);
  assert.equal(spanDays("2026-09-30", "2026-09-01"), 0);
});

test("datesBetween crosses a month and a leap day", () => {
  assert.equal(datesBetween("2028-02-27", "2028-03-01").length, 4);
  assert.deepEqual(datesBetween("2028-02-28", "2028-02-29"), ["2028-02-28", "2028-02-29"]);
});

test("monthTitle spells out the month the way the workbook names its tabs", () => {
  assert.equal(monthTitle("2026-09"), "SEPTEMBER 2026");
  assert.equal(monthTitle("2025-02"), "FEBRUARY 2025");
  assert.equal(monthTitle("2026-01"), "JANUARY 2026");
});

test("the header row is the one the workbook reader expects", () => {
  assert.deepEqual([...LEDGER_HEADERS], [
    "DATE",
    "ITEM ID",
    "BEGINNING BALANCE",
    "RECEIVED",
    "DISPENSED",
    "ENDING BALANCE",
    "EXPIRATION DATE",
  ]);
});

test("a quiet range is still one row per item per day, all zero", () => {
  const rows = ledgerRows({ items: ITEMS, movements: [], from: "2026-09-01", to: "2026-09-02" });
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => [r.date, r.itemId]),
    [
      ["2026-09-01", "MED-001"],
      ["2026-09-01", "SUP-002"],
      ["2026-09-02", "MED-001"],
      ["2026-09-02", "SUP-002"],
    ],
  );
  assert.ok(rows.every((r) => r.beginning === 0 && r.received === 0 && r.dispensed === 0 && r.ending === 0));
});

test("the first BEGINNING carries in the stock that arrived before the range", () => {
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-08-01", itemId: "MED-001", qty: 100, expiry: "2027-08-31" },
      { date: "2026-08-20", itemId: "MED-001", qty: -30, expiry: "2027-08-31" },
    ],
    from: "2026-09-01",
    to: "2026-09-01",
  });
  assert.deepEqual(rows[0], row("2026-09-01", "MED-001", 70, 0, 0, 70, "2027-08-31"));
});

test("a dispense lands in DISPENSED and pulls BEGINNING up to match", () => {
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-09-01", itemId: "MED-001", qty: 50, expiry: "2027-08-31" },
      { date: "2026-09-02", itemId: "MED-001", qty: -12, expiry: "2027-08-31" },
    ],
    from: "2026-09-01",
    to: "2026-09-02",
  });
  assert.deepEqual(rows[0], row("2026-09-01", "MED-001", 0, 50, 0, 50, "2027-08-31"));
  assert.deepEqual(rows[1], row("2026-09-02", "MED-001", 50, 0, 12, 38, "2027-08-31"));
});

test("every entry is placed by the direction it moved the stock", () => {
  // OPENING and a positive ADJUST are receipts; DISPOSE and a negative ADJUST are issues.
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-09-01", itemId: "MED-001", qty: 20, expiry: null },
      { date: "2026-09-01", itemId: "MED-001", qty: -4, expiry: null },
      { date: "2026-09-01", itemId: "MED-001", qty: 3, expiry: null },
      { date: "2026-09-01", itemId: "MED-001", qty: -2, expiry: null },
      { date: "2026-09-01", itemId: "MED-001", qty: -5, expiry: null },
    ],
    from: "2026-09-01",
    to: "2026-09-01",
  });
  assert.deepEqual(rows, [row("2026-09-01", "MED-001", 0, 23, 11, 12)]);
});

test("every row adds up: BEGINNING + RECEIVED - DISPENSED = ENDING", () => {
  const movements: LedgerMovement[] = [];
  // Two items, two batches, a fortnight of entries in a deliberately jumbled order.
  for (const [i, date] of ["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-14"].entries()) {
    movements.push({ date, itemId: "MED-001", qty: (i + 1) * 10, expiry: "2026-11-30" });
    movements.push({ date, itemId: "MED-001", qty: -(i + 1) * 3, expiry: "2027-05-31" });
    movements.push({ date, itemId: "SUP-002", qty: -(i + 1), expiry: "2026-12-31" });
    movements.push({ date, itemId: "SUP-002", qty: i === 2 ? 7 : -1, expiry: null });
  }
  const rows = ledgerRows({ items: ITEMS, movements, from: "2026-09-01", to: "2026-09-14" });
  assert.equal(rows.length, 2 * 14);
  for (const r of rows) {
    assert.equal(r.beginning + r.received - r.dispensed, r.ending, `${r.date} ${r.itemId}`);
    assert.ok(r.received >= 0 && r.dispensed >= 0);
  }
});

test("movements after the range never change a row inside it", () => {
  const movements = [
    { date: "2026-09-02", itemId: "MED-001", qty: 40, expiry: null },
    { date: "2026-09-30", itemId: "MED-001", qty: -900, expiry: null },
    { date: "2026-10-01", itemId: "MED-001", qty: 500, expiry: null },
  ];
  const rows = ledgerRows({ items: [ITEMS[0]], movements, from: "2026-09-01", to: "2026-09-03" });
  assert.deepEqual(rows[2], row("2026-09-03", "MED-001", 40, 0, 0, 40));
  assert.equal(ledgerTotals(rows).closing, 40);
});

test("EXPIRATION DATE is the soonest expiry in stock, and unknown expiries sort last", () => {
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-09-01", itemId: "MED-001", qty: 10, expiry: "2027-08-31" },
      { date: "2026-09-01", itemId: "MED-001", qty: 10, expiry: "2026-11-30" },
      { date: "2026-09-01", itemId: "MED-001", qty: 10, expiry: null },
    ],
    from: "2026-09-01",
    to: "2026-09-03",
  });
  assert.equal(rows[0].expiry, "2026-11-30");
  assert.equal(rows[2].expiry, "2026-11-30");
});

test("emptying the soonest batch moves the expiry date to the next one", () => {
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-09-01", itemId: "MED-001", qty: 10, expiry: "2026-11-30" },
      { date: "2026-09-01", itemId: "MED-001", qty: 20, expiry: "2027-08-31" },
      { date: "2026-09-02", itemId: "MED-001", qty: -10, expiry: "2026-11-30" },
      { date: "2026-09-03", itemId: "MED-001", qty: -20, expiry: "2027-08-31" },
    ],
    from: "2026-09-01",
    to: "2026-09-04",
  });
  assert.equal(rows[0].expiry, "2026-11-30", "the soonest batch is stocked");
  assert.equal(rows[1].expiry, "2027-08-31", "emptying it leaves the later one in stock");
  assert.equal(rows[2].expiry, null, "nothing left in stock, so no date to report");
  assert.equal(rows[2].ending, 0);
});

test("stock with no expiry at all leaves the date blank rather than guessing one", () => {
  const rows = ledgerRows({
    items: [ITEMS[1]],
    movements: [{ date: "2026-09-01", itemId: "SUP-002", qty: 40, expiry: null }],
    from: "2026-09-01",
    to: "2026-09-01",
  });
  assert.deepEqual(rows, [row("2026-09-01", "SUP-002", 0, 40, 0, 40, null)]);
});

test("items are listed by ID within a day, whatever order the catalogue arrived in", () => {
  const reversed = [...ITEMS].reverse();
  const rows = ledgerRows({ items: reversed, movements: [], from: "2026-09-01", to: "2026-09-01" });
  assert.deepEqual(rows.map((r) => r.itemId), ["MED-001", "SUP-002"]);
});

test("ledgerTotals adds a whole month up and agrees with the last ENDING", () => {
  const rows = ledgerRows({
    items: ITEMS,
    movements: [
      { date: "2026-08-31", itemId: "MED-001", qty: 30, expiry: "2027-08-31" },
      { date: "2026-09-02", itemId: "MED-001", qty: 20, expiry: "2027-08-31" },
      { date: "2026-09-05", itemId: "MED-001", qty: -8, expiry: "2027-08-31" },
      { date: "2026-09-09", itemId: "SUP-002", qty: 5, expiry: null },
      { date: "2026-09-09", itemId: "SUP-002", qty: -2, expiry: null },
    ],
    from: "2026-09-01",
    to: "2026-09-30",
  });

  const totals = ledgerTotals(rows);
  assert.equal(totals.opening, 30, "stock carried in from August");
  assert.equal(totals.received, 25);
  assert.equal(totals.dispensed, 10);
  assert.equal(totals.net, 15);
  assert.equal(totals.closing, 45, "30 carried in, plus the month's net 15");
});

test("ledgerTotals reads opening off the first row of each item, so a cut range still works", () => {
  const rows = ledgerRows({
    items: [ITEMS[0]],
    movements: [
      { date: "2026-09-01", itemId: "MED-001", qty: 12, expiry: null },
      { date: "2026-09-02", itemId: "MED-001", qty: -3, expiry: null },
    ],
    from: "2026-09-10",
    to: "2026-09-20",
  });
  const totals = ledgerTotals(rows);
  assert.equal(totals.opening, 9);
  assert.equal(totals.received, 0);
  assert.equal(totals.closing, 9);
});

test("monthDays is every calendar day, weekend included", () => {
  assert.equal(monthDays("2026-09").length, 30);
  assert.equal(monthDays("2026-02").length, 28);
  assert.equal(monthDays("2028-02").length, 29, "a leap year keeps its 29th");
  assert.equal(monthDays("2026-09")[0], "2026-09-01");
  assert.equal(monthDays("2026-09").at(-1), "2026-09-30");
});

test("recordedMonths keeps only the months that hold an entry, leaving a gap month out", () => {
  const movements = [
    { date: "2026-08-31", itemId: "MED-001", qty: 30, expiry: null },
    { date: "2026-09-05", itemId: "MED-001", qty: -2, expiry: null },
    { date: "2026-11-02", itemId: "MED-001", qty: 10, expiry: null },
  ];
  assert.deepEqual(recordedMonths("2026-08", "2026-11", movements), ["2026-08", "2026-09", "2026-11"]);
  assert.deepEqual(recordedMonths("2026-08", "2026-08", movements), ["2026-08"]);
});

test("formatExpiry writes a month and a year the way the workbook does", () => {
  assert.equal(formatExpiry("2027-01-31"), "01/2027");
  assert.equal(formatExpiry("2026-11-30"), "11/2026");
  assert.equal(formatExpiry(null), null);
});

test("the wide sheet lays out NAME, two expiries and a day pair, and names the tab with an s", () => {
  const sheet = wideMonthSheet({ items: ITEMS, movements: [], month: "2026-09" });
  assert.equal(sheet.sheet, "SEPTEMBER 2026s");
  assert.equal(sheet.title, "MEDICINE AND SUPPLY INVENTORY (2026)");
  assert.equal(sheet.headers.length, 4 + 30 * 2 + 2);
  assert.deepEqual(sheet.headers.slice(0, 6), [
    null,
    "NAME",
    "EXPIRATION DATE",
    "EXPIRATION DATE",
    "STARTING BALANCE SEPTEMBER 1, 2026",
    "DISPENSED: 09/01",
  ]);
  assert.deepEqual(sheet.headers.slice(-2), ["BALANCE", "MONTH-END BALANCE (SEPTEMBER)"]);
});

test("the wide sheet carries balances across days and lists one row per item", () => {
  const movements: LedgerMovement[] = [
    { date: "2026-08-31", itemId: "MED-001", qty: 30, expiry: "2027-08-31" },
    { date: "2026-09-02", itemId: "MED-001", qty: 20, expiry: "2026-11-30" },
    { date: "2026-09-05", itemId: "MED-001", qty: -8, expiry: "2026-11-30" },
    { date: "2026-09-09", itemId: "SUP-002", qty: 5, expiry: "2026-12-31" },
    { date: "2026-09-09", itemId: "SUP-002", qty: -2, expiry: null },
  ];
  const sheet = wideMonthSheet({ items: ITEMS, movements, month: "2026-09" });
  assert.deepEqual(sheet.rows.map((r) => [r.index, r.name]), [
    [1, "PARACETAMOL"],
    [2, "GLOVES (LATEX)"],
  ]);

  const med = sheet.rows[0];
  assert.equal(med.days.length, 30);
  assert.deepEqual(med.days[0], { beginning: 30, dispensed: 0 }, "August's 30 is carried in");
  assert.deepEqual(med.days[1], { beginning: 30, dispensed: 0 }, "the receipt does not hide the opening");
  assert.deepEqual(med.days[2], { beginning: 50, dispensed: 0 }, "the receipt lifts the next day's start");
  assert.deepEqual(med.days[4], { beginning: 50, dispensed: 8 }, "the dispense is the day's own column");
  assert.equal(med.balance, 42);
  assert.deepEqual(med.expiries, ["2026-11-30", "2027-08-31"], "the two soonest batches still in stock");

  const gloves = sheet.rows[1];
  assert.deepEqual(gloves.expiries, ["2026-12-31"], "the unknown-expiry batch is not named as a date");
  assert.equal(gloves.balance, 3);
});
