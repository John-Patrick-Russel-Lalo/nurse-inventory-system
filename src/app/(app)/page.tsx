"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TxTable } from "@/components/TxTable";
import { TopUsedChart, UsageTrendChart } from "@/components/Charts";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  IconAlert,
  IconChevron,
  IconDispense,
  IconReceive,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  Stat,
  TableWrap,
  cn,
  linkClass,
  panelLink,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";
import { usePermissions } from "@/components/SessionProvider";

/** The two things a nurse does most, one tap from the front page. */
function QuickAction({ href, label, hint, Icon }: { href: string; label: string; hint: string; Icon: (p: { className?: string }) => React.JSX.Element }) {
  return (
    <Link
      href={href}
      className="group flex flex-1 items-center gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <IconChevron className="text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

export default function DashboardPage() {
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload, refreshing } = useApi(() => api.dashboard(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  // The month in progress is the last of the twelve, so the trend reads left to right.
  const totals = data.monthTotals[data.monthTotals.length - 1];
  const attention = data.lowStock.length + data.expiringSoon.length + data.expired.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="What needs attention today, and what moved most recently."
        actions={
          <Button variant="plain" size="md" onClick={reload} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {/* What needs doing comes before anything else on the page. */}
      {attention === 0 ? (
        <Alert tone="success" className="text-base">
          <span className="font-medium">Nothing needs attention.</span> No low stock, nothing expiring
          within 90 days, and no expired stock on the shelf.
        </Alert>
      ) : (
        <Alert tone="warn" className="text-base">
          <span className="font-medium">
            {attention} thing{attention === 1 ? "" : "s"} need{attention === 1 ? "s" : ""} attention
          </span>{" "}
          {[
            data.lowStock.length > 0 ? `${data.lowStock.length} low on stock` : null,
            data.expiringSoon.length > 0 ? `${data.expiringSoon.length} expiring soon` : null,
            data.expired.length > 0 ? `${data.expired.length} expired on the shelf` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active items" value={data.itemCount} hint="In the catalogue" />
        <Stat
          label="Low stock"
          value={data.lowStock.length}
          tone={data.lowStock.length ? "warn" : "plain"}
          hint="At or below reorder"
        />
        <Stat
          label="Expiring ≤90d"
          value={data.expiringSoon.length}
          tone={data.expiringSoon.length ? "warn" : "plain"}
          hint="Batches with stock"
        />
        <Stat
          label="Expired in stock"
          value={data.expired.length}
          tone={data.expired.length ? "danger" : "plain"}
          hint="Dispose of these"
        />
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row">
        <QuickAction href="/receive" label="Receive stock" hint="Something arrived" Icon={IconReceive} />
        <QuickAction href="/dispense" label="Dispense stock" hint="Something went out" Icon={IconDispense} />
      </div>

      <Panel
        title="Needs attention"
        description={totals ? `${totals.month}: ${totals.received} received, ${totals.dispensed} dispensed so far.` : undefined}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Low stock">
            {data.lowStock.length === 0 ? (
              <EmptyState title="Nothing is below its reorder level." hint="An item appears here once it has a reorder level set and stock falls to it." />
            ) : (
              <>
                <TableWrap>
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>Item</th>
                      <th scope="col" className={thRightClass}>On hand</th>
                      <th scope="col" className={thRightClass}>Reorder at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStock.map((item) => (
                      <tr key={item.id} className={rowClass}>
                        <td className="px-3 py-2">
                          <Link href={`/items/${item.id}`} className={linkClass}>
                            {item.name}
                            {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-warn">
                          {item.balance}
                          {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                          <LowBadge />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{item.reorderLevel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                <Link href="/stock?lowOnly=1" className={panelLink}>
                  See the full stock list
                </Link>
              </>
            )}
          </Panel>

          <Panel title="Expiring soon" actions={<Link href="/expiry" className={panelLink}>Full expiry report</Link>}>
            {data.expiringSoon.length === 0 ? (
              <EmptyState title="No batch expires in the next 90 days." />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.expiringSoon.map((b) => (
                  <li
                    key={`${b.itemId}-${b.expiry}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-card",
                      b.daysLeft <= 30 ? "border-danger/25 bg-danger-soft/50" : "border-warn/25 bg-warn-soft/50",
                    )}
                  >
                    <span className="min-w-0">
                      <Link href={`/items/${b.itemId}`} className={linkClass}>
                        {b.itemName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted">
                        {b.expiry} · {b.daysLeft} day{b.daysLeft === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono font-medium">{b.balance}</span>
                      <ExpiryBadge status={b.daysLeft <= 30 ? "DAYS_30" : "DAYS_90"} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {data.expired.length > 0 ? (
          <Card className="border-danger/25 bg-danger-soft/40 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <IconAlert />
              Expired but still on the shelf ({data.expired.length})
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.expired.map((e) => (
                <li key={e.itemId}>
                  <Link
                    href={`/items/${e.itemId}`}
                    className="flex items-center gap-2 rounded-full border border-danger/25 bg-surface px-3 py-1 text-sm shadow-card"
                  >
                    <span className="underline-offset-2 hover:underline">{e.itemName}</span>
                    <span className="font-mono font-medium text-danger">{e.balance}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">
              The Dispense screen will not offer expired stock. Record a Dispose entry to take it off the shelf.
            </p>
          </Card>
        ) : null}
      </Panel>

      <Panel
        title="Usage over the last 12 months"
        description="What came in against what went out, month by month."
      >
        <Card className="p-4">
          <UsageTrendChart data={data.monthTotals} />
        </Card>
      </Panel>

      {totals ? (
        <Panel
          title={`Most used in ${totals.month}`}
          description={`${totals.dispensed} ${totals.dispensed === 1 ? "unit" : "units"} dispensed so far this month.`}
        >
          <Card className="p-4">
            <TopUsedChart data={data.topUsed} />
          </Card>
        </Panel>
      ) : null}

      <Panel title="Latest entries" description="The last dozen movements across the office.">
        <TxTable transactions={data.recent} onChanged={reload} />
      </Panel>

      {!isAdmin ? (
        <p className="text-xs text-muted">
          Entries dated inside a closed month cannot be recorded. Ask an admin to reopen it.
        </p>
      ) : null}
    </div>
  );
}