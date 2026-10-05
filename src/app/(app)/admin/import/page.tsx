"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { ImportReportResponse } from "@/server/import-report";
import { Alert, Card, EmptyState, ErrorNote, Loading, PageHeader, Stat } from "@/components/ui";

const sections = [
  "gaps",
  "expired",
  "noExpiry",
  "stoppedRecording",
  "lateOpenings",
  "mismatches",
] as const;

type SectionKey = (typeof sections)[number];

const HEADINGS: { key: SectionKey; title: string; blurb: string; tone: "warn" | "danger" | "plain" }[] = [
  {
    key: "mismatches",
    title: "Month ends that do not rebuild",
    blurb: "A month-end balance the app cannot reproduce from the movements. Every one of these needs a person to look at it.",
    tone: "danger",
  },
  {
    key: "gaps",
    title: "Month openings that did not match the previous close",
    blurb: "Each of these became an adjustment entry, so the numbers add up. Open the item to see it in the history, and correct it there if the sheet was wrong.",
    tone: "warn",
  },
  {
    key: "expired",
    title: "Stock on hand past its expiry",
    blurb: "Imported as it was found, flagged rather than hidden. Dispose of it from the Expiry screen once it is cleared from the shelf.",
    tone: "danger",
  },
  {
    key: "noExpiry",
    title: "Stock on hand with no expiry recorded",
    blurb: "The workbook never had an expiry for these. Receiving now asks for one, so this list should only get shorter.",
    tone: "warn",
  },
  {
    key: "stoppedRecording",
    title: "Items the office stopped recording",
    blurb: "Their rows stop before the newest month, so the balance is frozen at whatever it was. Confirm whether the item is still in use.",
    tone: "plain",
  },
  {
    key: "lateOpenings",
    title: "Items that joined the sheet later, already holding stock",
    blurb: "Added to the sheet after the first day, with stock already on the shelf, so the opening is dated to the day they appeared.",
    tone: "plain",
  },
];

function countOf(report: ImportReportResponse, key: SectionKey): number {
  if (key === "mismatches") return report.reconciliation?.mismatches.length ?? 0;
  if (key === "gaps") return report.gaps.length;
  if (key === "expired") return report.expired.length;
  if (key === "noExpiry") return report.noExpiry.length;
  if (key === "stoppedRecording") return report.stoppedRecording.length;
  return report.lateOpenings.length;
}

function ItemLink({ id }: { id: string }) {
  return (
    <Link href={`/items/${encodeURIComponent(id)}`} className="font-mono text-xs text-accent hover:underline">
      {id}
    </Link>
  );
}

export default function ImportPage() {
  const { data, error, loading } = useApi(() => api.importReport(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  if (!data.imported || !data.summary || !data.reconciliation) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Workbook import"
          description="What came in from the old spreadsheet, and what still needs a decision."
        />
        <EmptyState
          title="The workbook has not been imported yet."
          hint={
            <>
              Run <code className="font-mono">npm run import:workbook -- --report</code> to see what would happen, then{" "}
              <code className="font-mono">-- --apply</code> to load it. This screen then shows the report.
            </>
          }
        />
      </div>
    );
  }

  const { summary, reconciliation } = data;
  const matched = reconciliation.monthEndsChecked - reconciliation.mismatches.length;
  const units = (n: number) => `${n.toLocaleString()} ${n === 1 ? "unit" : "units"}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workbook import"
        description="What came in from the old spreadsheet, and what still needs a decision. Nothing here changes on its own; the entries are already in the app."
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Month ends" value={`${matched}/${reconciliation.monthEndsChecked}`} tone={reconciliation.mismatches.length ? "danger" : "ok"} />
        <Stat label="Entries" value={Object.values(summary.counts).reduce((s, n) => s + n, 0).toLocaleString()} />
        <Stat label="Units on hand" value={summary.unitsOnHand.toLocaleString()} />
        <Stat label="Needs attention" value={sections.reduce<number>((s, k) => s + countOf(data, k), 0)} tone="warn" />
      </dl>

      <Card className="p-4 text-sm">
        <p>
          Loaded from <span className="font-mono text-xs">{data.workbook ?? "the workbook"}</span>
          {data.importedBy ? ` by ${data.importedBy}` : ""}
          {data.appliedAt ? ` on ${data.appliedAt.slice(0, 10)}` : ""}.
        </p>
        <p className="mt-1 text-muted">
          {summary.months} months, {summary.firstDate} to {summary.lastDate}, covering {summary.items} items.
          Received {units(summary.receivedUnits)} and dispensed {units(summary.dispensedUnits)} against the workbook&apos;s
          own totals.
        </p>
        {data.rejectedGaps.length ? (
          <p className="mt-1 text-warn">
            {data.rejectedGaps.length} gap(s) were left unadjusted on purpose: {data.rejectedGaps.join(", ")}.
          </p>
        ) : null}
      </Card>

      {HEADINGS.map(({ key, title, blurb, tone }) => {
        const count = countOf(data, key);
        return (
          <section key={key} className="flex flex-col gap-2">
            <div>
              <h2 className="font-semibold">
                {title}{" "}
                <span className={tone === "plain" ? "text-muted" : tone === "danger" ? "text-danger" : "text-warn"}>
                  ({count})
                </span>
              </h2>
              <p className="max-w-prose text-sm text-muted">{blurb}</p>
            </div>

            {count === 0 ? (
              <p className="text-sm text-ok">Nothing to do here.</p>
            ) : key === "mismatches" ? (
              <MismatchTable rows={reconciliation.mismatches} />
            ) : key === "gaps" ? (
              <GapTable rows={data.gaps} />
            ) : key === "expired" || key === "noExpiry" ? (
              <BatchTable rows={key === "expired" ? data.expired : data.noExpiry} showExpiry={key === "expired"} />
            ) : key === "stoppedRecording" ? (
              <StoppedTable rows={data.stoppedRecording} />
            ) : (
              <LateOpeningTable rows={data.lateOpenings} />
            )}
          </section>
        );
      })}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Months read ({data.months.length})</h2>
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Tab</th>
                <th scope="col" className="px-3 py-2 font-medium">Rows</th>
                <th scope="col" className="px-3 py-2 font-medium">Covers</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-t border-rule">
                  <td className="px-3 py-1.5 text-xs">{m.sheet}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{m.rows.toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted">
                    {m.firstDate} to {m.lastDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.sources.length ? (
        <Alert tone="info">
          Deliveries came from {[...new Set(data.sources.map((s) => s.source))].join(", ")} across{" "}
          {data.sources.length} months.
        </Alert>
      ) : null}

      {data.unmatchedWideRows.length ? (
        <Alert tone="warn">
          {data.unmatchedWideRows.length} row(s) in the wide sheet matched no item ID, so nothing was imported from
          them: {data.unmatchedWideRows.map((u) => `${u.sheet} row ${u.row} "${u.name}"`).join(", ")}.
        </Alert>
      ) : null}
    </div>
  );
}

function MismatchTable({ rows }: { rows: { month: string; itemId: string; expected: number; rebuilt: number }[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-danger/40">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Month</th>
            <th scope="col" className="px-3 py-2 font-medium">Item</th>
            <th scope="col" className="px-3 py-2 font-medium">Workbook</th>
            <th scope="col" className="px-3 py-2 font-medium">Rebuilt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.month}-${r.itemId}`} className="border-t border-rule">
              <td className="px-3 py-1.5 font-mono text-xs">{r.month}</td>
              <td className="px-3 py-1.5"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.expected}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-danger">{r.rebuilt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GapTable({ rows }: { rows: ImportReportResponse["gaps"] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Item</th>
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Was</th>
            <th scope="col" className="px-3 py-2 font-medium">Became</th>
            <th scope="col" className="px-3 py-2 font-medium">Adjustment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={`${g.itemId}-${g.date}`} className="border-t border-rule">
              <td className="px-3 py-1.5"><ItemLink id={g.itemId} /></td>
              <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{g.date}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-muted">{g.from}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{g.to}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-warn">
                {g.difference > 0 ? `+${g.difference}` : g.difference}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchTable({ rows, showExpiry }: { rows: ImportReportResponse["expired"]; showExpiry: boolean }) {
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <>
      <p className="text-sm text-muted">
        {total.toLocaleString()} units across {rows.length} batches.
      </p>
      <div className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Item</th>
              {showExpiry ? <th scope="col" className="px-3 py-2 font-medium">Expiry</th> : null}
              <th scope="col" className="px-3 py-2 font-medium">Units</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.itemId}-${r.expiry ?? "none"}`} className="border-t border-rule">
                <td className="px-3 py-1.5"><ItemLink id={r.itemId} /></td>
                {showExpiry ? <td className="px-3 py-1.5 font-mono text-xs">{r.expiry}</td> : null}
                <td className="px-3 py-1.5 font-mono text-xs">{r.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StoppedTable({ rows }: { rows: ImportReportResponse["stoppedRecording"] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Item</th>
            <th scope="col" className="px-3 py-2 font-medium">Last recorded</th>
            <th scope="col" className="px-3 py-2 font-medium">Frozen balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t border-rule">
              <td className="px-3 py-1.5"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.lastDate}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LateOpeningTable({ rows }: { rows: ImportReportResponse["lateOpenings"] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Item</th>
            <th scope="col" className="px-3 py-2 font-medium">First seen</th>
            <th scope="col" className="px-3 py-2 font-medium">Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t border-rule">
              <td className="px-3 py-1.5"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.date}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}