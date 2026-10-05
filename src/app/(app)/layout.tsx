import { AppShell } from "@/components/AppShell";
import { SessionProvider } from "@/components/SessionProvider";
import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { NURSE_BACKDATE_DAYS } from "@/server/context";

// Every screen under this group needs a signed-in person, so the check happens once here.
// The URL is unchanged by the group name: /stock is /stock.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const closedMonths = (
    await db.closedMonth.findMany({ select: { month: true }, orderBy: { month: "desc" } })
  ).map((m) => m.month);

  return (
    <SessionProvider
      value={{
        user,
        today: today(),
        closedMonths,
        nurseBackdateDays: NURSE_BACKDATE_DAYS,
      }}
    >
      <AppShell user={user}>{children}</AppShell>
    </SessionProvider>
  );
}
