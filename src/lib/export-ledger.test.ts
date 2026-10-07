// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  datesBetween,
  LEDGER_HEADERS,
  ledgerRows,
  ledgerTotals,
  monthTitle,
  spanDays,
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