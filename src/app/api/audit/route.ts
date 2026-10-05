import { adminContext } from "@/server/context";
import { handle } from "@/server/http";
import { listAudit } from "@/server/months";
import { auditQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/audit?action=&entity=&entityId=  (admin only) */
export async function GET(request: Request) {
  return handle(async () => {
    await adminContext();
    const query = auditQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return await listAudit(query);
  });
}
