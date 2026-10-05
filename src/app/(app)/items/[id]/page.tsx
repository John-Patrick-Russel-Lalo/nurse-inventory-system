"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { CATEGORIES, type Category, type ItemPatchBody } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import { TxTable } from "@/components/TxTable";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
  cn,
} from "@/components/ui";

export default function ItemDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload } = useApi(() => api.item(id), [id]);
  const [editing, setEditing] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const { item, batches, transactions } = data;
  const stocked = batches.filter((b) => b.balance !== 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/items" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
          ← All items
        </Link>
        <PageHeader
          title={item.variant ? `${item.name} · ${item.variant}` : item.name}
          description={
            <span className="font-mono">
              {item.id} · {item.category}
              {!item.active ? " · inactive" : ""}
            </span>
          }
          actions={
            isAdmin ? (
              <Button variant="plain" onClick={() => setEditing((v) => !v)}>
                {editing ? "Stop editing" : "Edit item"}
              </Button>
            ) : undefined
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="On hand" value={data.balance} tone={data.lowStock ? "warn" : "plain"} />
        <Stat label="Batches with stock" value={stocked.length} />
        <Stat label="Unit" value={item.unit ?? "—"} />
        <Stat label="Reorder at" value={item.reorderLevel ?? "—"} tone={item.reorderLevel === null ? "warn" : "plain"} />
      </dl>

      {data.lowStock ? (
        <Alert tone="warn">
          At or below the reorder level of {item.reorderLevel}.{" "}
          <Link href="/receive" className="underline underline-offset-2">
            Receive more
          </Link>
          .
        </Alert>
      ) : null}

      {editing && isAdmin ? <EditItemPanel itemId={item.id} current={item} onSaved={reload} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Batches</h2>
        {batches.length === 0 ? (
          <EmptyState
            title="No batches yet."
            hint="A batch appears once stock is received. Items with no known expiry get one shared “unknown expiry” batch."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-rule">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Batch</th>
                  <th scope="col" className="px-3 py-2 font-medium">Expiry</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Received on</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">In</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-rule">
                    <td className="px-3 py-2 font-mono text-xs">
                      #{b.id}
                      {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                      {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{b.expiry ?? "unknown"}</td>
                    <td className="px-3 py-2"><ExpiryBadge status={b.expiryStatus} /></td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{b.receivedOn ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{b.qtyReceived}</td>
                    <td className={cn("px-3 py-2 text-right font-mono", b.balance === 0 && "text-muted")}>
                      {b.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Entries</h2>
        <TxTable
          transactions={transactions}
          showItem={false}
          onChanged={reload}
          emptyTitle="No entries yet for this item."
          emptyHint="Use Receive to add the first batch."
        />
      </section>
    </div>
  );
}

function EditItemPanel({
  itemId,
  current,
  onSaved,
}: {
  itemId: string;
  current: {
    name: string;
    variant: string | null;
    category: Category;
    unit: string | null;
    reorderLevel: number | null;
    active: boolean;
  };
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    variant: string;
    category: Category;
    unit: string;
    reorderLevel: string;
    active: boolean;
  }>({
    name: current.name,
    variant: current.variant ?? "",
    category: current.category,
    unit: current.unit ?? "",
    reorderLevel: current.reorderLevel === null ? "" : String(current.reorderLevel),
    active: current.active,
  });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: ItemPatchBody = {
      name: form.name,
      variant: form.variant || null,
      category: form.category,
      unit: form.unit || null,
      // Blank or zero means "no reorder level", which turns off the low-stock flag.
      reorderLevel: form.reorderLevel === "" || Number(form.reorderLevel) === 0 ? null : Number(form.reorderLevel),
      active: form.active,
    };
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await api.patchItem(itemId, patch);
      setNotice("Saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="e-name">
            <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Variant or brand" htmlFor="e-variant">
            <Input
              id="e-variant"
              value={form.variant}
              onChange={(e) => setForm({ ...form, variant: e.target.value })}
            />
          </Field>
          <Field label="Category" htmlFor="e-category">
            <Select
              id="e-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" htmlFor="e-unit" hint="e.g. box, bottle, tablet.">
            <Input id="e-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
          <Field label="Reorder level" htmlFor="e-level" hint="Blank or 0 turns off the low-stock flag.">
            <Input
              id="e-level"
              type="number"
              min={0}
              step={1}
              value={form.reorderLevel}
              onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
            />
          </Field>
          <Field label="Active" htmlFor="e-active" hint="Inactive items are hidden from every screen.">
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                id="e-active"
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="size-4 rounded border-rule accent-[var(--accent)]"
              />
              {form.active ? "In the catalogue" : "Hidden"}
            </label>
          </Field>
        </div>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <span className="text-xs text-muted">Saved straight to the audit log.</span>
        </div>
      </form>
    </Card>
  );
}
