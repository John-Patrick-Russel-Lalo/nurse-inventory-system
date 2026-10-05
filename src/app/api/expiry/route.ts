import { context } from "@/server/context";
import { expiryReport } from "@/server/expiry";
import { handle } from "@/server/http";
import { stockQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/expiry?q=&category= — stocked batches with a known expiry, grouped by how soon. */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const filter = stockQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return await expiryReport(ctx, filter);
  });
}
