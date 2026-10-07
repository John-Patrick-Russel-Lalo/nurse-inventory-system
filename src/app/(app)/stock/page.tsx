"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { api, downloadUrls } from "@/lib/api";
import { CATEGORIES } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { DownloadButton } from "@/components/DownloadButton";
import {
  Card,
  Checkbox,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  IconChevron,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Stat,
  TableWrap,
  cn,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
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
        description="Every balance is the sum of the entries behind it. Open a row to see which batch it sits in."
      />

      {/* Filters sit in one card so they read as a single control, not four loose inputs. */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="stock-q" className="text-sm font-medium">Search</label>
          <SearchInput
            id="stock-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, brand or ID…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stock-category" className="text-sm font-medium">Category</label>
          <Select
            id="stock-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-44"
          >
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex h-[38px] items-center pb-0.5">
          <Checkbox label="Low stock only" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
        </div>
        <div className="ml-auto">
          {/* The file carries the filters above, so it always matches what is on screen. */}
          <DownloadButton
            url={downloadUrls.stock({ q, category, lowOnly })}
            fallbackName={lowOnly ? "stock-low.xlsx" : "stock.xlsx"}
            size="md"
          >
            Export to Excel
          </DownloadButton>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}

      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Items shown" value={data.total.items} />
            <Stat label="Total units" value={data.total.units} />
            <Stat
              label="Low stock"
              value={data.total.lowStock}
              tone={data.total.lowStock ? "warn" : "plain"}
            />
            <Stat
              label="Expired stock"
              value={data.total.expired}
              tone={data.total.expired ? "danger" : "plain"}
            />
          </dl>

          {refreshing ? <p className="text-xs text-muted">Refreshing…</p> : null}

          <Panel
            title={lowOnly ? "Low stock only" : category === "ALL" ? "All items" : category.charAt(0) + category.slice(1).toLowerCase()}
            description={q ? `Matching “${q}”` : undefined}
          >
            {data.rows.length === 0 ? (
              <EmptyState
                title="No items match."
                hint="Clear the search, widen the category, or turn off “Low stock only”."
              />
            ) : (
              <TableWrap className={cn(refreshing && "opacity-60")}>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Item</th>
                    <th scope="col" className={thClass}>Category</th>
                    <th scope="col" className={thRightClass}>On hand</th>
                    <th scope="col" className={thRightClass}>Reorder at</th>
                    <th scope="col" className={thClass}>Nearest expiry</th>
                    <th scope="col" className={thClass}><span className="sr-only">Batches</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(({ item, batches }) => {
                    const open = expanded === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr className={rowClass}>
                          <td className="px-3 py-2">
                            <Link href={`/items/${item.id}`} className={linkClass}>
                              {item.name}
                              {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                            </Link>
                            <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{item.category}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            <span className={cn("font-medium", item.lowStock && "text-warn", item.expiredQty > 0 && "text-danger")}>
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
                                className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface hover:text-fg"
                              >
                                {batches.length} batch{batches.length === 1 ? "" : "es"}
                                <IconChevron className={cn("transition-transform duration-150", open && "rotate-90")} />
                              </button>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-rule bg-surface-2">
                            <td colSpan={6} className="px-3 py-3">
                              <table className="w-full border-collapse text-xs">
                                <thead>
                                  <tr>
                                    <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Batch</th>
                                    <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Expiry</th>
                                    <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Status</th>
                                    <th scope="col" className="py-1 pr-3 text-right font-semibold tracking-wider text-muted uppercase">Received</th>
                                    <th scope="col" className="py-1 text-right font-semibold tracking-wider text-muted uppercase">Balance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batches.map((b) => (
                                    <tr key={b.id}>
                                      <td className="py-1 pr-3">
                                        <span className="font-mono">#{b.id}</span>
                                        {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                                        {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                                      </td>
                                      <td className="py-1 pr-3 font-mono">{b.expiry ?? "unknown"}</td>
                                      <td className="py-1 pr-3"><ExpiryBadge status={b.expiryStatus} /></td>
                                      <td className="py-1 pr-3 text-right font-mono">{b.qtyReceived}</td>
                                      <td className={cn("py-1 text-right font-mono font-medium", b.balance === 0 && "text-muted")}>
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
              </TableWrap>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}