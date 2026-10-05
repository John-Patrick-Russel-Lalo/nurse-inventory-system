import { context } from "@/server/context";
import { ApiError, handle } from "@/server/http";
import { voidTransaction } from "@/server/inventory";
import { voidSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/transactions/:id/void — reverse an entry. Admin only, and never inside a closed
 * month. Nothing is deleted: the row keeps voidedAt, so the balance ignores it and the
 * history still shows it.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    const txId = Number(id);
    if (!Number.isInteger(txId) || txId <= 0) throw ApiError.badRequest("Entry ID must be a whole number.");
    const body = voidSchema.parse(await request.json());
    return { transaction: await voidTransaction(ctx, txId, body.reason) };
  });
}
