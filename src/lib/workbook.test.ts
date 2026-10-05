// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItemLookup, normaliseName, parseExpiryCell, sourceFromHeader, type WorkbookItem } from "./workbook.ts";

test("parseExpiryCell reads the month-and-year shapes the office types", () => {
  assert.deepEqual(parseExpiryCell("11/2026"), ["2026-11-30"]);
  assert.deepEqual(parseExpiryCell("01/2027"), ["2027-01-31"]);
  assert.deepEqual(parseExpiryCell("3/2028"), ["2028-03-31"]);
  assert.deepEqual(parseExpiryCell(" 8/2027 "), ["2027-08-31"]);
});

test("parseExpiryCell turns a real date into the last day of its month", () => {
  assert.deepEqual(parseExpiryCell("2028-01-01"), ["2028-01-31"]);
  // A batch expiring today is still usable today, so the month end is what gets stored.
  assert.deepEqual(parseExpiryCell("2026-09-08"), ["2026-09-30"]);
  assert.deepEqual(parseExpiryCell("2024-02-14"), ["2024-02-29"]); // leap year
});

test("parseExpiryCell reads a two-digit year", () => {
  assert.deepEqual(parseExpiryCell("7/27"), ["2027-07-31"]);
});

test("parseExpiryCell reads two batches out of one cell, earliest first", () => {
  assert.deepEqual(parseExpiryCell("8/2027; 11/2026"), ["2026-11-30", "2027-08-31"]);
  assert.deepEqual(parseExpiryCell("7/27; 10/27"), ["2027-07-31", "2027-10-31"]);
  assert.deepEqual(parseExpiryCell("2028-01-01, 2027-04-30"), ["2027-04-30", "2028-01-31"]);
});

test("parseExpiryCell drops the repeats a single cell can hold", () => {
  assert.deepEqual(parseExpiryCell("03/2026; 3/2026"), ["2026-03-31"]);
});

test("parseExpiryCell says nothing for a cell that was never filled in", () => {
  assert.deepEqual(parseExpiryCell(""), []);
  assert.deepEqual(parseExpiryCell("   "), []);
  assert.deepEqual(parseExpiryCell(null), []);
  assert.deepEqual(parseExpiryCell(undefined), []);
});

test("parseExpiryCell skips a value it cannot read instead of guessing a month", () => {
  assert.deepEqual(parseExpiryCell("sometime next year"), []);
  assert.deepEqual(parseExpiryCell("13/2027"), []);
  assert.deepEqual(parseExpiryCell("2026"), []);
  // An unreadable date does not hide a readable one next to it.
  assert.deepEqual(parseExpiryCell("sometime; 5/2027"), ["2027-05-31"]);
});

test("sourceFromHeader pulls the source out of both header shapes", () => {
  assert.equal(sourceFromHeader("ADDITIONAL FR. HSO ALANGILAN (FEB. 11, 2025)"), "HSO ALANGILAN");
  assert.equal(sourceFromHeader("Additional (fr. HSO Alangilan)"), "HSO Alangilan");
  assert.equal(sourceFromHeader("Additional from HSO Alangilan"), "HSO Alangilan");
  assert.equal(sourceFromHeader("ADDITIONAL"), "");
});

test("normaliseName makes punctuation and spacing irrelevant", () => {
  assert.equal(normaliseName("OMEPRAZOLE (RITE MED)/ MEPRACID"), normaliseName("OMEPRAZOLE (RITE MED / MEPRACID)"));
  assert.equal(normaliseName("CELECOXIB ( CELCOXX)"), normaliseName("Celecoxib (Celcoxx)"));
  assert.equal(normaliseName("ALAXAN "), "ALAXAN");
});

const CATALOGUE: WorkbookItem[] = [
  { id: "MED-018", name: "CELECOXIB", note: "CELCOXX" },
  { id: "MED-036", name: "OMEPRAZOLE", note: "RITE MED / MEPRACID" },
  { id: "MSC-001", name: "DISINFECTANT CLEANER", note: "GALLON" },
  { id: "MSC-002", name: "GARBAGE BAG", note: "PACK" },
];

test("buildItemLookup matches the name the wide sheet types, note in brackets", () => {
  const lookup = buildItemLookup(CATALOGUE);
  assert.equal(lookup.resolve("CELECOXIB (CELCOXX)"), "MED-018");
  assert.equal(lookup.resolve("OMEPRAZOLE (RITE MED / MEPRACID)"), "MED-036");
  assert.equal(lookup.resolve("DISINFECTANT CLEANER (GALLON)"), "MSC-001");
});

test("buildItemLookup matches the bare name too", () => {
  const lookup = buildItemLookup(CATALOGUE);
  assert.equal(lookup.resolve("GARBAGE BAG"), "MSC-002");
});

test("buildItemLookup falls back to a shortened name when only one item can match", () => {
  // The wide sheet drops the note for these two rows.
  const lookup = buildItemLookup(CATALOGUE);
  assert.equal(lookup.resolve("DISINFECTANT CLEANER"), "MSC-001");
  assert.equal(lookup.resolve("GARBAGE BAG"), "MSC-002");
});

test("buildItemLookup uses the overrides for the three names the wide sheets get wrong", () => {
  const lookup = buildItemLookup(CATALOGUE);
  assert.equal(lookup.resolve("CLONIDINE HCL (CATAPRES)"), "MED-020");
  assert.equal(lookup.resolve("METOCLOPRAMIDE (PLASIL)"), "MED-034");
  assert.equal(lookup.resolve("OMEPRAZOLE (RITE MED)"), "MED-036");
});

test("buildItemLookup gives up rather than guess when a name is shared", () => {
  const lookup = buildItemLookup([
    { id: "MED-001", name: "ACETYLCYSTEINE", note: "ACETYPHIL" },
    { id: "MED-002", name: "ACETYLCYSTEINE", note: "PULMOCARE 200" },
  ]);
  // The bare name answers to two items, so it resolves to neither.
  assert.equal(lookup.resolve("ACETYLCYSTEINE"), null);
  assert.equal(lookup.resolve("ACETYLCYSTEI"), null);
  // A spelling only one row answers to is fine.
  assert.equal(lookup.resolve("ACETYLCYSTEINE PULMOCARE"), "MED-002");
  assert.equal(lookup.resolve("ACETYLCYSTEINE (ACETYPHIL)"), "MED-001");
  assert.equal(lookup.resolve("SOMETHING ELSE"), null);
  assert.equal(lookup.resolve(""), null);
});