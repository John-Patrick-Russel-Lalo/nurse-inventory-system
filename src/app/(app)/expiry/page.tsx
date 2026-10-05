"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import type { ExpiryRow } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import {
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Loading,
  PageHeader,
  Stat,
  cn,
} from "@/components/ui";

const BUCKETS = [
  { key: "DAYS_30", title: "Within 30 days", tone: "bg-danger-soft" },
  { key: "DAYS_60", title: "31 to 60 days", tone: "bg-warn-soft" },
  { key: "DAYS_90", title: "61 to 90 days", tone: "bg-warn-soft" },
] as const;

export default function ExpiryPage() {
  const { today } = usePermissions();
  const { data, error, loading, reload, refreshing } = useApi(() => api.expiry(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const soon = data.buckets.DAYS_30.length + data.buckets.DAYS_60.length + data.buckets.DAYS_90.length;
  const soonUnits =
    data.buckets.DAYS_30.reduce((s, r) => s + r.balance, 0) +
    data.buckets.DAYS_60.reduce((s, r) => s + r.balance, 0) +
    data.buckets.DAYS_90.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Expiry report"
        description={`Batches still holding stock, by how soon they expire. Measured from ${data.today}.`}
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

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Expired batches" value={data.expired.length} tone={data.expired.length ? "danger" : "plain"} />
        <Stat label="Expiring ≤90d" value={soon} tone={soon ? "warn" : "plain"} />
        <Stat label="Units ≤90d" value={soonUnits} tone={soon ? "warn" : "plain"} />
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Expired, still on the shelf</h2>
        {data.expired.length === 0 ? (
          <EmptyState title="Nothing expired." hint={`Every batch with stock expires after ${today} or has no expiry recorded.`} />
        ) : (
          <>
            <BatchTable rows={data.expired} />
            <p className="text-sm text-muted">
              Expired stock is skipped by Dispense. Set it aside and record a Dispose entry once it is gone.
            </p>
          </>
        )}
      </section>

      {BUCKETS.map(({ key, title, tone }) => (
        <section key={key} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {title}{" "}
            <span className="text-sm font-normal text-muted">
              ({data.buckets[key].length} {data.buckets[key].length === 1 ? "batch" : "batches"})
            </span>
          </h2>
          {data.buckets[key].length === 0 ? (
            <EmptyState title="Nothing in this window." />
          ) : (
            <div className={cn("overflow-hidden rounded-md border border-rule", tone)}>
              <BatchTable rows={data.buckets[key]} />
            </div>
          )}
        </section>
      ))}

      <Card className="p-4 text-sm text-muted">
        <p className="font-medium text-fg">About the dates</p>
        <ul className="mt-2 list-disc pl-5">
          <li>Only the month is kept, so an expiry is stored as the last day of that month.</li>
          <li>A batch expiring today is still usable today; it is expired from tomorrow.</li>
          <li>Batches with no expiry recorded are never listed here, and are used last when dispensing.</li>
        </ul>
      </Card>
    </div>
  );
}

function BatchTable({ rows }: { rows: ExpiryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-surface text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Item</th>
            <th scope="col" className="px-3 py-2 font-medium">Expiry</th>
            <th scope="col" className="px-3 py-2 font-medium">Days left</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">On hand</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.batchId}`} className="border-t border-rule">
              <td className="px-3 py-2">
                <Link href={`/items/${r.itemId}`} className="underline underline-offset-2">
                  {r.itemName}
                </Link>
                {r.variant ? <span className="text-muted"> · {r.variant}</span> : null}
                <span className="ml-2 font-mono text-xs text-muted">
                  #{r.batchId}
                  {r.batchLabel ? ` ${r.batchLabel}` : ""}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.expiry}</td>
              <td className="px-3 py-2 font-mono">{r.daysToExpiry}</td>
              <td className="px-3 py-2"><ExpiryBadge status={r.status} /></td>
              <td className="px-3 py-2 text-right font-mono">
                {r.balance}
                {r.unit ? <span className="text-muted"> {r.unit}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
