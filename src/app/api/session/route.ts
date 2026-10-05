import { context, NURSE_BACKDATE_DAYS } from "@/server/context";
import { handle } from "@/server/http";

// Reads the session, so it must never be prerendered at build time.
export const dynamic = "force-dynamic";

/** Who is signed in, today's date in the office's time zone, and which months are closed. */
export async function GET() {
  return handle(async () => {
    const ctx = await context();
    return {
      user: ctx.user,
      today: ctx.today,
      closedMonths: [...ctx.closed],
      nurseBackdateDays: NURSE_BACKDATE_DAYS,
    };
  });
}
