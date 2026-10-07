import { context, serverDate } from "@/server/context";
import { handleFile, ApiError } from "@/server/http";
import { ledgerFileName, ledgerWorkbook, monthRange, XLSX_TYPE } from "@/server/export";

export const dynamic = "force-dynamic";

/**
 * A month is about 4,500 rows and takes a second; the whole history is about 87,000 and takes
 * closer to ten. Asked for explicitly and on demand, so the ceiling is set rather than left to
 * the platform's default request timeout.
 */
export const maxDuration = 60;

/**
 * GET /api/export/ledger?month=2026-09
 * GET /api/export/ledger?from=2025-02-10&to=2026-09-30
 *
 * The long-format tab the office used to produce with the convert step: one tab per month, one
 * row per item per day, DATE | ITEM ID | BEGINNING BALANCE | RECEIVED | DISPENSED |
 * ENDING BALANCE | EXPIRATION DATE. The rows are rebuilt from the stored movements, which is why
 * nothing here reads a balance.
 */
export async function GET(request: Request) {
  return handleFile(async () => {
    const ctx = await context();
    const params = new URL(request.url).searchParams;

    const month = params.get("month");
    let from: string;
    let to: string;
    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw ApiError.badRequest(`month "${month}" must look like "2026-09".`);
      // A month that has not started yet has no rows, and asking for it is a mistake worth naming.
      if (month > ctx.today.slice(0, 7)) throw ApiError.badRequest(`${month} has not started yet.`);
      ({ from, to } = monthRange(month));
    } else {
      from = serverDate(params.get("from") ?? `${ctx.today.slice(0, 7)}-01`, "from");
      to = serverDate(params.get("to") ?? ctx.today, "to");
    }

    const activeOnly = params.get("activeOnly") === "1";
    const file = await ledgerWorkbook(ctx, { from, to, activeOnly });

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Length": String(file.length),
        // The filename is a plain range of digits and dashes, so it needs no encoding.
        "Content-Disposition": `attachment; filename="${ledgerFileName(from, to)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}