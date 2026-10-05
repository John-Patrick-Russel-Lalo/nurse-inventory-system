import { db } from "@/lib/db";
import { adminContext } from "@/server/context";
import { handle } from "@/server/http";
import { importReport } from "@/server/import-report";

export const dynamic = "force-dynamic";

/**
 * GET /api/import  (admin only) — the workbook migration report, as the import script recorded it.
 *
 * The import is a one-time job run from the command line (`npm run import:workbook`). What the
 * screen shows is the report that job wrote into the audit trail, so the office can always see
 * what came in, what had to be adjusted and what still needs tidying.
 */
export async function GET() {
  return handle(async () => {
    await adminContext();
    const entry = await db.auditLog.findFirst({
      where: { action: "workbook.import" },
      orderBy: { id: "desc" },
      select: { id: true, at: true, user: { select: { name: true } }, detail: true },
    });
    return await importReport(entry);
  });
}