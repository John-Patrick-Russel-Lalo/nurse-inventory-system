// Writes the two Excel files the office gets out of the app:
//
//   ledger   the long-format tab they use today, rebuilt from stored movements. One tab per
//            month, one row per item per day, the same seven columns.
//   stock    the /stock list, plus the batch breakdown behind it.
//
// ExcelJS is already a dependency, because reading NURSE.xlsx needs it. Nothing here reads the
// workbook: the old sheets are an archive, and this is the step that replaces them.

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { fromDbDate, toDbDate } from "@/lib/dates";
import {
  LEDGER_HEADERS,
  ledgerRows,
  ledgerTotals,
  monthTitle,
  spanDays,
  type LedgerItem,
  type LedgerMovement,
  type LedgerRow,
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
}

/** "2026-09" turned into the range a monthly export covers: the whole of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
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

// ---------- the long-format tab ----------

/**
 * The long-format ledger as rows, ready to write. Split out from the workbook so the route can
 * report the row count without holding a whole file in memory, and so the numbers can be
 * checked against a month that is already closed.
 */
export async function buildLedger(ctx: Ctx, options: LedgerExport): Promise<{
  from: string;
  to: string;
  rows: LedgerRow[];
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
  const rows = ledgerRows({ items, movements, from: options.from, to: options.to });
  return { from: options.from, to: options.to, rows, totals: ledgerTotals(rows) };
}

/** The ledger as an .xlsx file, in the format the workbook reader already understands. */
export async function ledgerWorkbook(ctx: Ctx, options: LedgerExport): Promise<Buffer> {
  const { from, to, rows, totals } = await buildLedger(ctx, options);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Nurse office inventory";
  wb.created = new Date();

  // The catalogue comes first, as it does in NURSE.xlsx, so the file is self-contained and the
  // importer can read a sheet this app wrote.
  const catalogue = wb.addWorksheet("ITEMS");
  catalogue.addRow(["ID", "NAME", "NOTES"]);
  for (const item of await readItems(options.activeOnly ?? false)) {
    catalogue.addRow([item.id, item.name, item.variant]);
  }
  styleHeader(catalogue);
  catalogue.getColumn(1).width = 12;
  catalogue.getColumn(2).width = 38;
  catalogue.getColumn(3).width = 24;
  catalogue.views = [{ state: "frozen", ySplit: 1 }];

  // One tab per month, named the way the old tabs are, so a range that spans months still reads
  // the same as the archive it replaces.
  const byMonth = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(row);
    else byMonth.set(month, [row]);
  }

  for (const [month, monthRows] of byMonth) {
    const ws = wb.addWorksheet(monthTitle(month));
    ws.addRow([...LEDGER_HEADERS]);
    for (const r of monthRows) {
      // A real date, not text: ExcelJS reads it back as UTC midnight, which is what the
      // workbook reader expects, so the export can be fed straight back into the importer.
      ws.addRow([toDbDate(r.date), r.itemId, r.beginning, r.received, r.dispensed, r.ending, r.expiry]);
    }
    styleHeader(ws);
    ws.getColumn(1).numFmt = "yyyy-mm-dd";
    ws.getColumn(7).numFmt = "yyyy-mm-dd";
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 12;
    for (const n of [3, 4, 5, 6, 7]) ws.getColumn(n).width = 14;
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await audit(db, ctx, "ledger.export", "export", `${from}/${to}`, {
    rows: rows.length,
    days: spanDays(from, to),
    months: [...byMonth.keys()],
    received: totals.received,
    dispensed: totals.dispensed,
    unitsOnHand: totals.closing,
  });

  return buffer;
}

/** The file name the browser saves it as. */
export function ledgerFileName(from: string, to: string): string {
  const single = monthRange(from).to === to ? from : `${from}_to_${to}`;
  return `nurse-inventory-ledger-${single}.xlsx`;
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
  wb.creator = "Nurse office inventory";
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