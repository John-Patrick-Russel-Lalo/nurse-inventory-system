// Reads back the report that `npm run import:workbook` left in the audit trail.
//
// The migration runs once from the command line, because it reads a 4 MB workbook and writes
// thousands of rows. This service only presents what that run recorded, so the screen can never
// disagree with what actually happened.

import type { AuditLog, User } from "@prisma/client";

export interface ImportGap {
  itemId: string;
  date: string;
  from: number;
  to: number;
  difference: number;
  previousMonth: string;
  month: string;
  midTab: boolean;
}

export interface ImportStockedBatch {
  itemId: string;
  expiry: string | null;
  balance: number;
}

export interface ImportMonth {
  sheet: string;
  month: string;
  rows: number;
  firstDate: string;
  lastDate: string;
}

export interface ImportReportResponse {
  imported: boolean;
  appliedAt: string | null;
  importedBy: string | null;
  workbook: string | null;
  rejectedGaps: string[];
  summary: {
    items: number;
    days: number;
    firstDate: string;
    lastDate: string;
    months: number;
    counts: Record<string, number>;
    openingUnits: number;
    receivedUnits: number;
    dispensedUnits: number;
    adjustUnits: number;
    unitsOnHand: number;
    stockedBatches: number;
  } | null;
  reconciliation: {
    monthEndsChecked: number;
    mismatches: { month: string; itemId: string; expected: number; rebuilt: number }[];
    received: { inWorkbook: number; planned: number };
    dispensed: { inWorkbook: number; planned: number };
  } | null;
  months: ImportMonth[];
  sources: { month: string; source: string }[];
  gaps: ImportGap[];
  lateOpenings: { itemId: string; date: string; qty: number }[];
  noExpiry: ImportStockedBatch[];
  expired: ImportStockedBatch[];
  stoppedRecording: { itemId: string; lastDate: string; balance: number }[];
  unusedItems: string[];
  unmatchedWideRows: { sheet: string; row: number; name: string }[];
}

const EMPTY: ImportReportResponse = {
  imported: false,
  appliedAt: null,
  importedBy: null,
  workbook: null,
  rejectedGaps: [],
  summary: null,
  reconciliation: null,
  months: [],
  sources: [],
  gaps: [],
  lateOpenings: [],
  noExpiry: [],
  expired: [],
  stoppedRecording: [],
  unusedItems: [],
  unmatchedWideRows: [],
};

type Entry = Pick<AuditLog, "id" | "at" | "detail"> & { user: Pick<User, "name"> | null };

/** The most recent `workbook.import` audit entry, or an empty report when there is none. */
export async function importReport(entry: Entry | null): Promise<ImportReportResponse> {
  if (!entry) return EMPTY;
  const detail = (entry.detail ?? {}) as Partial<ImportReportResponse> & Record<string, unknown>;
  return {
    ...EMPTY,
    imported: true,
    appliedAt: typeof detail.appliedAt === "string" ? detail.appliedAt : entry.at.toISOString(),
    importedBy: entry.user?.name ?? null,
    workbook: typeof detail.workbook === "string" ? detail.workbook : null,
    rejectedGaps: Array.isArray(detail.rejectedGaps) ? (detail.rejectedGaps as string[]) : [],
    summary: (detail.summary as ImportReportResponse["summary"]) ?? null,
    reconciliation: (detail.reconciliation as ImportReportResponse["reconciliation"]) ?? null,
    months: Array.isArray(detail.months) ? (detail.months as ImportMonth[]) : [],
    sources: Array.isArray(detail.sources) ? (detail.sources as ImportReportResponse["sources"]) : [],
    gaps: Array.isArray(detail.gaps) ? (detail.gaps as ImportGap[]) : [],
    lateOpenings: Array.isArray(detail.lateOpenings) ? (detail.lateOpenings as ImportReportResponse["lateOpenings"]) : [],
    noExpiry: Array.isArray(detail.noExpiry) ? (detail.noExpiry as ImportStockedBatch[]) : [],
    expired: Array.isArray(detail.expired) ? (detail.expired as ImportStockedBatch[]) : [],
    stoppedRecording: Array.isArray(detail.stoppedRecording)
      ? (detail.stoppedRecording as ImportReportResponse["stoppedRecording"])
      : [],
    unusedItems: Array.isArray(detail.unusedItems) ? (detail.unusedItems as string[]) : [],
    unmatchedWideRows: Array.isArray(detail.unmatchedWideRows)
      ? (detail.unmatchedWideRows as ImportReportResponse["unmatchedWideRows"])
      : [],
  };
}