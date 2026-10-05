// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportPlan, batchKey, splitBatchKey, type ImportPlan } from "./import-ledger.ts";
import type { ParsedWorkbook, WorkbookItem, WorkbookRow } from "./workbook.ts";

const TODAY = "2026-10-05";

function item(id: string, note = ""): WorkbookItem {
  return { id, name: id, note };
}

function row(over: Partial<WorkbookRow> & { date: string; itemId: string }): WorkbookRow {
  return {
    beginning: 0,
    received: 0,
    dispensed: 0,
    ending: 0,
    expiry: "",
    ...over,
  };
}

/** One workbook per month tab, rows given in the order the sheet lists them. */
function workbook(months: { month: string; rows: WorkbookRow[] }[], hints: ParsedWorkbook["batchHints"] = []): ParsedWorkbook {
  const ids = [...new Set(months.flatMap((m) => m.rows.map((r) => r.itemId)))];
  return {
    items: ids.map((id) => item(id)),
    months: months.map((m) => {
      const sorted = [...m.rows].sort((a, b) => (a.date < b.date ? -1 : 1));
      return {
        sheet: m.month,
        month: m.month.slice(0, 7),
        rows: sorted,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date,
      };
    }),
    sources: [],
    batchHints: hints,
    unmatched: [],
  };
}

function planFor(parsed: ParsedWorkbook, today = TODAY): ImportPlan {
  return buildImportPlan(parsed, { today });
}

function typesFor(plan: ImportPlan, itemId: string): string[] {
  return plan.transactions.filter((t) => t.itemId === itemId).map((t) => `${t.date} ${t.type} ${t.qty}`);
}

test("an item's first row with stock becomes an opening balance", () => {
  const plan = planFor(workbook([{ month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-001", beginning: 36, ending: 36, expiry: "01/2027" })] }]));
  assert.deepEqual(typesFor(plan, "MED-001"), ["2026-09-01 OPENING 36"]);
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].expiry, "2027-01-31");
  assert.equal(plan.batches[0].receivedOn, "2026-09-01");
});

test("an item that starts empty gets no opening row, because a zero quantity is not an entry", () => {
  const plan = planFor(workbook([{ month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-001", ending: 0 })] }]));
  assert.deepEqual(plan.transactions, []);
  assert.equal(plan.batches.length, 0);
});

test("received and dispensed become one signed row each, and quiet days create nothing", () => {
  const plan = planFor(workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-001", beginning: 10, ending: 10 }),
      row({ date: "2026-09-02", itemId: "MED-001", beginning: 10, received: 5, ending: 15 }),
      row({ date: "2026-09-03", itemId: "MED-001", beginning: 15, ending: 15 }), // nothing happened
      row({ date: "2026-09-04", itemId: "MED-001", beginning: 15, dispensed: 3, ending: 12 }),
    ],
  }]));
  assert.deepEqual(typesFor(plan, "MED-001"), [
    "2026-09-01 OPENING 10",
    "2026-09-02 RECEIVE 5",
    "2026-09-04 DISPENSE -3",
  ]);
  assert.equal(plan.batchBalances.get(batchKey("MED-001", null)), 12);
});

test("a month that opens at a different number becomes a visible adjustment, not a silent fix", () => {
  const plan = planFor(workbook([
    { month: "2026-01", rows: [row({ date: "2026-01-31", itemId: "MED-018", beginning: 192, ending: 192 })] },
    { month: "2026-02", rows: [row({ date: "2026-02-01", itemId: "MED-018", beginning: 200, ending: 200 })] },
  ]));
  assert.deepEqual(typesFor(plan, "MED-018"), ["2026-01-31 OPENING 192", "2026-02-01 ADJUST 8"]);
  assert.deepEqual(plan.gaps, [
    { itemId: "MED-018", date: "2026-02-01", from: 192, to: 200, difference: 8, previousMonth: "2026-01", month: "2026-02", midTab: false },
  ]);
});

test("a gap inside one tab is reported as such", () => {
  const plan = planFor(workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-001", beginning: 5, ending: 5 }),
      row({ date: "2026-09-04", itemId: "MED-001", beginning: 9, ending: 9 }),
    ],
  }]));
  assert.equal(plan.gaps.length, 1);
  assert.equal(plan.gaps[0].midTab, true);
  assert.equal(plan.gaps[0].difference, 4);
});

test("an item that joins the sheet later is listed as a late opening", () => {
  const plan = planFor(workbook([
    { month: "2026-04", rows: [row({ date: "2026-04-01", itemId: "MED-001", beginning: 5, ending: 5 })] },
    {
      month: "2026-05",
      rows: [
        row({ date: "2026-05-01", itemId: "MED-001", beginning: 5, ending: 5 }),
        row({ date: "2026-05-01", itemId: "MED-002", beginning: 12, ending: 12 }),
      ],
    },
  ]));
  assert.deepEqual(plan.lateOpenings, [{ itemId: "MED-002", date: "2026-05-01", qty: 12 }]);
  assert.equal(plan.gaps.length, 0, "a new item is not a gap");
});

test("a movement is booked against the batch whose expiry the tab recorded that day", () => {
  const plan = planFor(workbook([
    {
      month: "2026-04",
      rows: [row({ date: "2026-04-01", itemId: "MED-023", beginning: 40, ending: 40, expiry: "05/2026" })],
    },
    {
      month: "2026-05",
      rows: [
        row({ date: "2026-05-01", itemId: "MED-023", beginning: 40, ending: 40, expiry: "07/2026" }),
        row({ date: "2026-05-02", itemId: "MED-023", beginning: 40, received: 10, ending: 50, expiry: "07/2026" }),
        row({ date: "2026-05-03", itemId: "MED-023", beginning: 50, dispensed: 5, ending: 45, expiry: "07/2026" }),
      ],
    },
  ]));
  // The old batch keeps the 40 that were already on the shelf; the delivery seeds the new one.
  assert.equal(plan.batchBalances.get(batchKey("MED-023", "2026-05-31")), 40);
  assert.equal(plan.batchBalances.get(batchKey("MED-023", "2026-07-31")), 5);
  assert.equal(plan.batches.find((b) => b.expiry === "2026-07-31")?.qtyReceived, 10);
  assert.equal(plan.batches.find((b) => b.expiry === "2026-07-31")?.receivedOn, "2026-05-02");
});

test("a second batch known only from the wide tab is created empty, not guessed at", () => {
  const parsed = workbook(
    [{ month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-003", beginning: 65, ending: 65, expiry: "11/2026" })] }],
    [{ itemId: "MED-003", expiries: ["2026-11-30", "2027-08-31"], raw: ["11/2026", "8/2027"] }],
  );
  const plan = planFor(parsed);
  const hint = plan.batches.find((b) => b.expiry === "2027-08-31");
  assert.equal(hint?.hintOnly, true);
  assert.equal(hint?.qtyReceived, 0);
  assert.equal(plan.batchBalances.get(batchKey("MED-003", "2027-08-31")), 0);
  // The whole balance stays where the converted tab said it was.
  assert.equal(plan.batchBalances.get(batchKey("MED-003", "2026-11-30")), 65);
});

test("the delivery source comes from the wide tab's Additional column", () => {
  const parsed = workbook([{ month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-001", received: 10, ending: 10 })] }]);
  parsed.sources = [{ month: "2026-09", source: "HSO Alangilan" }];
  const plan = planFor(parsed);
  assert.equal(plan.transactions[0].source, "HSO Alangilan");
  assert.equal(plan.batches[0].source, "HSO Alangilan");
});

test("every month end rebuilds to the balance the workbook wrote", () => {
  const parsed = workbook([
    {
      month: "2026-08",
      rows: [
        row({ date: "2026-08-01", itemId: "MED-001", beginning: 10, ending: 10, expiry: "8/2027" }),
        row({ date: "2026-08-15", itemId: "MED-001", beginning: 10, received: 10, ending: 20, expiry: "8/2027" }),
        row({ date: "2026-08-31", itemId: "MED-001", beginning: 20, dispensed: 2, ending: 18, expiry: "8/2027" }),
      ],
    },
    {
      month: "2026-09",
      rows: [
        row({ date: "2026-09-01", itemId: "MED-001", beginning: 18, ending: 18, expiry: "8/2027" }),
        row({ date: "2026-09-16", itemId: "MED-001", beginning: 18, received: 7, ending: 25, expiry: "8/2027" }),
      ],
    },
  ]);
  const plan = planFor(parsed);
  assert.deepEqual(plan.reconciliation.mismatches, []);
  assert.equal(plan.gaps.length, 0);
  assert.deepEqual(plan.reconciliation.rows.map((r) => [r.month, r.itemId, r.expected, r.rebuilt]), [
    ["2026-08", "MED-001", 18, 18],
    ["2026-09", "MED-001", 25, 25],
  ]);
  assert.equal(plan.reconciliation.receivedInWorkbook, 17);
  assert.equal(plan.reconciliation.receivedPlanned, 17);
  assert.equal(plan.reconciliation.dispensedInWorkbook, 2);
  assert.equal(plan.reconciliation.dispensedPlanned, 2);
});

test("a row whose own arithmetic is broken is reported instead of accepted", () => {
  // The sheet says 10 + 5 - 5 = 15. Nothing the app does can produce that, so the month end
  // is listed as a mismatch for a person to look at.
  const parsed = workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-001", beginning: 10, ending: 10 }),
      row({ date: "2026-09-30", itemId: "MED-001", beginning: 10, received: 5, dispensed: 5, ending: 15 }),
    ],
  }]);
  const plan = planFor(parsed);
  assert.deepEqual(plan.reconciliation.mismatches, [{ month: "2026-09", itemId: "MED-001", expected: 15, rebuilt: 10 }]);
  // The movements themselves still add up, which is the other half of the report.
  assert.equal(plan.reconciliation.receivedPlanned, plan.reconciliation.receivedInWorkbook);
  assert.equal(plan.reconciliation.dispensedPlanned, plan.reconciliation.dispensedInWorkbook);
});

test("the cleanup lists split stock with no expiry from stock that has expired", () => {
  const parsed = workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-011", beginning: 500, ending: 500, expiry: "06/2026" }), // BIOFLU
      row({ date: "2026-09-01", itemId: "SUP-001", beginning: 10, ending: 10 }), // no expiry recorded
      row({ date: "2026-09-01", itemId: "MED-001", beginning: 4, ending: 4, expiry: "01/2028" }),
    ],
  }]);
  const plan = planFor(parsed);
  assert.deepEqual(plan.expired, [{ itemId: "MED-011", expiry: "2026-06-30", balance: 500 }]);
  assert.deepEqual(plan.noExpiry, [{ itemId: "SUP-001", expiry: null, balance: 10 }]);
  assert.equal(plan.summary.unitsOnHand, 514);
  assert.equal(plan.summary.stockedBatches, 3);
});

test("an item whose rows stop before the newest month is listed with its frozen balance", () => {
  const parsed = workbook([
    { month: "2026-08", rows: [row({ date: "2026-08-31", itemId: "MED-046", beginning: 79, ending: 79 })] },
    { month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-001", beginning: 5, ending: 5 })] },
  ]);
  const plan = planFor(parsed);
  assert.deepEqual(plan.stoppedRecording, [{ itemId: "MED-046", lastDate: "2026-08-31", balance: 79 }]);
  assert.deepEqual(plan.unusedItems, []);
});

test("a catalogue item no tab mentions is reported as unused", () => {
  const parsed = workbook([{ month: "2026-09", rows: [row({ date: "2026-09-01", itemId: "MED-001", beginning: 5, ending: 5 })] }]);
  parsed.items.push(item("MED-099"));
  assert.deepEqual(planFor(parsed).unusedItems, ["MED-099"]);
});

test("no planned quantity is ever zero, and signs follow the entry type", () => {
  const plan = planFor(workbook([
    {
      month: "2026-08",
      rows: [row({ date: "2026-08-31", itemId: "MED-001", beginning: 4, ending: 4 })],
    },
    {
      month: "2026-09",
      rows: [row({ date: "2026-09-01", itemId: "MED-001", beginning: 4, ending: 4 })],
    },
  ]));
  for (const tx of plan.transactions) {
    assert.notEqual(tx.qty, 0);
    if (tx.type === "OPENING" || tx.type === "RECEIVE") assert.ok(tx.qty > 0, `${tx.type} ${tx.qty}`);
    if (tx.type === "DISPENSE" || tx.type === "DISPOSE") assert.ok(tx.qty < 0, `${tx.type} ${tx.qty}`);
  }
});

test("a dispense that overruns its batch falls back to the batches that hold the stock", () => {
  // The office changed the recorded expiry without recording a delivery, so the new batch is
  // empty. The movement still has to come from somewhere, and the app's own rule is earliest
  // expiry first, so it comes from the older batch rather than going negative.
  const plan = planFor(workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-023", beginning: 40, ending: 40, expiry: "05/2026" }),
      row({ date: "2026-09-02", itemId: "MED-023", beginning: 40, ending: 40, expiry: "07/2026" }),
      row({ date: "2026-09-03", itemId: "MED-023", beginning: 40, dispensed: 12, ending: 28, expiry: "07/2026" }),
    ],
  }]));
  assert.deepEqual(plan.overIssued, []);
  assert.equal(plan.gaps.length, 0);
  assert.equal(plan.batchBalances.get(batchKey("MED-023", "2026-07-31")), 0);
  assert.equal(plan.batchBalances.get(batchKey("MED-023", "2026-05-31")), 28);
  assert.deepEqual(typesFor(plan, "MED-023"), ["2026-09-01 OPENING 40", "2026-09-03 DISPENSE -12"]);
});

test("a split across two batches keeps the item total and both batches whole", () => {
  const plan = planFor(workbook([
    {
      month: "2026-08",
      rows: [
        row({ date: "2026-08-01", itemId: "MED-003", beginning: 30, ending: 30, expiry: "11/2026" }),
        row({ date: "2026-08-02", itemId: "MED-003", beginning: 30, received: 20, ending: 50, expiry: "8/2027" }),
      ],
    },
    {
      month: "2026-09",
      rows: [
        row({ date: "2026-09-01", itemId: "MED-003", beginning: 50, ending: 50, expiry: "8/2027" }),
        // Takes the whole newer batch, then reaches into the older one.
        row({ date: "2026-09-02", itemId: "MED-003", beginning: 50, dispensed: 35, ending: 15, expiry: "8/2027" }),
      ],
    },
  ]));
  assert.deepEqual(plan.batchBalances.get(batchKey("MED-003", "2027-08-31")), 0);
  assert.equal(plan.batchBalances.get(batchKey("MED-003", "2026-11-30")), 15);
  assert.deepEqual(
    plan.transactions.filter((t) => t.type === "DISPENSE").map((t) => [t.expiry, t.qty]),
    [["2027-08-31", -20], ["2026-11-30", -15]],
  );
});

test("more dispensed than the item holds is reported rather than hidden", () => {
  const plan = planFor(workbook([{
    month: "2026-09",
    rows: [
      row({ date: "2026-09-01", itemId: "MED-001", beginning: 5, ending: 5, expiry: "8/2027" }),
      row({ date: "2026-09-02", itemId: "MED-001", beginning: 5, dispensed: 8, ending: -3, expiry: "8/2027" }),
    ],
  }]));
  assert.deepEqual(plan.overIssued, [{ itemId: "MED-001", date: "2026-09-02", dispensed: 8, unbooked: 3 }]);
  assert.equal(plan.batchBalances.get(batchKey("MED-001", "2027-08-31")), -3);
});

test("batchKey and splitBatchKey are opposites, including an unknown expiry", () => {
  const withExpiry = batchKey("MED-001", "2027-01-31");
  assert.deepEqual(splitBatchKey(withExpiry), { itemId: "MED-001", expiry: "2027-01-31" });
  assert.deepEqual(splitBatchKey(batchKey("MED-001", null)), { itemId: "MED-001", expiry: null });
  // Two items never share a key, even one with no expiry.
  assert.notEqual(batchKey("MED-001", null), batchKey("MED-002", null));
});