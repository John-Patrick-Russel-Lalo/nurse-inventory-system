import { context } from "@/server/context";
import { handle } from "@/server/http";
import { suggestAllocation } from "@/server/inventory";
import { allocateSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/allocate — how the server would split this quantity across batches.
 * Read-only, so the Dispense screen can show the earliest-expiry-first plan before saving.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = allocateSchema.parse(await request.json());
    return await suggestAllocation(ctx, body.itemId, body.qty);
  });
}
