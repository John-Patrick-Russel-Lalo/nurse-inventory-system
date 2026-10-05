import { context } from "@/server/context";
import { handle } from "@/server/http";
import { listTransactions, recordMovement } from "@/server/inventory";
import { movementSchema, txQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/transactions?itemId=&from=&to=&type=&includeVoided=&limit=&offset= */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const filter = txQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return await listTransactions(ctx, filter);
  });
}

/** POST /api/transactions — record a stock movement. */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = movementSchema.parse(await request.json());
    return await recordMovement(ctx, body);
  });
}
