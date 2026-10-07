// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDateString, lastDayOfMonth, lastMonths, monthOf, monthsBetween, nextMonth, previousMonth } from "./dates.ts";

test("nextMonth crosses the year boundary", () => {
  assert.equal(nextMonth("2026-11"), "2026-12");
  assert.equal(nextMonth("2026-12"), "2027-01");
});

test("nextMonth crosses back from January", () => {
  assert.equal(nextMonth("2027-01"), "2027-02");
  assert.equal(nextMonth("2026-01"), "2026-02");
});

test("previousMonth crosses the year boundary", () => {
  assert.equal(previousMonth("2027-01"), "2026-12");
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("monthsBetween includes both ends", () => {
  assert.deepEqual(monthsBetween("2025-11", "2026-02"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});

test("monthsBetween gives a single month when the ends match", () => {
  assert.deepEqual(monthsBetween("2026-09", "2026-09"), ["2026-09"]);
});

// A chart with a month in the wrong order, or a month missing, would quietly misreport usage, so
// an inverted range has to come back empty rather than run away.
test("monthsBetween is empty when the end is before the start", () => {
  assert.deepEqual(monthsBetween("2026-04", "2026-02"), []);
  assert.deepEqual(monthsBetween("2027-01", "2026-12"), []);
});

test("monthsBetween spans a leap February", () => {
  assert.deepEqual(monthsBetween("2028-01", "2028-03"), ["2028-01", "2028-02", "2028-03"]);
  assert.equal(lastDayOfMonth("2028-02"), "2028-02-29");
  assert.equal(lastDayOfMonth("2026-02"), "2026-02-28");
});

test("lastMonths gives the twelve months up to and including the given one", () => {
  const months = lastMonths("2026-10", 12);
  assert.equal(months.length, 12);
  assert.equal(months[0], "2025-11");
  assert.equal(months[11], "2026-10");
});

test("lastMonths counts back across the year boundary", () => {
  assert.deepEqual(lastMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
});

test("lastMonths of zero or one is the edge, not an error", () => {
  assert.deepEqual(lastMonths("2026-10", 0), []);
  assert.deepEqual(lastMonths("2026-10", 1), ["2026-10"]);
});

test("monthOf takes the month off a date", () => {
  assert.equal(monthOf("2026-10-06"), "2026-10");
  assert.equal(monthOf("2026-01-01"), "2026-01");
});

test("isDateString rejects the impossible and the malformed", () => {
  assert.equal(isDateString("2026-10-06"), true);
  assert.equal(isDateString("2026-02-30"), false);
  assert.equal(isDateString("2026-13-01"), false);
  assert.equal(isDateString("2026-00-10"), false);
  assert.equal(isDateString("2026-1-6"), false);
  assert.equal(isDateString(""), false);
});