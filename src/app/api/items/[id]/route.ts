import { context } from "@/server/context";
import { handle } from "@/server/http";
import { updateItem } from "@/server/items";
import { getItem } from "@/server/inventory";
import { itemPatchSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/items/MED-001 — the item, its batches with balances, and its recent entries. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    return await getItem(ctx, id);
  });
}

/** PATCH /api/items/MED-001  (admin) */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    const patch = itemPatchSchema.parse(await request.json());
    return { item: await updateItem(ctx, id, patch) };
  });
}
