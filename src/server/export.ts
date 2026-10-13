// Writes the two Excel files the office gets out of the app:
//
//   ledger   the office's original wide tab, rebuilt from stored movements. One tab per month,
//            named "SEPTEMBER 2026s", one row per item and one STARTING BALANCE / DISPENSED pair
//            per day, ending in BALANCE and MONTH-END BALANCE.
//   stock    the /stock list, plus the batch breakdown behind it.
//
// ExcelJS is already a dependency, because reading NURSE.xlsx needs it. Nothing here reads the
// workbook: the old sheets are an archive, and this is the step that replaces them.

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { fromDbDate, monthOf, monthsBetween, toDbDate } from "@/lib/dates";
import {
  formatExpiry,
  ledgerRows,
  ledgerTotals,
  recordedMonths,
  spanDays,
  wideMonthSheet,
  type LedgerItem,
  type LedgerMovement,
} from "@/lib/export-ledger";
import type { StockResponse } from "@/lib/api-types";
import { stockReport, type ItemFilter } from "./inventory";
import { audit, type Ctx } from "./context";
import { ApiError } from "./http";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The longest range one export may cover. A month is about 4,500 rows and the whole 20-month
 * history about 87,000; this leaves room for several years without letting one request try to
 * build an unbounded file in memory.
 */
export const MAX_EXPORT_DAYS = 1100;

export interface LedgerExport {
  from: string;
  to: string;
  /** Leave inactive items out of the tab. The old sheet listed the whole catalogue. */
  activeOnly?: boolean;
  /** Only write tabs for months that actually contain an entry, skipping gap months. */
  onlyRecorded?: boolean;
}

/** "2026-09" turned into the range a monthly export covers: the whole of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The whole recorded history as full months: the month of the first entry through the month of the
 * last one, each tab covering every day of its month the way the archive sheets do. Null when no
 * entry has been recorded yet.
 */
export async function recordedRange(): Promise<{ from: string; to: string } | null> {
  const { _min, _max } = await db.transaction.aggregate({
    where: { voidedAt: null },
    _min: { date: true },
    _max: { date: true },
  });
  if (!_min.date || !_max.date) return null;
  const first = fromDbDate(_min.date)!;
  const last = fromDbDate(_max.date)!;
  return { from: monthRange(monthOf(first)).from, to: monthRange(monthOf(last)).to };
}

/** Reads everything needed to rebuild the tab: the catalogue and every entry up to `to`. */
async function readMovements(to: string): Promise<LedgerMovement[]> {
  const rows = await db.transaction.findMany({
    // Voided rows stay in the database but must not appear in a balance, so they are left out
    // here for the same reason the rest of the app leaves them out.
    where: { date: { lte: toDbDate(to) }, voidedAt: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { date: true, itemId: true, qty: true, batch: { select: { expiry: true } } },
  });
  return rows.map((r) => ({
    date: fromDbDate(r.date)!,
    itemId: r.itemId,
    qty: r.qty,
    expiry: fromDbDate(r.batch.expiry),
  }));
}

async function readItems(activeOnly: boolean): Promise<LedgerItem[]> {
  return db.item.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { id: "asc" },
    select: { id: true, name: true, variant: true },
  });
}

// ---------- the wide tab ----------

/**
 * The numbers behind the wide tabs, ready to write. Split out from the workbook so the route can
 * report the totals without holding a whole file in memory, and so the numbers can be checked
 * against a month that is already closed.
 */
export async function buildLedger(ctx: Ctx, options: LedgerExport): Promise<{
  from: string;
  to: string;
  items: LedgerItem[];
  movements: LedgerMovement[];
  totals: ReturnType<typeof ledgerTotals>;
}> {
  const days = spanDays(options.from, options.to);
  if (days < 1) throw ApiError.badRequest(`"${options.from}" is after "${options.to}".`);
  if (days > MAX_EXPORT_DAYS) {
    throw ApiError.badRequest(
      `That is ${days} days. Export at most ${MAX_EXPORT_DAYS} at a time, or a month at a time.`,
      "RANGE_TOO_LONG",
    );
  }

  const [items, movements] = await Promise.all([
    readItems(options.activeOnly ?? false),
    readMovements(options.to),
  ]);
  // The totals the audit keeps come from the long arithmetic, which is what ledgerTotals reads.
  const totals = ledgerTotals(ledgerRows({ items, movements, from: options.from, to: options.to }));
  return { from: options.from, to: options.to, items, movements, totals };
}

/** The ledger as an .xlsx file, in the office's original wide format. */
export async function ledgerWorkbook(ctx: Ctx, options: LedgerExport): Promise<Buffer> {
  const { from, to, items, movements, totals } = await buildLedger(ctx, options);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MediSakto";
  wb.created = new Date();

  // The catalogue comes first, as it does in NURSE.xlsx, so the file is self-contained.
  const catalogue = wb.addWorksheet("ITEMS");
  catalogue.addRow(["ID", "NAME", "NOTES"]);
  for (const item of items) catalogue.addRow([item.id, item.name, item.variant]);
  styleHeader(catalogue);
  catalogue.getColumn(1).width = 12;
  catalogue.getColumn(2).width = 38;
  catalogue.getColumn(3).width = 24;
  catalogue.views = [{ state: "frozen", ySplit: 1 }];

  // One tab per month, named the way the office names its originals ("SEPTEMBER 2026s"), so a
  // range that spans months still reads the same as the archive it replaces.
  const months = options.onlyRecorded
    ? recordedMonths(from.slice(0, 7), to.slice(0, 7), movements)
    : monthsBetween(from.slice(0, 7), to.slice(0, 7));
  for (const month of months) {
    const sheet = wideMonthSheet({ items, movements, month });
    const ws = wb.addWorksheet(sheet.sheet);
    ws.addRow([sheet.title]);
    ws.addRow([]);
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) {
      const values: (string | number | null)[] = [
        row.index,
        row.name,
        formatExpiry(row.expiries[0] ?? null),
        formatExpiry(row.expiries[1] ?? null),
      ];
      for (const day of row.days) values.push(day.beginning, day.dispensed);
      values.push(row.balance, row.balance);
      ws.addRow(values);
    }
    styleWideSheet(ws, sheet.headers.length);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await audit(db, ctx, "ledger.export", "export", `${from}/${to}`, {
    items: items.length,
    days: spanDays(from, to),
    months,
    received: totals.received,
    dispensed: totals.dispensed,
    unitsOnHand: totals.closing,
  });

  return buffer;
}

/** The file name the browser saves it as. */
export function ledgerFileName(from: string, to: string): string {
  const single = monthRange(from).to === to ? from : `${from}_to_${to}`;
  return `medisakto-ledger-${single}.xlsx`;
}

// ---------- the stock list ----------

const STOCK_HEADERS = [
  "ITEM ID",
  "ITEM NAME",
  "VARIANT",
  "CATEGORY",
  "UNIT",
  "ON HAND",
  "REORDER LEVEL",
  "LOW STOCK",
  "NEAREST EXPIRY",
  "EXPIRED QTY",
] as const;

const BATCH_HEADERS = [
  "ITEM ID",
  "ITEM NAME",
  "BATCH",
  "EXPIRY",
  "RECEIVED ON",
  "SOURCE",
  "QTY RECEIVED",
  "BALANCE",
] as const;

/**
 * The /stock list, filtered the same way the screen is, so the file matches what is on screen.
 * Two tabs: one row per item, and one row per batch that holds stock.
 */
export async function stockWorkbook(ctx: Ctx, filter: ItemFilter): Promise<Buffer> {
  const report: StockResponse = await stockReport(ctx, filter);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MediSakto";
  wb.created = new Date();

  const stock = wb.addWorksheet("STOCK");
  stock.addRow([...STOCK_HEADERS]);
  for (const row of report.rows) {
    stock.addRow([
      row.item.id,
      row.item.name,
      row.item.variant,
      row.item.category,
      row.item.unit,
      row.item.balance,
      row.item.reorderLevel,
      row.item.lowStock ? "YES" : null,
      row.item.nearestExpiry,
      row.item.expiredQty || null,
    ]);
  }
  styleHeader(stock);
  stock.getColumn(1).width = 12;
  stock.getColumn(2).width = 38;
  stock.getColumn(3).width = 24;
  for (const n of [6, 7, 9, 10]) stock.getColumn(n).width = 15;
  stock.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const batches = wb.addWorksheet("BATCHES");
  batches.addRow([...BATCH_HEADERS]);
  for (const row of report.rows) {
    for (const batch of row.batches) {
      batches.addRow([
        row.item.id,
        row.item.variant ? `${row.item.name} ${row.item.variant}` : row.item.name,
        batch.label ? `${batch.id} ${batch.label}` : String(batch.id),
        batch.expiry,
        batch.receivedOn,
        batch.source,
        batch.qtyReceived,
        batch.balance,
      ]);
    }
  }
  styleHeader(batches);
  batches.getColumn(1).width = 12;
  batches.getColumn(2).width = 38;
  for (const n of [3, 4, 5, 7, 8]) batches.getColumn(n).width = 15;
  batches.getColumn(6).width = 24;
  batches.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- shared ----------

/** Bold header row and a filter, which is what makes a spreadsheet usable rather than just data. */
function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/** The palette the office's own sheets use: blue for the month's opening and closing, green for the day's dispenses. */
const OPENING_FILL = "FFDEEAF6"; // light blue
const DISPENSED_FILL = "FFE2EFD9"; // light green
const DISPENSED_FONT = "FFFF0000"; // red

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const THIN = { style: "thin" as const };
const edged = (): ExcelJS.Borders =>
  ({ top: THIN, left: THIN, right: THIN, bottom: THIN }) as ExcelJS.Borders;

/**
 * Matches the office's own tabs, so the downloaded file reads as the same sheet they keep: a bold
 * 18pt title, a wrapped bold 12pt header row with thin borders, light blue on the first STARTING
 * BALANCE and on MONTH-END BALANCE, light green on every DISPENSED column, red dispense figures,
 * and the column widths the workbook uses so the text fits instead of getting cut off.
 */
export function styleWideSheet(ws: ExcelJS.Worksheet, columnCount: number): void {
  ws.getRow(1).font = { bold: true, size: 18 };

  const header = ws.getRow(3);
  header.height = 51.75;
  header.font = { bold: true, size: 12 };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (let c = 2; c <= columnCount; c++) {
    const cell = header.getCell(c);
    cell.border = edged();
    if (c === 5 || c === columnCount) cell.fill = solidFill(OPENING_FILL);
    else if (c >= 6 && c % 2 === 0) cell.fill = solidFill(DISPENSED_FILL);
  }

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.getCell(1).font = { size: 11 };
    row.getCell(2).font = { bold: true, size: 11 };
    for (let c = 2; c <= columnCount; c++) {
      const cell = row.getCell(c);
      cell.border = edged();
      if (c === 3 || c === 4) {
        // The expiries are the month-and-year text the office types, not dates in the calendar.
        cell.numFmt = "@";
        continue;
      }
      if (c >= 5) {
        cell.font = { size: 11 };
        cell.alignment = { horizontal: "center" };
      }
      if (c >= 6 && c < columnCount && c % 2 === 0) {
        cell.font = { bold: true, size: 11, color: { argb: DISPENSED_FONT } };
        cell.fill = solidFill(DISPENSED_FILL);
        cell.alignment = { horizontal: "center" };
      }
    }
  }

  ws.getColumn(1).width = 3.29;
  ws.getColumn(2).width = 38.86;
  ws.getColumn(3).width = 17;
  ws.getColumn(4).width = 13.29;
  ws.getColumn(5).width = 20.71; // the first STARTING BALANCE, which must fit the full-month header
  for (let c = 6; c <= columnCount - 2; c++) ws.getColumn(c).width = c % 2 === 0 ? 12.43 : 11.14;
  ws.getColumn(columnCount - 1).width = 11.14;
  ws.getColumn(columnCount).width = 15.57;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 3 }];
}