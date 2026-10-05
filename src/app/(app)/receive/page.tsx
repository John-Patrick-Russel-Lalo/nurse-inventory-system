"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ItemSummary, MovementBody, MovementResult } from "@/lib/api-types";
import { monthOf } from "@/lib/dates";
import { usePermissions } from "@/components/SessionProvider";
import { ItemPicker } from "@/components/ItemPicker";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  txLabel,
} from "@/components/ui";

/** REPlACE the whole form on success, so a second box of the same item is a two-tap job. */
const BLANK = { qty: "", expiry: "", lot: "", source: "", remarks: "" };

export default function ReceivePage() {
  const { isAdmin, today, nurseBackdateDays, closedMonths } = usePermissions();

  const [type, setType] = useState<"RECEIVE" | "OPENING">("RECEIVE");
  const [item, setItem] = useState<ItemSummary>();
  const [form, setForm] = useState(BLANK);
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<MovementResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const monthClosed = closedMonths.includes(monthOf(date));
  const set = (key: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setItem(undefined);
    setForm(BLANK);
    setDate(today);
    setResult(undefined);
    setError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) {
      setError("Choose an item first.");
      return;
    }
    const qty = Number(form.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Enter a whole quantity above zero.");
      return;
    }

    setBusy(true);
    setError(undefined);
    setResult(undefined);

    const body: MovementBody = {
      type,
      itemId: item.id,
      qty,
      date,
      expiry: form.expiry || null,
      lot: form.lot || null,
      source: form.source || null,
      remarks: form.remarks || null,
    };

    try {
      setResult(await api.record(body));
      setForm(BLANK);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the entry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Receive stock"
        description={
          type === "OPENING"
            ? "An opening balance sets the starting figure for a batch. Admin only."
            : "Stock arriving from a supplier or a transfer. The expiry decides which batch it joins."
        }
      />

      {result ? (
        <Alert tone="success">
          Saved {result.transactions.length} {txLabel(result.transactions[0]?.type ?? type).toLowerCase()}{" "}
          {result.transactions.length === 1 ? "entry" : "entries"} for{" "}
          <span className="font-medium">{item?.name}</span>. New balance:{" "}
          <span className="font-mono">{result.balances[item!.id]}</span>
          {item?.unit ? ` ${item.unit}` : ""}.
        </Alert>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-4">
        {isAdmin ? (
          <Field label="Entry type" htmlFor="type" className="max-w-xs">
            <Select id="type" value={type} onChange={(e) => setType(e.target.value as "RECEIVE" | "OPENING")}>
              <option value="RECEIVE">Received (adds to stock)</option>
              <option value="OPENING">Opening balance (starting figure)</option>
            </Select>
          </Field>
        ) : null}

        <div className="max-w-lg">
          <ItemPicker value={item} onChange={setItem} />
        </div>

        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Quantity"
            htmlFor="qty"
            hint={item?.unit ? `In ${item.unit}. Whole numbers only.` : "Whole numbers only."}
          >
            <Input
              id="qty"
              value={form.qty}
              onChange={set("qty")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
            />
          </Field>

          <Field
            label="Date"
            htmlFor="date"
            hint={
              isAdmin
                ? "Admins can backdate freely, but never into the future."
                : `Nurses can record up to ${nurseBackdateDays} days back.`
            }
          >
            <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
          </Field>

          <Field label="Expiry" htmlFor="expiry" hint='Month or full date, e.g. "8/2027". Leave empty if unknown.'>
            <Input id="expiry" value={form.expiry} onChange={set("expiry")} placeholder="8/2027" />
          </Field>

          <Field label="Lot number" htmlFor="lot" hint="Optional. Stored with the batch.">
            <Input id="lot" value={form.lot} onChange={set("lot")} />
          </Field>

          <Field label="Source" htmlFor="source" hint="Supplier, ward or person handing it over.">
            <Input id="source" value={form.source} onChange={set("source")} />
          </Field>

          <Field label="Remarks" htmlFor="remarks" className="sm:col-span-2">
            <Textarea id="remarks" value={form.remarks} onChange={set("remarks")} />
          </Field>
        </div>

        {monthClosed ? (
          <Alert tone="error">
            {monthOf(date)} is closed. An admin must reopen it before anything can be recorded.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !item || monthClosed}>
            {busy ? "Saving…" : `Record ${txLabel(type).toLowerCase()}`}
          </Button>
          <Button type="button" variant="plain" onClick={reset} disabled={busy}>
            Clear
          </Button>
        </div>
      </form>

      <Card className="p-4 text-sm text-muted">
        <p className="font-medium text-fg">How this works</p>
        <ul className="mt-2 list-disc pl-5">
          <li>
            The expiry decides the batch: stock with the same item and expiry joins the same batch, and an item only
            ever has one “unknown expiry” batch.
          </li>
          <li>
            Balances are recalculated from the entries, so nothing here can drift out of step.
          </li>
          <li>Every save is written to the audit log with your name.</li>
        </ul>
      </Card>
    </div>
  );
}
