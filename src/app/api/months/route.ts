import { context } from "@/server/context";
import { handle } from "@/server/http";
import { listMonths } from "@/server/months";

export const dynamic = "force-dynamic";

/** GET /api/months — which months are closed, and which one to close next. */
export async function GET() {
  return handle(async () => {
    const ctx = await context();
    return await listMonths(ctx);
  });
}
