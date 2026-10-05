import { context } from "@/server/context";
import { ApiError, handle } from "@/server/http";
import { monthEndSheet, saveCounts, suggestedMonth } from "@/server/months";
import { countsSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/month-end?month=2026-09 — the counting sheet. Defaults to last month. */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const requested = new URL(request.url).searchParams.get("month");
    const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : suggestedMonth(ctx.today);
    if (month > ctx.today.slice(0, 7)) throw ApiError.badRequest(`${month} has not started yet.`);
    return await monthEndSheet(ctx, month);
  });
}

/** POST /api/month-end — save the physical counts for a month. */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = countsSchema.parse(await request.json());
    return await saveCounts(ctx, body.month, body.counts);
  });
}
