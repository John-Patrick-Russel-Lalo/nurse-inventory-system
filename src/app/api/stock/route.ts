import { context } from "@/server/context";
import { handle } from "@/server/http";
import { stockReport } from "@/server/inventory";
import { stockQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/stock?q=&category=&lowOnly= — item balances with their batch breakdown. */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const filter = stockQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return await stockReport(ctx, filter);
  });
}
