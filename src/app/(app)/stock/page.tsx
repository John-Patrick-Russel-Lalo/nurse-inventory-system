"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { api } from "@/lib/api";
import { CATEGORIES } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import {
  Checkbox,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Input,
  Loading,
  LowBadge,
  PageHeader,
  Select,
  Stat,
  cn,
} from "@/components/ui";

export default function StockPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [lowOnly, setLowOnly] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  const { data, error, loading, refreshing } = useApi(
    () => api.stock({ q, category, lowOnly }),
    [q, category, lowOnly],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock on hand"
        description="Balances are the sum of every entry, never a stored number. Expand a row to see the batches."
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, brand or ID…"
            type="search"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Category
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-40">
            <option value="ALL">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        <div className="pb-2">
          <Checkbox label="Low stock only" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
        </div>
      </div>

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}

      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Items shown" value={data.total.items} />
            <Stat label="Total units" value={data.total.units} />
            <Stat label="Low stock" value={data.total.lowStock} tone={data.total.lowStock ? "warn" : "plain"} />
            <Stat label="With expired stock" value={data.total.expired} tone={data.total.expired ? "danger" : "plain"} />
          </dl>

          {refreshing ? <p className="text-xs text-muted">Refreshing…</p> : null}

          {data.rows.length === 0 ? (
            <EmptyState title="No items match." hint="Clear the search, or pick a different category." />
          ) : (
            <div className={cn("overflow-x-auto rounded-md border border-rule", refreshing && "opacity-60")}>
              <table className="w-full border-collapse text-sm">
                <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Item</th>
                    <th scope="col" className="px-3 py-2 font-medium">Category</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">On hand</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Reorder at</th>
                    <th scope="col" className="px-3 py-2 font-medium">Nearest expiry</th>
                    <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Batches</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(({ item, batches }) => {
                    const open = expanded === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr className="border-t border-rule">
                          <td className="px-3 py-2">
                            <Link href={`/items/${item.id}`} className="underline underline-offset-2">
                              {item.name}
                              {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                            </Link>
                            <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{item.category}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            <span className={cn(item.lowStock && "text-warn", item.expiredQty > 0 && "text-danger")}>
                              {item.balance}
                            </span>
                            {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                            {item.lowStock ? <LowBadge /> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted">{item.reorderLevel ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {item.nearestExpiry ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {batches.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setExpanded(open ? undefined : item.id)}
                                aria-expanded={open}
                                className="text-xs text-muted underline underline-offset-2 hover:text-fg"
                              >
                                {open ? "Hide" : `${batches.length} batch${batches.length === 1 ? "" : "es"}`}
                              </button>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-rule bg-bg">
                            <td colSpan={6} className="px-3 py-2">
                              <table className="w-full border-collapse text-xs">
                                <thead className="text-left uppercase tracking-wider text-muted">
                                  <tr>
                                    <th scope="col" className="py-1 font-medium">Batch</th>
                                    <th scope="col" className="py-1 font-medium">Expiry</th>
                                    <th scope="col" className="py-1 font-medium">Status</th>
                                    <th scope="col" className="py-1 font-medium">Received</th>
                                    <th scope="col" className="py-1 text-right font-medium">Balance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batches.map((b) => (
                                    <tr key={b.id}>
                                      <td className="py-1">
                                        <span className="font-mono">#{b.id}</span>
                                        {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                                        {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                                      </td>
                                      <td className="py-1 font-mono">{b.expiry ?? "unknown"}</td>
                                      <td className="py-1"><ExpiryBadge status={b.expiryStatus} /></td>
                                      <td className="py-1 font-mono">{b.qtyReceived}</td>
                                      <td className={cn("py-1 text-right font-mono", b.balance === 0 && "text-muted")}>
                                        {b.balance}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
