// Reads the old NURSE.xlsx workbook. Two kinds of tab are used:
//
//   "SEPTEMBER 2026"   the converted long format, one row per item per day:
//                      DATE | ITEM ID | BEGINNING BALANCE | RECEIVED | DISPENSED |
//                      ENDING BALANCE | EXPIRATION DATE
//   "SEPTEMBER 2026s"  the wide original, one row per item and one column per day. Only two
//                      things are read from it: the two EXPIRATION DATE columns, which are the
//                      only place the workbook records an item's *second* batch, and the
//                      "Additional (fr. HSO Alangilan)" header, which names the source of a
//                      delivery.
//
// Nothing here touches the database, so the whole reader can be tested on a fixture.

import ExcelJS from "exceljs";
import { endOfMonth } from "./stock.ts";

const MONTH_WORDS: Record<string, number> = {
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4, MAY: 5,
  JUN: 6, JUNE: 6, JUL: 7, JULY: 7, AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12,
};

const LONG_TAB = /^([A-Z]+) (\d{4})$/;
const WIDE_TAB = /^([A-Z]+) (\d{4})s$/;

export interface WorkbookItem {
  id: string;
  name: string;
  /** The workbook's NOTES column. Brand, size or pack text. */
  note: string;
}

export interface WorkbookRow {
  date: string;
  itemId: string;
  beginning: number;
  received: number;
  dispensed: number;
  ending: number;
  /** The raw EXPIRATION DATE cell, exactly as written, or "" when the cell is empty. */
  expiry: string;
}

export interface WorkbookMonth {
  /** The tab name, e.g. "SEPTEMBER 2026". */
  sheet: string;
  /** "YYYY-MM", e.g. "2026-09". */
  month: string;
  rows: WorkbookRow[];
  /** The first and last date the tab actually covers. Some tabs start late or stop early. */
  firstDate: string;
  lastDate: string;
}

export interface WorkbookBatchHint {
  itemId: string;
  /** Every expiry the wide tab recorded for this item, as month ends, earliest first. */
  expiries: string[];
  /** Raw cells the expiries came from, kept so the report can quote what the office typed. */
  raw: string[];
}

export interface ParsedWorkbook {
  items: WorkbookItem[];
  /** Oldest month first. */
  months: WorkbookMonth[];
  /** The delivery source named in each wide tab's "Additional" header, by "YYYY-MM". */
  sources: { month: string; source: string }[];
  /** Items whose *second* batch only the wide tab knows about. */
  batchHints: WorkbookBatchHint[];
  /** Wide-tab rows that could not be matched to an item ID. */
  unmatched: { sheet: string; row: number; name: string }[];
}

// ---------- cell reading ----------

/** ExcelJS hands back formula cells as { formula, result } and dates as UTC Date objects. */
function raw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  return v;
}

function text(cell: ExcelJS.Cell): string {
  const v = raw(cell);
  if (v === null || v === undefined) return "";
  return String(v).replace(/\u00a0/g, " ").trim();
}

/** A workbook quantity. Blank means nothing happened, which is 0. */
function qty(cell: ExcelJS.Cell, where: string): number {
  const v = raw(cell);
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`${where} holds ${v}, and stock is counted in whole units.`);
    return v;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${where} holds "${String(v)}", which is not a whole number.`);
  return n;
}

/** A workbook date as "YYYY-MM-DD". @db.Date columns are UTC midnight, so toISOString is safe. */
function date(cell: ExcelJS.Cell, where: string): string {
  const v = raw(cell);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${where} holds "${s}", which is not a date.`);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The EXPIRATION DATE cell, keeping its shape. Most of these cells are real dates, which ExcelJS
 * hands back as Date objects, so they are written as "YYYY-MM-DD" for the parser. A few were typed
 * by hand and stay as text.
 */
function expiryText(cell: ExcelJS.Cell): string {
  const v = raw(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\u00a0/g, " ").trim();
}

function monthOf(tab: string): string {
  const m = LONG_TAB.exec(tab) ?? WIDE_TAB.exec(tab);
  if (!m) throw new Error(`"${tab}" is not a month tab.`);
  const month = MONTH_WORDS[m[1]];
  if (!month) throw new Error(`"${tab}" does not start with a month name.`);
  return `${m[2]}-${String(month).padStart(2, "0")}`;
}

/** Orders "SEPTEMBER 2026" before "OCTOBER 2026", unlike a plain string sort. */
function compareMonths(a: string, b: string): number {
  return monthOf(a) < monthOf(b) ? -1 : monthOf(a) > monthOf(b) ? 1 : 0;
}

// ---------- expiry cells ----------

/**
 * The workbook writes expiry dates by hand, in whatever shape suited the cell:
 *   "11/2026"          month and year
 *   "3/2028"           no padding
 *   "2028-01-01"       a real date, kept by pasting
 *   "9/8/26"           month, day and two-digit year
 *   "7/27; 10/27"      two batches in one cell
 *   ""                 not recorded
 * Every value becomes the last day of its month, which is how the app stores an expiry.
 * Returns null for anything unreadable so a typo becomes a reported gap, not a crash.
 */
export function parseExpiryCell(cell: string | null | undefined): string[] {
  if (cell == null) return [];
  const out: string[] = [];
  // Split on the separators a cell uses to hold two batches. "/" is never a separator here: it
  // is the separator inside "11/2026".
  for (const part of String(cell).split(/[;,]|\band\b/i)) {
    const parsed = parseOneExpiry(part.trim());
    if (parsed && !out.includes(parsed)) out.push(parsed);
  }
  return out.sort();
}

function parseOneExpiry(s: string): string | null {
  if (!s) return null;

  // A real date, possibly with a time. Its day is dropped: the app stores month ends.
  const asDate = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (asDate) return monthEnd(Number(asDate[1]), Number(asDate[2]));

  // "11/2026" or "3/28" or "2028/01".
  const parts = s.split(/[/-]/).filter(Boolean);
  if (parts.length === 2) {
    const [a, b] = parts;
    if (a.length === 4) return monthEnd(Number(a), Number(b)); // "2028/01"
    if (b.length === 4) return monthEnd(Number(b), Number(a)); // "11/2026"
    if (b.length === 2) return monthEnd(2000 + Number(b), Number(a)); // "7/27"
  }

  // "9/8/26": month, day, two-digit year.
  if (parts.length === 3) {
    const [m, , y] = parts;
    return monthEnd(y.length === 2 ? 2000 + Number(y) : Number(y), Number(m));
  }
  return null;
}

function monthEnd(year: number, month: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return endOfMonth(year, month);
}

// ---------- item names ----------

/** Uppercases and drops punctuation, so "CELECOXIB ( CELCOXX)" and "Celecoxib (Celcoxx)" match. */
export function normaliseName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Names in the wide sheets that do not match the ITEMS tab. The same three overrides the
 * conversion script has always used, kept here so both paths agree.
 */
export const WIDE_NAME_OVERRIDES: Record<string, string> = {
  "CLONIDINE HCL CATAPRES": "MED-020",
  "METOCLOPRAMIDE PLASIL": "MED-034",
  "OMEPRAZOLE RITE MED": "MED-036",
};

export interface ItemLookup {
  /** Matches an item ID from any spelling of its name. */
  resolve(name: string): string | null;
}

/**
 * Finds the item behind a wide-tab name. The ITEMS tab stores "NAME" and "NOTES" separately
 * while the wide sheet types "NAME (NOTES)", so the full spelling is tried first; then the
 * name alone; then the overrides; then a unique prefix, which is what rescues the wide sheet's
 * shortened "DISINFECTANT CLEANER" against the catalogue's "DISINFECTANT CLEANER GALLON".
 */
export function buildItemLookup(items: WorkbookItem[]): ItemLookup {
  // A name can be shared: ACETYLCYSTEINE is two catalogue rows. Any spelling that more than one
  // item answers to is dropped rather than resolved to whichever happened to be read last.
  const candidates = new Map<string, Set<string>>();
  const remember = (key: string, id: string) => {
    let ids = candidates.get(key);
    if (!ids) candidates.set(key, (ids = new Set()));
    ids.add(id);
  };

  for (const item of items) {
    remember(normaliseName(item.name), item.id);
    if (item.note) remember(normaliseName(`${item.name} (${item.note})`), item.id);
  }
  for (const [name, id] of Object.entries(WIDE_NAME_OVERRIDES)) remember(normaliseName(name), id);

  const exact = new Map<string, string>();
  const prefixes = new Map<string, Set<string>>();
  for (const [key, ids] of candidates) {
    if (ids.size === 1) exact.set(key, [...ids][0]);
    if (key) prefixes.set(key, ids);
  }

  return {
    resolve(name: string): string | null {
      const key = normaliseName(name);
      if (!key) return null;
      const direct = exact.get(key);
      if (direct) return direct;
      // A shortened name, as in the wide sheet's "DISINFECTANT CLEANER". Only one item may match.
      const matches = new Set<string>();
      for (const [candidate, ids] of prefixes) if (candidate.startsWith(key)) for (const id of ids) matches.add(id);
      return matches.size === 1 ? [...matches][0] : null;
    },
  };
}

// ---------- the reader ----------

const HEADERS = ["DATE", "ITEM ID", "BEGINNING BALANCE", "RECEIVED", "DISPENSED", "ENDING BALANCE", "EXPIRATION DATE"];

/**
 * Reads every tab the import needs. Throws when a long tab does not have the expected header,
 * because that means the workbook changed shape and the numbers would be silently wrong.
 */
export async function readWorkbook(path: string): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const items = readItems(wb);
  const months = wb.worksheets
    .map((ws) => ws.name)
    .filter((n) => LONG_TAB.test(n))
    .sort(compareMonths)
    .map((name) => readLongTab(wb.getWorksheet(name)!));

  const wideNames = wb.worksheets.map((ws) => ws.name).filter((n) => WIDE_TAB.test(n)).sort(compareMonths);
  const sources: ParsedWorkbook["sources"] = [];
  for (const name of wideNames) sources.push(...readSources(wb.getWorksheet(name)!));

  const lookup = buildItemLookup(items);
  const latestWide = wideNames.length ? wb.getWorksheet(wideNames[wideNames.length - 1]) : null;
  const { batchHints, unmatched } = latestWide
    ? readExpiryColumns(latestWide, lookup)
    : { batchHints: [] as WorkbookBatchHint[], unmatched: [] as ParsedWorkbook["unmatched"] };

  return { items, months, sources, batchHints, unmatched };
}

function readItems(wb: ExcelJS.Workbook): WorkbookItem[] {
  const ws = wb.getWorksheet("ITEMS");
  if (!ws) throw new Error("The workbook has no ITEMS tab.");
  const items: WorkbookItem[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const id = text(row.getCell(1));
    const name = text(row.getCell(2));
    if (!id || !name) continue;
    items.push({ id, name, note: text(row.getCell(3)) });
  }
  if (items.length === 0) throw new Error("The ITEMS tab is empty.");
  return items;
}

function readLongTab(ws: ExcelJS.Worksheet): WorkbookMonth {
  const header = HEADERS.map((_, i) => text(ws.getRow(1).getCell(i + 1)).toUpperCase());
  for (const [i, expected] of HEADERS.entries()) {
    if (!header[i].startsWith(expected.split(" ")[0])) {
      throw new Error(`"${ws.name}" column ${i + 1} is "${header[i]}", expected "${expected}".`);
    }
  }

  const rows: WorkbookRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!text(row.getCell(1)) || !text(row.getCell(2))) continue;
    const at = `"${ws.name}" row ${r}`;
    rows.push({
      date: date(row.getCell(1), `${at} DATE`),
      itemId: text(row.getCell(2)),
      beginning: qty(row.getCell(3), `${at} BEGINNING BALANCE`),
      received: qty(row.getCell(4), `${at} RECEIVED`),
      dispensed: qty(row.getCell(5), `${at} DISPENSED`),
      ending: qty(row.getCell(6), `${at} ENDING BALANCE`),
      expiry: expiryText(row.getCell(7)),
    });
  }
  if (rows.length === 0) throw new Error(`"${ws.name}" has no rows.`);

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.itemId < b.itemId ? -1 : 1));
  return { sheet: ws.name, month: monthOf(ws.name), rows, firstDate: rows[0].date, lastDate: rows[rows.length - 1].date };
}

/** The "Additional (fr. HSO Alangilan)" columns name where a month's delivery came from. */
function readSources(ws: ExcelJS.Worksheet): { month: string; source: string }[] {
  const out: { month: string; source: string }[] = [];
  const seen = new Set<string>();
  for (let c = 1; c <= ws.columnCount; c++) {
    const header = text(ws.getRow(3).getCell(c));
    if (!/additional/i.test(header)) continue;
    const source = sourceFromHeader(header);
    if (!source || seen.has(source.toLowerCase())) continue;
    seen.add(source.toLowerCase());
    out.push({ month: monthOf(ws.name), source });
  }
  return out;
}

/**
 * Pulls the source out of a header written in either of the two shapes the office uses:
 *   "ADDITIONAL FR. HSO ALANGILAN (FEB. 11, 2025)"   the source leads and the date trails
 *   "Additional (fr. HSO Alangilan)"                 the source sits inside the brackets
 * The date is dropped either way.
 */
export function sourceFromHeader(header: string): string {
  // The bracketed shape: whatever follows "fr." or "from" up to the closing bracket.
  const bracketed = /\(\s*(?:fr\.?|from)\s*([^)]+?)\s*\)/i.exec(header);
  if (bracketed) return clean(bracketed[1]);

  // The trailing shape: "fr. NAME", ignoring a bracketed date at the end of the line.
  const trailing = /(?:fr\.?|from)\s+([^()]+?)(?:\s*\([^)]*\))?\s*$/i.exec(header);
  if (trailing) return clean(trailing[1]);

  // Anything else: drop the word "additional" and unwrap whatever brackets are left.
  return clean(header.replace(/^additional\s*/i, ""));
}

function clean(value: string): string {
  return value
    .replace(/^[\s(]+|[\s),;]+$/g, "")
    .replace(/\([^)]*\d{4}[^)]*\)/g, "") // a bracketed date is not part of the name
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The wide tab has two EXPIRATION DATE columns, which is the only record of an item's second
 * batch. Both are read so the plan's "track stock by batch" has something to track.
 */
function readExpiryColumns(ws: ExcelJS.Worksheet, lookup: ItemLookup): {
  batchHints: WorkbookBatchHint[];
  unmatched: ParsedWorkbook["unmatched"];
} {
  const batchHints: WorkbookBatchHint[] = [];
  const unmatched: ParsedWorkbook["unmatched"] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = text(row.getCell(2));
    if (!name) continue;
    const itemId = lookup.resolve(name);
    if (!itemId) {
      unmatched.push({ sheet: ws.name, row: r, name });
      continue;
    }
    const raw = [text(row.getCell(3)), text(row.getCell(4))].filter(Boolean);
    const expiries = parseExpiryCell(raw.join("; "));
    if (expiries.length > 0) batchHints.push({ itemId, expiries, raw });
  }
  return { batchHints, unmatched };
}