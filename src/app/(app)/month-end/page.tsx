"use client";

import { useEffect, useMemo, useState } from "react";
import { api, downloadUrls } from "@/lib/api";
import type { CountRow, MonthEndResponse } from "@/lib/api-types";
import { monthOf, previousMonth } from "@/lib/dates";
import { usePermissions } from "@/components/SessionProvider";
import { DownloadButton } from "@/components/DownloadButton";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Stat,
  TableWrap,
  Textarea,
  cn,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

/** A rolling window of months to pick from, ending with the month in progress. */
function monthOptions(current: string): string[] {
  return Array.from({ length: 24 }, (_, i) => {
    const [y, m] = current.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function MonthEndPage() {
  const { isAdmin, today, closedMonths } = usePermissions();
  const current = monthOf(today);

  const [month, setMonth] = useState(previousMonth(current));
  const [sheet, setSheet] = useState<MonthEndResponse>();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reopenFor, setReopenFor] = useState<string>();
  const [reason, setReason] = useState("");

  const load = async (target: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.monthEnd(target);
      setSheet(next);
      // Seed the inputs from what is already saved, so a reload does not lose work in view.
      setCounts(
        Object.fromEntries(
          next.counts.filter((c) => c.counted !== null).map((c) => [c.itemId, String(c.counted)]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the month.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(month);
  }, [month]);

  const closed = !!sheet?.closed;

  /** Only rows whose input differs from the saved value, so a save is a small patch. */
  const dirty = useMemo(() => {
    if (!sheet) return [];
    return sheet.counts
      .map((row) => {
        const entered = counts[row.itemId];
        if (entered === undefined || entered.trim() === "") return null;
        const value = Number(entered);
        if (!Number.isInteger(value) || value < 0) return null;
        if (row.counted === value) return null;
        return { itemId: row.itemId, counted: value };
      })
      .filter((x): x is { itemId: string; counted: number } => x !== null);
  }, [sheet, counts]);

  const filled = useMemo(
    () => sheet?.counts.filter((c) => (counts[c.itemId] ?? "").trim() !== "").length ?? 0,
    [sheet, counts],
  );

  const variance = useMemo(
    () =>
      (sheet?.counts ?? []).reduce((sum, row) => {
        const entered = counts[row.itemId];
        if (entered === undefined || entered.trim() === "") return sum;
        const value = Number(entered);
        return Number.isInteger(value) ? sum + (value - row.system) : sum;
      }, 0),
    [sheet, counts],
  );

  const guard = async (fn: () => Promise<MonthEndResponse>, message: string) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setSheet(await fn());
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    guard(async () => {
      const next = await api.saveCounts({ month, counts: dirty });
      setCounts(
        Object.fromEntries(next.counts.filter((c) => c.counted !== null).map((c) => [c.itemId, String(c.counted)])),
      );
      return next;
    }, `Saved ${dirty.length} ${dirty.length === 1 ? "count" : "counts"}.`);

  const close = () =>
    guard(async () => api.closeMonth({ month }), `${month} is closed. Entries dated inside it are now refused.`);

  const reopen = () =>
    guard(async () => {
      const next = await api.reopenMonth({ month, reason });
      setReopenFor(undefined);
      setReason("");
      return next;
    }, `${month} is open again.`);

  const options = monthOptions(current);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Month end"
        description="Count the shelf, save the counts, then close the month so nothing can change inside it. Everyone can count; only an admin closes or reopens."
      />

      {/* Month picker and the ledger download share one row; the download always matches the month shown. */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="Month" htmlFor="month" className="w-48">
          <Select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
                {closedMonths.includes(m) ? " · closed" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="plain" size="md" onClick={() => void load(month)} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </Button>
        <div className="ml-auto">
          <DownloadButton url={downloadUrls.ledger({ month })} fallbackName={`ledger-${month}.xlsx`} size="md">
            Download the long-format tab
          </DownloadButton>
        </div>
      </Card>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}
      {loading ? <Loading /> : null}

      {sheet ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Items to count" value={sheet.summary.items} />
            <Stat
              label="Counted"
              value={filled}
              tone={filled === sheet.summary.items ? "ok" : "warn"}
              hint={`${sheet.summary.items - filled} left`}
            />
            <Stat
              label="Variance units"
              value={variance}
              tone={variance ? "warn" : "plain"}
              hint={variance ? "Counted minus system" : "Everything agrees"}
            />
            <Stat label="Status" value={closed ? "Closed" : "Open"} tone={closed ? "ok" : "plain"} hint={month} />
          </dl>

          {closed ? (
            <Alert tone="info">
              {month} was closed{sheet.closedAt ? ` on ${sheet.closedAt.slice(0, 10)}` : ""}. Nothing dated inside it
              can be recorded or voided until an admin reopens it.
            </Alert>
          ) : null}

          {/* The count sheet is the point of the page, so it gets the panel treatment and a
            caption explaining what the three numbers mean. */}
          <Panel
            title={`Count sheet for ${month}`}
            description="Type what is actually on the shelf. The difference column updates as you go."
          >
            {sheet.counts.length === 0 ? (
              <EmptyState
                title="No active items to count."
                hint="Every item in the catalogue is inactive or hidden, so there is nothing to count."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Item</th>
                    <th scope="col" className={thRightClass}>System says</th>
                    <th scope="col" className={thRightClass}>You counted</th>
                    <th scope="col" className={thRightClass}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.counts.map((row) => (
                    <CountRowView
                      key={row.itemId}
                      row={row}
                      value={counts[row.itemId] ?? ""}
                      disabled={closed || busy}
                      onChange={(v) => setCounts((c) => ({ ...c, [row.itemId]: v }))}
                    />
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <Panel title="The saved workbook tab" description="What the office keeps on file.">
            <p className="text-sm text-muted">
              The download is one row per item per day, where BEGINNING + RECEIVED − DISPENSED = ENDING. It is
              rebuilt from the entries rather than typed, so the sheet and the app cannot disagree.
            </p>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" onClick={save} disabled={busy || closed || dirty.length === 0}>
              {busy ? "Working…" : dirty.length ? `Save ${dirty.length} counts` : "Nothing to save"}
            </Button>

            {isAdmin && !closed && filled === sheet.summary.items && sheet.summary.items > 0 ? (
              <Button size="md" onClick={close} disabled={busy}>
                Close {month}
              </Button>
            ) : null}

            {isAdmin && closed ? (
              <Button variant="danger" size="md" onClick={() => setReopenFor(month)} disabled={busy}>
                Reopen {month}
              </Button>
            ) : null}

            {!isAdmin && !closed && filled < sheet.summary.items ? (
              <p className="text-sm text-muted">
                {sheet.summary.items - filled} left to count. Ask an admin to close the month once you are done.
              </p>
            ) : null}
          </div>

          {sheet.month === current ? (
            <p className="text-sm text-muted">
              {current} is the month in progress, so it cannot be closed yet. Close it after it ends.
            </p>
          ) : null}
        </>
      ) : null}

      {reopenFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="reopen-title">
          <div className="w-full max-w-md rounded-2xl border border-rule bg-surface p-6 shadow-float">
            <h2 id="reopen-title" className="text-lg font-semibold">Reopen {reopenFor}</h2>
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="warn">
                The saved counts for this month are deleted and entries dated inside it become editable again. The
                reason is kept in the audit log.
              </Alert>
              <Field label="Reason" htmlFor="reopen-reason" hint="At least a few words.">
                <Textarea
                  id="reopen-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Count was wrong, recounted…"
                  autoFocus
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="plain" size="md" onClick={() => setReopenFor(undefined)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="danger" size="md" onClick={reopen} disabled={busy || reason.trim().length < 3}>
                  {busy ? "Reopening…" : "Reopen month"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CountRowView({
  row,
  value,
  onChange,
  disabled,
}: {
  row: CountRow;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const entered = Number(value);
  const difference = value.trim() === "" || !Number.isInteger(entered) ? null : entered - row.system;
  const unmatched = difference !== null && difference !== 0 && row.system === 0;

  return (
    <tr className={rowClass}>
      <td className="px-3 py-1.5">
        <span className="font-medium">{row.itemName}</span>
        {row.variant ? <span className="text-muted"> · {row.variant}</span> : null}
        <span className="ml-2 font-mono text-xs text-muted">{row.itemId}</span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.system}</td>
      <td className="px-3 py-1.5 text-right">
        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          disabled={disabled}
          value={value}
          aria-label={`Counted quantity for ${row.itemName}`}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 text-right font-mono"
        />
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right font-mono",
          difference === null ? "text-muted" : difference === 0 ? "text-muted" : unmatched ? "text-danger" : "text-warn",
        )}
      >
        {difference === null ? "—" : difference > 0 ? `+${difference}` : difference}
      </td>
    </tr>
  );
}
