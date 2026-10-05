import { context } from "@/server/context";
import { dashboard } from "@/server/inventory";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/dashboard — counts, low stock, expiring soon, and the latest entries. */
export async function GET() {
  return handle(async () => {
    const ctx = await context();
    return await dashboard(ctx);
  });
}
