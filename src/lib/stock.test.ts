// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateFefo,
  assertBatchStaysNonNegative,
  batchBalances,
  canVoid,
  checkEntryDate,
  daysBetween,
  endOfMonth,
  expiryStatus,
  isExpired,
  isLowStock,
  itemBalance,
  parseExpiry,
  signedQty,
  StockError,
  validateAllocations,
  type BatchStock,
  type Tx,
} from "./stock.ts";

const TODAY = "2026-10-05";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof StockError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

test("signedQty applies the sign rules per type", () => {
  assert.equal(signedQty("RECEIVE", 10), 10);
  assert.equal(signedQty("OPENING", 5), 5);
  assert.equal(signedQty("DISPENSE", 3), -3);
  assert.equal(signedQty("DISPOSE", 7), -7);
  assert.equal(signedQty("ADJUST", -4), -4);
  assert.equal(signedQty("ADJUST", 4), 4);
});

test("signedQty rejects zero, fractions and wrong signs", () => {
  assert.equal(codeOf(() => signedQty("RECEIVE", 0)), "INVALID_QTY");
  assert.equal(codeOf(() => signedQty("RECEIVE", 1.5)), "INVALID_QTY");
  assert.equal(codeOf(() => signedQty("RECEIVE", -2)), "INVALID_QTY");
  assert.equal(codeOf(() => signedQty("DISPENSE", -2)), "INVALID_QTY");
  assert.equal(codeOf(() => signedQty("ADJUST", 0)), "INVALID_QTY");
});

test("batchBalances sums per batch and ignores voided entries", () => {
  const txs: Tx[] = [
    { batchId: 1, type: "OPENING", qty: 100, voided: false },
    { batchId: 1, type: "DISPENSE", qty: -30, voided: false },
    { batchId: 1, type: "DISPENSE", qty: -50, voided: true },
    { batchId: 2, type: "RECEIVE", qty: 20, voided: false },
    { batchId: 2, type: "ADJUST", qty: -2, voided: false },
  ];
  const b = batchBalances(txs);
  assert.equal(b.get(1), 70);
  assert.equal(b.get(2), 18);
  assert.equal(b.get(3), undefined);
});

test("itemBalance adds up its batches", () => {
  const batches: BatchStock[] = [
    { batchId: 1, expiry: "2027-01-31", balance: 36 },
    { batchId: 2, expiry: null, balance: 4 },
  ];
  assert.equal(itemBalance(batches), 40);
  assert.equal(itemBalance([]), 0);
});

test("isLowStock uses the reorder level, and is off without one", () => {
  assert.equal(isLowStock(10, 10), true);
  assert.equal(isLowStock(11, 10), false);
  assert.equal(isLowStock(0, 10), true);
  assert.equal(isLowStock(0, null), false);
  assert.equal(isLowStock(0, 0), false);
});

test("dates: endOfMonth, daysBetween and invalid input", () => {
  assert.equal(endOfMonth(2027, 1), "2027-01-31");
  assert.equal(endOfMonth(2028, 2), "2028-02-29");
  assert.equal(endOfMonth(2027, 2), "2027-02-28");
  assert.equal(daysBetween("2026-10-05", "2026-10-08"), 3);
  assert.equal(daysBetween("2026-10-08", "2026-10-05"), -3);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.throws(() => daysBetween("2026-02-30", "2026-03-01"));
  assert.throws(() => daysBetween("10/05/2026", "2026-03-01"));
});

test("parseExpiry reads the workbook's formats into month ends", () => {
  assert.equal(parseExpiry("8/2027"), "2027-08-31");
  assert.equal(parseExpiry("01/2027"), "2027-01-31");
  assert.equal(parseExpiry("02/2028"), "2028-02-29");
  assert.equal(parseExpiry("2028-01-01"), "2028-01-31");
  assert.equal(parseExpiry(" 3/2027 "), "2027-03-31");
  assert.equal(parseExpiry(""), null);
  assert.equal(parseExpiry(null), null);
  assert.equal(parseExpiry("13/2027"), null);
  assert.equal(parseExpiry("soon"), null);
});

test("expiry status and isExpired", () => {
  assert.equal(expiryStatus(null, TODAY), "NO_EXPIRY");
  assert.equal(expiryStatus("2026-10-04", TODAY), "EXPIRED");
  assert.equal(expiryStatus("2026-10-05", TODAY), "DAYS_30"); // expires today, still usable today
  assert.equal(expiryStatus("2026-11-04", TODAY), "DAYS_30");
  assert.equal(expiryStatus("2026-11-05", TODAY), "DAYS_60");
  assert.equal(expiryStatus("2026-12-04", TODAY), "DAYS_60");
  assert.equal(expiryStatus("2026-12-05", TODAY), "DAYS_90");
  assert.equal(expiryStatus("2027-01-03", TODAY), "DAYS_90");
  assert.equal(expiryStatus("2027-01-04", TODAY), "OK");
  assert.equal(isExpired("2026-10-05", TODAY), false);
  assert.equal(isExpired("2026-10-04", TODAY), true);
  assert.equal(isExpired(null, TODAY), false);
});

test("allocateFefo takes the earliest expiry first and splits across batches", () => {
  const batches: BatchStock[] = [
    { batchId: 2, expiry: "2027-08-31", balance: 70 },
    { batchId: 1, expiry: "2026-11-30", balance: 1 },
  ];
  assert.deepEqual(allocateFefo(batches, 1, TODAY), [{ batchId: 1, qty: 1 }]);
  assert.deepEqual(allocateFefo(batches, 11, TODAY), [
    { batchId: 1, qty: 1 },
    { batchId: 2, qty: 10 },
  ]);
});

test("allocateFefo skips expired and empty batches and uses unknown expiry last", () => {
  const batches: BatchStock[] = [
    { batchId: 1, expiry: "2026-06-30", balance: 500 }, // expired
    { batchId: 2, expiry: null, balance: 5 },
    { batchId: 3, expiry: "2027-03-31", balance: 0 }, // empty
    { batchId: 4, expiry: "2027-05-31", balance: 3 },
  ];
  assert.deepEqual(allocateFefo(batches, 4, TODAY), [
    { batchId: 4, qty: 3 },
    { batchId: 2, qty: 1 },
  ]);
});

test("allocateFefo refuses when usable stock is short, even if expired stock exists", () => {
  const batches: BatchStock[] = [
    { batchId: 1, expiry: "2026-06-30", balance: 500 },
    { batchId: 2, expiry: "2027-05-31", balance: 3 },
  ];
  assert.equal(codeOf(() => allocateFefo(batches, 4, TODAY)), "INSUFFICIENT_STOCK");
  assert.equal(codeOf(() => allocateFefo(batches, 0, TODAY)), "INVALID_QTY");
});

test("allocateFefo does not mutate its input", () => {
  const batches: BatchStock[] = [
    { batchId: 2, expiry: "2027-08-31", balance: 70 },
    { batchId: 1, expiry: "2026-11-30", balance: 1 },
  ];
  const copy = JSON.parse(JSON.stringify(batches));
  allocateFefo(batches, 5, TODAY);
  assert.deepEqual(batches, copy);
});

test("validateAllocations accepts a valid manual split and rejects bad ones", () => {
  const batches: BatchStock[] = [
    { batchId: 1, expiry: "2026-11-30", balance: 4 },
    { batchId: 2, expiry: "2027-08-31", balance: 10 },
  ];
  validateAllocations(batches, [{ batchId: 2, qty: 6 }], 6);
  validateAllocations(
    batches,
    [
      { batchId: 1, qty: 2 },
      { batchId: 2, qty: 3 },
    ],
    5,
  );
  assert.equal(codeOf(() => validateAllocations(batches, [{ batchId: 1, qty: 5 }], 5)), "NEGATIVE_BATCH");
  assert.equal(codeOf(() => validateAllocations(batches, [{ batchId: 9, qty: 1 }], 1)), "UNKNOWN_BATCH");
  assert.equal(codeOf(() => validateAllocations(batches, [{ batchId: 1, qty: 2 }], 3)), "INVALID_QTY");
  assert.equal(
    codeOf(() =>
      validateAllocations(
        batches,
        [
          { batchId: 1, qty: 1 },
          { batchId: 1, qty: 1 },
        ],
        2,
      ),
    ),
    "INVALID_QTY",
  );
});

test("assertBatchStaysNonNegative", () => {
  assertBatchStaysNonNegative(10, -10, 1);
  assertBatchStaysNonNegative(10, 5, 1);
  assert.equal(codeOf(() => assertBatchStaysNonNegative(10, -11, 1)), "NEGATIVE_BATCH");
});

test("checkEntryDate: nurse window, future dates, closed months, admin backdating", () => {
  const closed = new Set(["2026-08"]);
  const base = { today: TODAY, closedMonths: closed };
  assert.deepEqual(checkEntryDate({ ...base, role: "NURSE", entryDate: "2026-10-05" }), { ok: true });
  assert.deepEqual(checkEntryDate({ ...base, role: "NURSE", entryDate: "2026-10-02" }), { ok: true });
  assert.equal(checkEntryDate({ ...base, role: "NURSE", entryDate: "2026-10-01" }).ok, false);
  assert.equal(checkEntryDate({ ...base, role: "NURSE", entryDate: "2026-10-06" }).ok, false);
  assert.equal(checkEntryDate({ ...base, role: "ADMIN", entryDate: "2026-10-06" }).ok, false);
  assert.deepEqual(checkEntryDate({ ...base, role: "ADMIN", entryDate: "2026-09-10" }), { ok: true });
  assert.equal(checkEntryDate({ ...base, role: "ADMIN", entryDate: "2026-08-15" }).ok, false);
  assert.deepEqual(
    checkEntryDate({ ...base, role: "NURSE", entryDate: "2026-10-01", nurseBackdateDays: 5 }),
    { ok: true },
  );
});

test("canVoid is admin only and respects closed months", () => {
  const closed = new Set(["2026-08"]);
  assert.equal(canVoid("NURSE", "2026-10-05", closed).ok, false);
  assert.equal(canVoid("ADMIN", "2026-10-05", closed).ok, true);
  assert.equal(canVoid("ADMIN", "2026-08-15", closed).ok, false);
});
