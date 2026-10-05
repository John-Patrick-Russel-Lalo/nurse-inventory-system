import type { ExpiryResponse, ExpiryRow } from "@/lib/api-types";
import { stockReport, type ItemFilter } from "./inventory";
import type { Ctx } from "./context";

/**
 * Every batch that still holds stock and has a known expiry, split into expired / 30 / 60 / 90 days.
 * The item balance is not repeated here: this is a batch-level report.
 */
export async function expiryReport(ctx: Ctx, filter: ItemFilter = {}): Promise<ExpiryResponse> {  const report = await stockReport(ctx, filter);
  const rows: ExpiryRow[] = [];

  for (const row of report.rows) {
    for (const b of row.batches) {
      if (b.balance <= 0 || b.expiry === null || b.daysToExpiry === null) continue;
      rows.push({
        itemId: row.item.id,
        itemName: row.item.name,
        variant: row.item.variant,
        unit: row.item.unit,
        batchId: b.id,
        batchLabel: b.label,
        expiry: b.expiry,
        daysToExpiry: b.daysToExpiry,
        status: b.expiryStatus,
        balance: b.balance,
      });
    }
  }

  rows.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  const sum = (list: ExpiryRow[]) => list.reduce((s, r) => s + r.balance, 0);

  return {
    today: ctx.today,
    expired: rows.filter((r) => r.status === "EXPIRED"),
    buckets: {
      DAYS_30: rows.filter((r) => r.status === "DAYS_30"),
      DAYS_60: rows.filter((r) => r.status === "DAYS_60"),
      DAYS_90: rows.filter((r) => r.status === "DAYS_90"),
    },
    totalUnits: sum(rows),
  };
}
