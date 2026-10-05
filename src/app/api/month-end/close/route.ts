import { context } from "@/server/context";
import { handle } from "@/server/http";
import { closeMonth } from "@/server/months";
import { monthSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** POST /api/month-end/close  (admin) — locks a month once every item has been counted. */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = monthSchema.parse(await request.json());
    return await closeMonth(ctx, body.month);
  });
}
