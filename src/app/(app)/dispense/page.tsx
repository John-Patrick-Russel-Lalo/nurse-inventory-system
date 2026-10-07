"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AllocationResponse, ItemDetail, ItemSummary, MovementBody, MovementResult } from "@/lib/api-types";
import { monthOf } from "@/lib/dates";
import { usePermissions } from "@/components/SessionProvider";
import { ItemPicker } from "@/components/ItemPicker";
import {
  Alert,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  TableWrap,
  Textarea,
  cn,
  rowClass,
  thClass,
  thRightClass,
  txLabel,
} from "@/components/ui";

type Kind = "DISPENSE" | "DISPOSE" | "ADJUST";

const TABS: { kind: Kind; label: string; blurb: string }[] = [
  {
    kind: "DISPENSE",
    label: "Dispense",
    blurb: "Stock handed out. The earliest expiry is used first unless you split it yourself.",
  },
  {
    kind: "DISPOSE",
    label: "Dispose",
    blurb: "Stock thrown away: expired, broken or recalled. Give a reason in the remarks.",
  },
  {
    kind: "ADJUST",
    label: "Adjust",
    blurb: "Correct one batch to a counted figure. Use this for month-end corrections.",
  },
];

/** The editable version of the server's earliest-expiry-first suggestion. */
interface Line {
  batchId: number;
  qty: number;
  expiry: string | null;
  label: string | null;
  balance: number;
}

export default function DispensePage() {
  const { today, nurseBackdateDays, closedMonths } = usePermissions();

  const [kind, setKind] = useState<Kind>("DISPENSE");
  const [item, setItem] = useState<ItemSummary>();
  const [detail, setDetail] = useState<ItemDetail>();
  const [qty, setQty] = useState("");
  const [batchId, setBatchId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [lines, setLines] = useState<Line[]>();
  const [edited, setEdited] = useState(false);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState("");
  const [remarks, setRemarks] = useState("");
  const [result, setResult] = useState<MovementResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const amount = Number(qty);
  const monthClosed = closedMonths.includes(monthOf(date));

  // Load the item's batches: the ADJUST tab picks one directly, the others suggest a split.
  useEffect(() => {
    if (!item) {
      setDetail(undefined);
      setLines(undefined);
      return;
    }
    let live = true;
    setDetail(undefined);
    setLines(undefined);
    setEdited(false);
    api
      .item(item.id)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : undefined));
    return () => {
      live = false;
    };
  }, [item]);

  // Ask the server how it would split this quantity, whenever the item or quantity changes.
  useEffect(() => {
    if (!item || kind === "ADJUST" || !Number.isInteger(amount) || amount <= 0) {
      setLines(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .allocate({ itemId: item.id, qty: amount })
        .then((r: AllocationResponse) => {
          if (!live) return;
          setEdited(false);
          setLines(
            r.allocations.map((a) => ({
              batchId: a.batchId,
              qty: a.qty,
              expiry: a.expiry,
              label: a.label,
              balance: a.balance,
            })),
          );
        })
        .catch((e) => {
          if (!live) return;
          // Out of stock and friends: show the problem, drop the stale suggestion.
          setLines(undefined);
          setError(e instanceof ApiError && e.code === "INSUFFICIENT_STOCK" ? e.message : undefined);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [item, amount, kind]);

  const liveBatches = detail?.batches.filter((b) => b.balance > 0) ?? [];
  const usable = liveBatches.filter((b) => b.expiryStatus !== "EXPIRED");
  const expiredBatches = liveBatches.filter((b) => b.expiryStatus === "EXPIRED");

  const lineTotal = lines?.reduce((s, l) => s + l.qty, 0) ?? 0;
  const isSplit = (lines?.length ?? 0) > 1;

  const reset = () => {
    setItem(undefined);
    setQty("");
    setBatchId("");
    setAdjustQty("");
    setLines(undefined);
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

    if (kind === "ADJUST") {
      const delta = Number(adjustQty);
      if (!batchId) return setError("Choose the batch to correct.");
      if (!Number.isInteger(delta) || delta === 0) {
        return setError("Enter the change, for example -2 or 5. Not zero.");
      }
      body = { type: "ADJUST", itemId: item.id, qty: delta, batchId: Number(batchId), date, source: source || null, remarks: remarks || null };
    } else {
      if (!Number.isInteger(amount) || amount <= 0) return setError("Enter a whole quantity above zero.");
      // Only send a manual split when one was actually made; otherwise let the server decide.
      body = {
        type: kind,
        itemId: item.id,
        qty: amount,
        date,
        source: source || null,
        remarks: remarks || null,
        ...(edited && lines?.length ? { allocations: lines.map((l) => ({ batchId: l.batchId, qty: l.qty })) } : {}),
      };
    }

    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.record(body));
      setQty("");
      setAdjustQty("");
      setLines(undefined);
      setRemarks("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the entry.");
    } finally {
      setBusy(false);
    }
  };

  const tab = TABS.find((t) => t.kind === kind)!;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dispense and correct" description={tab.blurb} />

      {/* Segmented control rather than underline tabs: each option does something different, so they
          read as three equal choices. The active one is the only filled thing. */}
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
      <p className="-mt-3 text-sm text-muted">{tab.blurb}</p>

      {result ? (
        <Alert tone="success">
          Saved {result.transactions.length} {txLabel(result.transactions[0]?.type ?? kind).toLowerCase()}{" "}
          {result.transactions.length === 1 ? "entry" : "entries"}. New balance for {item?.name}:{" "}
          <span className="font-mono">{result.balances[item!.id]}</span>
          {item?.unit ? ` ${item.unit}` : ""}.
          {result.allocations && result.allocations.length > 1 ? " Split across batches as planned." : ""}
        </Alert>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Panel title="1. Which item?" description="Search the catalogue, then pick the item." className="max-w-2xl">
          <div className="flex flex-col gap-3">
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
            title={kind === "ADJUST" ? "2. Which batch, and by how much?" : "2. How much, and when?"}
            description={
              kind === "ADJUST"
                ? "Correct a single batch to match a counted figure."
                : "The earliest expiry is used first. Adjust the split if that is not what you want."
            }
            className="max-w-2xl"
          >
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            {kind === "ADJUST" ? (
              <>
                <Field label="Batch" htmlFor="batch" hint="Only batches that still hold stock.">
                  <Select id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                    <option value="">Choose a batch…</option>
                    {usable.map((b) => (
                      <option key={b.id} value={b.id}>
                        #{b.id} · {b.expiry ?? "no expiry"} · {b.balance} on hand
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Change" htmlFor="adjust" hint="Signed. A positive number adds, a negative one removes.">
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
                    item.unit
                      ? `In ${item.unit}. Usable stock: ${usable.reduce((s, b) => s + b.balance, 0)}.`
                      : `Usable stock: ${usable.reduce((s, b) => s + b.balance, 0)}.`
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
              </>
            )}

            <Field label="Date" htmlFor="date" hint={`Nurses can record up to ${nurseBackdateDays} days back.`}>
              <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
            </Field>

            <Field label="Source" htmlFor="source" hint={kind === "DISPENSE" ? "Ward or patient reference." : "Where it went or why it went."}>
              <Input id="source" value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>

            <Field label="Remarks" htmlFor="remarks" hint="Optional. A reason here makes the audit log easier to read later.">
              <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
          </Panel>
        ) : null}

        {kind !== "ADJUST" && item && amount > 0 && usable.length > 0 ? (
          <Panel
            title="3. Which batches?"
            description={
              isSplit
                ? "This quantity spans more than one batch. Check the split before saving."
                : "One batch covers this quantity, so there is nothing to choose."
            }
            className="max-w-3xl"
            actions={
              isSplit && edited ? (
                <Button
                  type="button"
                  variant="plain"
                  size="sm"
                  onClick={() => {
                    setEdited(false);
                    setLines(undefined);
                  }}
                >
                  Back to earliest expiry first
                </Button>
              ) : undefined
            }
          >
            {lines ? (
              <>
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
                    {lines.map((line) => (
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
                            step={1}
                            value={line.qty}
                            aria-label={`Quantity from batch ${line.batchId}`}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setEdited(true);
                              // A line taken down to zero is dropped: the server only accepts
                              // positive batch quantities, and the row can be retyped if needed.
                              setLines(
                                (lines ?? [])
                                  .map((l) => (l.batchId === line.batchId ? { ...l, qty: next } : l))
                                  .filter((l) => Number.isInteger(l.qty) && l.qty > 0),
                              );
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
                          edited && lineTotal !== amount ? "text-danger" : "",
                        )}
                      >
                        {lineTotal} / {amount}
                      </td>
                    </tr>
                  </tfoot>
                </TableWrap>
                {edited && lineTotal !== amount ? (
                  <Alert tone="error" className="mt-3">
                    The batch quantities must add up to {amount} before this can be saved.
                  </Alert>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted">Working out the batches…</p>
            )}
          </Panel>
        ) : null}

        {expiredBatches.length > 0 && kind !== "ADJUST" ? (
          <Alert tone="warn">
            {expiredBatches.reduce((s, b) => s + b.balance, 0)} units on this item are already expired and are never
            handed out automatically. Record a Dispose entry to clear them.
          </Alert>
        ) : null}

        {monthClosed ? (
          <Alert tone="error">
            {monthOf(date)} is closed. An admin must reopen it before anything can be recorded.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex max-w-2xl flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={busy || !item || monthClosed || (kind !== "ADJUST" && edited && lineTotal !== amount)}
          >
            {busy ? "Saving…" : `Record ${txLabel(kind).toLowerCase()}`}
          </Button>
          <Button type="button" variant="plain" size="lg" onClick={reset} disabled={busy}>
            Clear
          </Button>
          {!item ? <span className="text-sm text-muted">Pick an item above to enable saving.</span> : null}
        </div>
      </form>

      <Panel title="The rules behind this" className="max-w-2xl">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>Dispense takes the batch with the earliest expiry first, and splits across batches only when it must.</li>
          <li>Expired and empty batches are never offered.</li>
          <li>One entry can span several batches; each split becomes its own row so the history stays readable.</li>
          <li>No change may push a batch below zero, so two people cannot take the last unit at the same time.</li>
        </ul>
      </Panel>
    </div>
  );
}
