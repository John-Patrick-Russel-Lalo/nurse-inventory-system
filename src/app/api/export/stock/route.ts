import { context } from "@/server/context";
import { handleFile } from "@/server/http";
import { stockWorkbook, XLSX_TYPE } from "@/server/export";
import { stockQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/stock?q=&category=&lowOnly=1
 *
 * The /stock list as a spreadsheet: one tab of items, one of the batches behind them. The
 * filters are the ones the screen uses, so the file matches what is on screen.
 */
export async function GET(request: Request) {
  return handleFile(async () => {
    const ctx = await context();
    const filter = stockQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const file = await stockWorkbook(ctx, filter);

    const suffix = filter.lowOnly ? "-low-stock" : "";
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Length": String(file.length),
        "Content-Disposition": `attachment; filename="nurse-inventory-stock${suffix}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  });
}