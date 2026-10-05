"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TxTable } from "@/components/TxTable";
import {
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Loading,
  LowBadge,
  PageHeader,
  Stat,
  cn,
} from "@/components/ui";
import { usePermissions } from "@/components/SessionProvider";

export default function DashboardPage() {
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload, refreshing } = useApi(() => api.dashboard(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const totals = data.monthTotals[0];
  const alerts = data.lowStock.length + data.expiringSoon.length + data.expired.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="What needs attention today, and what moved most recently."
        actions={
          <button
            type="button"
            onClick={reload}
            className="text-sm text-muted underline underline-offset-2 hover:text-fg"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active items" value={data.itemCount} />
        <Stat label="Low stock" value={data.lowStock.length} tone={data.lowStock.length ? "warn" : "plain"} />
        <Stat
          label="Expiring ≤90d"
          value={data.expiringSoon.length}
          tone={data.expiringSoon.length ? "warn" : "plain"}
        />
        <Stat
          label="Expired in stock"
          value={data.expired.length}
          tone={data.expired.length ? "danger" : "plain"}
        />
      </dl>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">
          <span className="font-medium">{totals?.month}</span> so far:{" "}
          <span className="font-mono text-ok">+{totals?.received ?? 0}</span> received,{" "}
          <span className="font-mono text-danger">−{totals?.dispensed ?? 0}</span> dispensed.
        </p>
        {alerts === 0 ? (
          <p className="text-sm text-ok">Nothing needs attention.</p>
        ) : (
          <p className="text-sm text-muted">{alerts} thing{alerts === 1 ? "" : "s"} below.</p>
        )}
      </Card>

      {data.expired.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Expired but still in stock</h2>
          <ul className="flex flex-col gap-1">
            {data.expired.map((e) => (
              <li key={e.itemId} className="flex items-center justify-between gap-3 rounded-md bg-danger-soft px-3 py-2 text-sm">
                <Link href={`/items/${e.itemId}`} className="underline underline-offset-2">
                  {e.itemName}
                </Link>
                <span className="font-mono">{e.balance}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Expired stock is not offered by the Dispense screen. Set it aside with a Dispose entry.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Low stock</h2>
          <Link href="/stock?lowOnly=1" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
            See all on Stock
          </Link>
        </div>
        {data.lowStock.length === 0 ? (
          <EmptyState title="Nothing below its reorder level." hint="Items appear here once their reorder level is set and stock falls to it." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-rule">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Item</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">On hand</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.map((item) => (
                  <tr key={item.id} className="border-t border-rule">
                    <td className="px-3 py-2">
                      <Link href={`/items/${item.id}`} className="underline underline-offset-2">
                        {item.name}
                        {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className="text-warn">{item.balance}</span>
                      {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                      <LowBadge />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{item.reorderLevel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Expiring soon</h2>
          <Link href="/expiry" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
            Full expiry report
          </Link>
        </div>
        {data.expiringSoon.length === 0 ? (
          <EmptyState title="No batch expires in the next 90 days." />
        ) : (
          <ul className="flex flex-col gap-1">
            {data.expiringSoon.map((b) => (
              <li
                key={`${b.itemId}-${b.expiry}`}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm",
                  b.daysLeft <= 30 ? "bg-danger-soft" : "bg-warn-soft",
                )}
              >
                <span className="min-w-0">
                  <Link href={`/items/${b.itemId}`} className="underline underline-offset-2">
                    {b.itemName}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted">
                    {b.expiry} · {b.daysLeft} day{b.daysLeft === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{b.balance}</span>
                  <ExpiryBadge status={b.daysLeft <= 30 ? "DAYS_30" : "DAYS_90"} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Latest entries</h2>
        <TxTable transactions={data.recent} onChanged={reload} />
      </section>

      {!isAdmin ? (
        <p className="text-xs text-muted">
          Entries dated inside a closed month cannot be recorded. Ask an admin to reopen it.
        </p>
      ) : null}
    </div>
  );
}
