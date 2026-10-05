import { context } from "@/server/context";
import { handle } from "@/server/http";
import { createItem } from "@/server/items";
import { listItems } from "@/server/inventory";
import { itemCreateSchema, stockQuerySchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** GET /api/items?q=&category=&includeInactive=&lowOnly= */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const url = new URL(request.url);
    const filter = stockQuerySchema.parse(Object.fromEntries(url.searchParams));
    return { items: await listItems(ctx, filter) };
  });
}

/** POST /api/items  (admin) */
export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await context();
    const body = itemCreateSchema.parse(await request.json());
    return { item: await createItem(ctx, body) };
  });
}
