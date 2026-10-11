"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ItemDetail, ItemSummary, MovementBody, MovementResult } from "@/lib/api-types";
import { CATEGORIES } from "@/lib/api-types";
import { monthOf } from "@/lib/dates";
import { allocateFefo } from "@/lib/stock";
import { usePermissions } from "@/components/SessionProvider";
import { useFocusMode } from "@/components/FocusMode";
import { ItemPicker } from "@/components/ItemPicker";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  TableWrap,
  Textarea,
  categoryLabel,
  cn,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

type Kind = "RECEIVE" | "DISPENSE" | "DISPOSE" | "ADJUST";

const TABS: { kind: Kind; label: string; blurb: string }[] = [
  {
    kind: "RECEIVE",
    label: "Received",
    blurb: "Stock that arrived — from a supplier, a ward, or a delivery. The expiry you enter decides which batch it joins.",
  },
  {
    kind: "DISPENSE",
    label: "Given out",
    blurb: "Medicine or supplies you handed out. It suggests the batch that expires soonest, and you can change which batch it came from.",
  },
  {
    kind: "DISPOSE",
    label: "Thrown away",
    blurb: "Stock you removed because it expired, broke, or was recalled. Pick which batch it came from, and say why in the remarks.",
  },
  {
    kind: "ADJUST",
    label: "Correction",
    blurb: "Change one batch so it matches what you counted on the shelf. Use this after a stock count.",
  },
];

/** One batch row in the "which batch" table, with the amount the nurse is taking from it. */
interface Line {
  batchId: number;
  qty: number;
  expiry: string | null;
  label: string | null;
  balance: number;
}

export default function ReceivePage() {
  const { isAdmin, today, nurseBackdateDays, closedMonths } = usePermissions();
  const { focus, setFocus } = useFocusMode();

  const [kind, setKind] = useState<Kind>("RECEIVE");
  const [receiveType, setReceiveType] = useState<"RECEIVE" | "OPENING">("RECEIVE");
  const [item, setItem] = useState<ItemSummary>();
  const [detail, setDetail] = useState<ItemDetail>();
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [lot, setLot] = useState("");
  const [batchId, setBatchId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [manual, setManual] = useState<Record<number, number>>({});
  const [edited, setEdited] = useState(false);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState("");
  const [remarks, setRemarks] = useState("");
  const [result, setResult] = useState<MovementResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [allItems, setAllItems] = useState<ItemSummary[]>();
  const [listQuery, setListQuery] = useState("");
  const [listCategory, setListCategory] = useState("ALL");
  const [page, setPage] = useState(0);

  const amount = Number(qty);
  const monthClosed = closedMonths.includes(monthOf(date));

  // Load every item once (again after each save, so the balances in the overview stay true).
  useEffect(() => {
    let live = true;
    api
      .items()
      .then((r) => live && setAllItems(r.items))
      .catch(() => live && setAllItems([]));
    return () => {
      live = false;
    };
  }, [result]);

  // Filter in the browser, the same way the item picker does.
  const filteredItems = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return (allItems ?? []).filter((i) => {
      if (listCategory !== "ALL" && i.category !== listCategory) return false;
      if (!q) return true;
      return `${i.id} ${i.name} ${i.variant ?? ""}`.toLowerCase().includes(q);
    });
  }, [allItems, listQuery, listCategory]);

  // Ten to a page: a long catalogue reads better in small pages than one long scroll.
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageItems = filteredItems.slice(pageStart, pageStart + pageSize);

  // A new search or category starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [listQuery, listCategory]);

  // Choosing from the overview table fills the form above and clears whatever was half-typed.
  const choose = (picked: ItemSummary) => {
    setItem(picked);
    setQty("");
    setExpiry("");
    setLot("");
    setBatchId("");
    setAdjustQty("");
    setManual({});
    setEdited(false);
    setResult(undefined);
    setError(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Deep-link straight to a tab, e.g. the dashboard's "Dispense stock" shortcut.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")?.toUpperCase();
    const match = TABS.find((t) => t.kind === requested);
    if (match) setKind(match.kind);
  }, []);

  // Load the item's batches: the ADJUST tab picks one directly; the others list every usable batch.
  useEffect(() => {
    if (!item || kind === "RECEIVE") {
      setDetail(undefined);
      setManual({});
      return;
    }
    let live = true;
    setDetail(undefined);
    setManual({});
    setEdited(false);
    api
      .item(item.id)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : undefined));
    return () => {
      live = false;
    };
  }, [item, kind]);

  // A new quantity starts the split fresh from earliest-expiry-first.
  useEffect(() => {
    setEdited(false);
    setManual({});
  }, [amount]);

  // Every batch that still holds stock and is not expired, earliest expiry first — the order the
  // nurse would reach for them in. Expired batches are kept to the side so they are never used.
  const liveBatches = detail?.batches.filter((b) => b.balance > 0) ?? [];
  const usableBatches = liveBatches
    .filter((b) => b.expiryStatus !== "EXPIRED")
    .sort((a, b) => {
      if (a.expiry === b.expiry) return a.id - b.id;
      if (a.expiry === null) return 1;
      if (b.expiry === null) return -1;
      return a.expiry < b.expiry ? -1 : 1;
    });
  const expiredBatches = liveBatches.filter((b) => b.expiryStatus === "EXPIRED");
  const usableTotal = usableBatches.reduce((s, b) => s + b.balance, 0);

  // The earliest-expiry-first suggestion for this amount, as a batchId -> quantity map. Null when
  // there is nothing to suggest (no amount yet, or not enough usable stock).
  const suggested = useMemo(() => {
    if (!Number.isInteger(amount) || amount <= 0 || amount > usableTotal) return null;
    const split = allocateFefo(
      usableBatches.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance })),
      amount,
      today,
    );
    const out: Record<number, number> = {};
    for (const line of split) out[line.batchId] = line.qty;
    return out;
  }, [usableBatches, usableTotal, amount, today]);

  // One row per usable batch: the typed split once the nurse has changed it, otherwise the
  // earliest-expiry-first suggestion.
  const amounts = edited ? manual : (suggested ?? {});
  const lineViews: Line[] = usableBatches.map((b) => ({
    batchId: b.id,
    qty: amounts[b.id] ?? 0,
    expiry: b.expiry,
    label: b.label,
    balance: b.balance,
  }));
  const lineTotal = lineViews.reduce((s, l) => s + l.qty, 0);
  const isSplit = lineViews.filter((l) => l.qty > 0).length > 1;
  const shortOfStock = Number.isInteger(amount) && amount > 0 && amount > usableTotal;

  const reset = () => {
    setItem(undefined);
    setQty("");
    setExpiry("");
    setLot("");
    setBatchId("");
    setAdjustQty("");
    setManual({});
    setEdited(false);
    setSource("");
    setRemarks("");
    setDate(today);
    setResult(undefined);
    setError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return setError("Choose an item first.");

    let body: MovementBody;

    if (kind === "RECEIVE") {
      if (!Number.isInteger(amount) || amount <= 0) return setError("Enter a whole quantity above zero.");
      body = {
        type: receiveType,
        itemId: item.id,
        qty: amount,
        date,
        // The month picker gives "YYYY-MM"; the server reads a date and keeps the month's last day.
        expiry: expiry ? `${expiry}-01` : null,
        lot: lot || null,
        source: source || null,
        remarks: remarks || null,
      };
    } else if (kind === "ADJUST") {
      const delta = Number(adjustQty);
      if (!batchId) return setError("Choose the batch to correct.");
      if (!Number.isInteger(delta) || delta === 0) {
        return setError("Enter the change, for example -2 or 5. Not zero.");
      }
      body = { type: "ADJUST", itemId: item.id, qty: delta, batchId: Number(batchId), date, source: source || null, remarks: remarks || null };
    } else {
      if (!Number.isInteger(amount) || amount <= 0) return setError("Enter a whole quantity above zero.");
      // Only send a manual split when one was actually made; otherwise let the rules take the
      // earliest expiry first.
      const chosen = lineViews.filter((l) => l.qty > 0);
      body = {
        type: kind,
        itemId: item.id,
        qty: amount,
        date,
        source: source || null,
        remarks: remarks || null,
        ...(edited && chosen.length ? { allocations: chosen.map((l) => ({ batchId: l.batchId, qty: l.qty })) } : {}),
      };
    }

    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.record(body));
      setQty("");
      setExpiry("");
      setLot("");
      setAdjustQty("");
      setManual({});
      setEdited(false);
      setRemarks("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the entry.");
    } finally {
      setBusy(false);
    }
  };

  const tab = TABS.find((t) => t.kind === kind)!;
  const receiveLabel = receiveType === "OPENING" ? "starting count" : "received";
  const saveLabel =
    kind === "RECEIVE"
      ? `Save ${receiveLabel}`
      : kind === "DISPENSE"
        ? "Save as given out"
        : kind === "DISPOSE"
          ? "Save as thrown away"
          : "Save correction";

  return (
    <div className="flex flex-col gap-6">
      {focus ? (
        <h1 className="sr-only">Record stock</h1>
      ) : (
        <PageHeader
          title="Record stock"
          description="What happened? Pick one of the four choices, then fill in the details below."
          actions={
            <Button type="button" variant="plain" onClick={() => setFocus(true)}>
              Focus mode
            </Button>
          }
        />
      )}

      {/* Segmented control rather than underline tabs: each option does something different, so they
          read as four equal choices. The active one is the only filled thing. It sticks to the top
          so the choice stays in reach while the long form below is being filled in. */}
      <div className="sticky top-0 z-30 -mx-1 -my-1 flex flex-col gap-2 bg-bg px-1 py-1">
        {focus ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-semibold tracking-wider text-muted uppercase">
              Focus mode — recording only
            </span>
            <Button type="button" variant="plain" size="sm" onClick={() => setFocus(false)}>
              Back to normal view
            </Button>
          </div>
        ) : null}
        <div
          className="flex flex-wrap gap-1.5 rounded-2xl border border-rule bg-surface p-1.5 shadow-card"
          role="tablist"
          aria-label="Entry type"
        >
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => {
                setKind(t.kind);
                setError(undefined);
                setResult(undefined);
                setManual({});
                setEdited(false);
              }}
              className={cn(
                "cursor-pointer flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.99]",
                kind === t.kind
                  ? "bg-accent-soft font-semibold text-accent shadow-raised"
                  : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{tab.blurb}</p>
      </div>

      {result ? (
        <Alert tone="success">
          <span className="font-medium">Saved.</span> {item?.name} is now at{" "}
          <span className="font-mono">{result.balances[item!.id]}</span>
          {item?.unit ? ` ${item.unit}` : ""} on the shelf.
          {result.allocations && result.allocations.length > 1 ? " It was taken from more than one batch, as shown above." : ""}
        </Alert>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Panel
          title="1. Choose the item"
          description="Search the list, then pick the item."
          className="max-w-2xl"
        >
          <div className="flex flex-col gap-3">
            {kind === "RECEIVE" && isAdmin ? (
              <Field label="Kind of entry" htmlFor="receiveType" className="max-w-xs">
                <Select
                  id="receiveType"
                  value={receiveType}
                  onChange={(e) => setReceiveType(e.target.value as "RECEIVE" | "OPENING")}
                >
                  <option value="RECEIVE">Received (adds to the shelf)</option>
                  <option value="OPENING">Starting count (the figure you began with)</option>
                </Select>
              </Field>
            ) : null}
            <ItemPicker value={item} onChange={setItem} />
            {item ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-sm">
                <span className="font-medium">{item.name}</span>
                {item.variant ? <span className="text-muted">{item.variant}</span> : null}
                <span className="font-mono text-xs text-muted">{item.id}</span>
                <span className="ml-auto font-mono">
                  On hand: <span className="font-semibold">{item.balance}</span>
                  {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                </span>
              </div>
            ) : null}
          </div>
        </Panel>

        {item ? (
          <Panel
            title={kind === "ADJUST" ? "2. Which batch, and how much to change it by?" : "2. How much, and when?"}
            description={
              kind === "ADJUST"
                ? "Change one batch so it matches what you counted on the shelf."
                : kind === "RECEIVE"
                  ? "The expiry decides which batch the stock joins."
                  : "The batch with the earliest expiry is used first. Change the split below if that is not what you want."
            }
            className="max-w-2xl"
          >
            <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
              {kind === "ADJUST" ? (
                <>
                  <Field label="Batch" htmlFor="batch" hint="Only batches that still hold stock.">
                    <Select id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                      <option value="">Choose a batch…</option>
                      {usableBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          #{b.id} · {b.expiry ?? "no expiry"} · {b.balance} on hand
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Change by" htmlFor="adjust" hint="A plus number adds, a minus number removes. For example 5 or -2.">
                    <Input
                      id="adjust"
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(e.target.value)}
                      type="number"
                      step={1}
                      required
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="Quantity"
                    htmlFor="qty"
                    hint={
                      kind === "RECEIVE"
                        ? item.unit
                          ? `How many arrived? In ${item.unit}. Whole numbers only.`
                          : "How many arrived? Whole numbers only."
                        : item.unit
                          ? `How many? In ${item.unit}. Available: ${usableTotal}.`
                          : `How many? Available: ${usableTotal}.`
                    }
                  >
                    <Input
                      id="qty"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      required
                    />
                  </Field>
                  {kind === "RECEIVE" ? (
                    <>
                      <Field
                        label="Expiry"
                        htmlFor="expiry"
                        hint="Pick the month shown on the box. Leave empty if the box has no date."
                      >
                        <Input id="expiry" type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                      </Field>
                      <Field label="Lot number" htmlFor="lot" hint="Optional. Stored with the batch.">
                        <Input id="lot" value={lot} onChange={(e) => setLot(e.target.value)} />
                      </Field>
                    </>
                  ) : null}
                </>
              )}

              <Field
                label="Date"
                htmlFor="date"
                hint={
                  isAdmin
                    ? "You can change the date, but it cannot be in the future."
                    : `You can go back up to ${nurseBackdateDays} days.`
                }
              >
                <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
              </Field>

              <Field
                label="Source"
                htmlFor="source"
                hint={kind === "RECEIVE" ? "Supplier, ward or person handing it over." : kind === "DISPENSE" ? "Ward or patient reference." : "Where it went or why it went."}
              >
                <Input id="source" value={source} onChange={(e) => setSource(e.target.value)} />
              </Field>

              <Field
                label="Remarks"
                htmlFor="remarks"
                className={kind === "RECEIVE" ? "sm:col-span-2" : undefined}
                hint="Optional, but a reason here makes the Activity history easier to read later."
              >
                <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>
          </Panel>
        ) : null}

        {(kind === "DISPENSE" || kind === "DISPOSE") && item && amount > 0 && usableBatches.length > 0 ? (
          <Panel
            title="3. Which batch does it come from?"
            description={
              shortOfStock
                ? `This amount is more than the ${usableTotal} usable on the shelf. Lower the quantity, or record the missing stock first.`
                : usableBatches.length === 1
                  ? "This item has one batch, so the amount comes from it. Change it if you did not take all of it from this batch."
                  : isSplit
                    ? "This amount is more than one batch holds, so it comes from more than one. Check the amounts before saving."
                    : "Suggested from the batch that expires soonest. Change any amount if you took it from a different batch."
            }
            className="max-w-3xl"
            actions={
              edited ? (
                <Button
                  type="button"
                  variant="plain"
                  size="sm"
                  onClick={() => {
                    setEdited(false);
                    setManual({});
                  }}
                >
                  Use earliest expiry first
                </Button>
              ) : undefined
            }
          >
            <TableWrap className="shadow-none">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Batch</th>
                  <th scope="col" className={thClass}>Expiry</th>
                  <th scope="col" className={thRightClass}>On hand</th>
                  <th scope="col" className={thRightClass}>Taking</th>
                </tr>
              </thead>
              <tbody>
                {lineViews.map((line) => (
                  <tr key={line.batchId} className={rowClass}>
                    <td className="px-3 py-2 font-mono text-xs">
                      #{line.batchId}
                      {line.label ? <span className="ml-1 text-muted">{line.label}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{line.expiry ?? "no expiry"}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{line.balance}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={line.balance}
                        step={1}
                        value={line.qty}
                        aria-label={`Quantity from batch ${line.batchId}`}
                        onChange={(e) => {
                          const next = e.target.value === "" ? 0 : Number(e.target.value);
                          setEdited(true);
                          // Zeros are kept so the amount can be moved from one batch to another.
                          setManual(() => {
                            const base: Record<number, number> = {};
                            for (const l of lineViews) base[l.batchId] = l.qty;
                            base[line.batchId] = Number.isFinite(next) ? next : 0;
                            return base;
                          });
                        }}
                        className="w-20 text-right font-mono"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-rule bg-surface-2">
                  <td className="px-3 py-2 text-xs text-muted" colSpan={3}>
                    {edited ? "Your split" : "Earliest expiry first"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono font-semibold",
                      lineTotal !== amount ? "text-danger" : "",
                    )}
                  >
                    {lineTotal} / {amount}
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
            {lineTotal !== amount ? (
              <Alert tone={shortOfStock ? "error" : "warn"} className="mt-3">
                {shortOfStock
                  ? `Only ${usableTotal} usable in stock, but ${amount} was asked for.`
                  : `The batch amounts must add up to ${amount}. They currently add up to ${lineTotal}.`}
              </Alert>
            ) : null}
          </Panel>
        ) : null}

        {expiredBatches.length > 0 && (kind === "DISPENSE" || kind === "DISPOSE") ? (
          <Alert tone="warn">
            {expiredBatches.reduce((s, b) => s + b.balance, 0)} units on this item are already expired and are never
            handed out automatically. Record them as “Thrown away” to clear them.
          </Alert>
        ) : null}

        {monthClosed ? (
          <Alert tone="error">
            {monthOf(date)} is closed. Reopen it from “Month closing” before you can record anything here.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex max-w-2xl flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={
              busy ||
              !item ||
              monthClosed ||
              ((kind === "DISPENSE" || kind === "DISPOSE") &&
                (shortOfStock || (edited && lineTotal !== amount)))
            }
          >
            {busy ? "Saving…" : saveLabel}
          </Button>
          <Button type="button" variant="plain" size="lg" onClick={reset} disabled={busy}>
            Clear form
          </Button>
          {!item ? <span className="text-sm text-muted">Pick an item above to enable saving.</span> : null}
        </div>
      </form>

      {kind === "RECEIVE" ? (
        <Panel title="What happens when you save" className="max-w-2xl">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
            <li>Stock with the same item and the same expiry month is kept together as one batch.</li>
            <li>If you leave the expiry empty, it goes into a shared “no expiry” batch for that item.</li>
            <li>The on-hand figure is worked out from the entries, so it always stays correct.</li>
            <li>Your name and the time are saved with every entry.</li>
          </ul>
        </Panel>
      ) : (
        <Panel title="What the system does for you" className="max-w-2xl">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
            <li>It suggests the batch that expires soonest first, so nothing old is left behind.</li>
            <li>You can change which batch the amount comes from, and split it across batches if you need to.</li>
            <li>Expired stock is never handed out, and is never suggested.</li>
            <li>Stock can never go below zero, so the last unit cannot be handed out twice.</li>
          </ul>
        </Panel>
      )}

      {/* An overview of everything the office keeps, so the picker above is not the only way in. */}
      <Panel
        title="All items at a glance"
        description="Tap a row to choose that item for this entry. Use the search and category filters to narrow the list."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="sm:w-60">
              <label htmlFor="receive-list-q" className="sr-only">Search items</label>
              <SearchInput
                id="receive-list-q"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Name, brand or ID…"
              />
            </div>
            <div className="sm:w-40">
              <label htmlFor="receive-list-category" className="sr-only">Category</label>
              <Select
                id="receive-list-category"
                value={listCategory}
                onChange={(e) => setListCategory(e.target.value)}
              >
                <option value="ALL">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
      >
        {!allItems ? (
          <Loading label="Loading items…" />
        ) : filteredItems.length === 0 ? (
          <EmptyState title="No items match." hint="Clear the search or choose a different category." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Item</th>
                  <th scope="col" className={thClass}>Category</th>
                  <th scope="col" className={thRightClass}>On hand</th>
                  <th scope="col" className={thClass}>Nearest expiry</th>
                  <th scope="col" className={thRightClass}><span className="sr-only">Choose</span></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((row) => {
                  const selected = row.id === item?.id;
                  return (
                    <tr
                      key={row.id}
                      className={cn(rowClass, "cursor-pointer", selected && "bg-accent-soft")}
                      onClick={() => choose(row)}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            choose(row);
                          }}
                          className={cn(linkClass, "text-left")}
                        >
                          {row.name}
                          {row.variant ? <span className="text-muted"> · {row.variant}</span> : null}
                        </button>
                        <span className="ml-2 font-mono text-xs text-muted">{row.id}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{categoryLabel(row.category)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={cn("font-medium", row.lowStock && "text-warn", row.expiredQty > 0 && "text-danger")}>
                          {row.balance}
                        </span>
                        {row.unit ? <span className="text-muted"> {row.unit}</span> : null}
                        {row.lowStock ? <LowBadge /> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.nearestExpiry ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("text-xs", selected ? "font-medium text-accent" : "text-muted")}>
                          {selected ? "Selected" : "Choose"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filteredItems.length)} of {filteredItems.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="plain"
                  size="md"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                >
                  ← Back
                </Button>
                <span className="text-sm text-muted">
                  Page {safePage + 1} of {pageCount}
                </span>
                <Button
                  type="button"
                  variant="plain"
                  size="md"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
