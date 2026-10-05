import { context } from "@/server/context";
import { handle } from "@/server/http";
import { reopenMonth } from "@/server/months";
import { reopenSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** POST /api/month-end/reopen  (admin) — unlocks a month and deletes its closing rows. */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = reopenSchema.parse(await request.json());
    return await reopenMonth(ctx, body.month, body.reason);
  });
}
