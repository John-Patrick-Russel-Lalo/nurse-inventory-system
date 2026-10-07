"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import type { ExpiryRow } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import {
  Button,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Loading,
  PageHeader,
  Panel,
  Stat,
  TableWrap,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

const BUCKETS = [
  { key: "DAYS_30", title: "Within 30 days", hint: "Use these first, or set them aside." },
  { key: "DAYS_60", title: "31 to 60 days", hint: "Worth moving onto the front of the shelf." },
  { key: "DAYS_90", title: "61 to 90 days", hint: "Plan an order or a rotation." },
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Expiry report"
        description={`Every batch still holding stock, grouped by how soon it runs out. Days are counted from ${data.today}.`}
        actions={
          <Button variant="plain" size="md" onClick={reload} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Already expired"
          value={data.expired.length}
          tone={data.expired.length ? "danger" : "plain"}
          hint="On the shelf, past its date"
        />
        <Stat label="Expiring within 90 days" value={soon} tone={soon ? "warn" : "plain"} hint="Batches to plan around" />
        <Stat label="Units affected" value={soonUnits} tone={soon ? "warn" : "plain"} hint="Across those batches" />
      </dl>

      <Panel
        title="Expired, still on the shelf"
        description="These cannot be dispensed. Remove them and record a Dispose entry once they leave."
      >
        {data.expired.length === 0 ? (
          <EmptyState
            title="Nothing has expired."
            hint={`Every batch holding stock expires after ${today}, or has no expiry date recorded.`}
          />
        ) : (
          <BatchTable rows={data.expired} />
        )}
      </Panel>

      {BUCKETS.map(({ key, title, hint }) => (
        <Panel
          key={key}
          title={title}
          description={hint}
          actions={
            <span className="text-sm text-muted">
              {data.buckets[key].length} {data.buckets[key].length === 1 ? "batch" : "batches"}
            </span>
          }
        >
          {data.buckets[key].length === 0 ? (
            <EmptyState title="Nothing in this window." />
          ) : (
            <BatchTable rows={data.buckets[key]} />
          )}
        </Panel>
      ))}

      <Panel title="How the dates work" description="Worth knowing before you query the report.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>Only the month is recorded, so an expiry date is stored as the last day of that month.</li>
          <li>A batch is usable on its expiry date and counts as expired from the next day.</li>
          <li>Batches with no expiry date are left out of this report, and are the last ones used when dispensing.</li>
        </ul>
      </Panel>
    </div>
  );
}

function BatchTable({ rows }: { rows: ExpiryRow[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th scope="col" className={thClass}>Item and batch</th>
          <th scope="col" className={thClass}>Expiry</th>
          <th scope="col" className={thRightClass}>Days left</th>
          <th scope="col" className={thClass}>Status</th>
          <th scope="col" className={thRightClass}>On hand</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.batchId} className={rowClass}>
            <td className="px-3 py-2.5">
              <Link href={`/items/${r.itemId}`} className={linkClass}>
                {r.itemName}
              </Link>
              {r.variant ? <span className="text-muted"> · {r.variant}</span> : null}
              <span className="ml-2 font-mono text-xs text-muted">
                #{r.batchId}
                {r.batchLabel ? ` ${r.batchLabel}` : ""}
              </span>
            </td>
            <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{r.expiry}</td>
            <td className="px-3 py-2.5 text-right font-mono">{r.daysToExpiry}</td>
            <td className="px-3 py-2.5"><ExpiryBadge status={r.status} /></td>
            <td className="px-3 py-2.5 text-right font-mono font-medium">
              {r.balance}
              {r.unit ? <span className="text-muted"> {r.unit}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}