"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import {
  Alert,
  Button,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Stat,
  TableWrap,
  cn,
  rowClass,
  thClass,
} from "@/components/ui";

const ACTIONS = [
  "ALL",
  "transaction.receive",
  "transaction.dispense",
  "transaction.adjust",
  "transaction.dispose",
  "transaction.opening",
  "transaction.void",
  "item.create",
  "item.update",
  "month.count",
  "month.close",
  "month.reopen",
] as const;

const PAGE = 100;

/** Formats the JSON detail blob into something readable, since audit details are free-form. */
function summarise(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail !== "object") return String(detail);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length) parts.push(`${key}: ${value.map((v) => JSON.stringify(v)).join(", ")}`);
    } else if (typeof value === "object") {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join(" · ");
}

export default function AuditLogPage() {
  const [action, setAction] = useState<string>("ALL");
  const [entityId, setEntityId] = useState("");
  const [applied, setApplied] = useState<{ action: string; entityId: string }>({ action: "ALL", entityId: "" });
  const [offset, setOffset] = useState(0);

  const { data, error, loading, refreshing } = useApi(
    () => api.audit({ action: applied.action, entityId: applied.entityId, limit: PAGE, offset }),
    [applied, offset],
  );

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every stock change, item edit and month action, with who did it and when. Entries are never edited or removed."
      />

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied({ action, entityId: entityId.trim() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-action" className="text-sm font-medium">Action</label>
          <Select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="w-52">
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "ALL" ? "All actions" : a}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-entity" className="text-sm font-medium">Item or entry</label>
          <SearchInput
            id="audit-entity"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="MED-001 or a month"
            className="w-48"
          />
        </div>
        <Button type="submit" size="md" className="h-[38px]">
          Filter
        </Button>
      </form>

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}

      {data ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Matching entries" value={data.total} />
          <Stat label="Shown on this page" value={entries.length} hint={`${PAGE} at a time`} />
          <Stat
            label="Page"
            value={data.total === 0 ? 1 : Math.floor(offset / PAGE) + 1}
            hint={`From entry ${offset + 1}`}
          />
        </dl>
      ) : null}

      {refreshing ? <p className="text-xs text-muted">Loading…</p> : null}

      {data && entries.length === 0 ? (
        <EmptyState title="Nothing matches." hint="Widen the filter, or clear the item reference." />
      ) : null}

      {entries.length > 0 ? (
        <>
          <Panel title="Log" description="Newest first. Rows are colour-coded when something was reversed.">
            <TableWrap className={cn(refreshing && "opacity-60")}>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>When</th>
                  <th scope="col" className={thClass}>Who</th>
                  <th scope="col" className={thClass}>Action</th>
                  <th scope="col" className={thClass}>Entity</th>
                  <th scope="col" className={thClass}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const dangerous = e.action === "transaction.void" || e.action === "month.reopen";
                  return (
                    <tr key={e.id} className={rowClass}>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {e.at.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">{e.userName ?? "—"}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 font-mono text-xs whitespace-nowrap",
                          dangerous && "font-medium text-danger",
                        )}
                      >
                        {e.action}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {e.entity}
                        <span className="ml-1 text-muted">{e.entityId}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">{summarise(e.detail)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>

          <div className="flex items-center gap-2">
            <Button variant="plain" size="md" onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0}>
              ← Newer
            </Button>
            <Button
              variant="plain"
              size="md"
              onClick={() => setOffset((o) => o + PAGE)}
              disabled={!data || offset + PAGE >= data.total}
            >
              Older →
            </Button>
          </div>
        </>
      ) : null}

      {data && data.total > entries.length && entries.length === 0 ? (
        <Alert tone="info">Nothing on this page. Go back a page.</Alert>
      ) : null}
    </div>
  );
}
