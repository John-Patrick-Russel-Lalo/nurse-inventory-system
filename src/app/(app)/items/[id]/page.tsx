"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { CATEGORIES, type Category, type ItemPatchBody } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import { TxTable } from "@/components/TxTable";
import { BalanceLineChart, UsageTrendChart } from "@/components/Charts";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Field,
  Input,
  Checkbox,
  IconChevron,
  Loading,
  PageHeader,
  Panel,
  Select,
  Stat,
  TableWrap,
  cn,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

export default function ItemDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload } = useApi(() => api.item(id), [id]);
  const [editing, setEditing] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const { item, batches, transactions, monthly, balances } = data;
  const stocked = batches.filter((b) => b.balance !== 0);
  // Every month is labelled, but twenty-odd of them is too many to read on an axis, so the
  // chart thins them out rather than rotating the labels.
  const step = Math.max(1, Math.ceil(monthly.length / 12));
  const usage = monthly.filter((_, i) => i % step === 0 || i === monthly.length - 1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/items"
          className="-ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <IconChevron className="size-4 rotate-180" />
          All items
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
        <Stat label="On hand" value={data.balance} tone={data.lowStock ? "warn" : "plain"} hint={item.unit ?? "No unit set"} />
        <Stat label="Batches with stock" value={stocked.length} hint={`${batches.length} in total`} />
        <Stat label="Unit" value={item.unit ?? "—"} tone={item.unit ? "plain" : "warn"} hint="Used on every entry" />
        <Stat
          label="Reorder at"
          value={item.reorderLevel ?? "—"}
          tone={item.reorderLevel === null ? "warn" : "plain"}
          hint={item.reorderLevel === null ? "Not set" : "Low stock below this"}
        />
      </dl>

      {data.lowStock ? (
        <Alert tone="warn">
          <span className="font-medium">At or below the reorder level of {item.reorderLevel}.</span>{" "}
          <Link href="/receive" className="font-medium underline underline-offset-2">
            Receive more
          </Link>
        </Alert>
      ) : null}

      {editing && isAdmin ? <EditItemPanel itemId={item.id} current={item} onSaved={reload} /> : null}

      <Panel
        title="Batches"
        description="Each batch is one expiry date. This is what every balance is added up from."
      >
        {batches.length === 0 ? (
          <EmptyState
            title="No batches yet."
            hint="A batch appears once stock is received. Items with no known expiry get one shared “unknown expiry” batch."
            action={<Link href="/receive">Receive stock</Link>}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col" className={thClass}>Batch</th>
                <th scope="col" className={thClass}>Expiry</th>
                <th scope="col" className={thClass}>Status</th>
                <th scope="col" className={thClass}>Received on</th>
                <th scope="col" className={thRightClass}>In</th>
                <th scope="col" className={thRightClass}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className={rowClass}>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    #{b.id}
                    {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                    {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{b.expiry ?? "unknown"}</td>
                  <td className="px-3 py-2.5"><ExpiryBadge status={b.expiryStatus} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{b.receivedOn ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted">{b.qtyReceived}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono font-medium", b.balance === 0 && "text-muted")}>
                    {b.balance}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Usage and balance over time"
        description="Rebuilt from the entries, month by month. Some months are left out when there are many, so the bars are not always consecutive."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium">Received and dispensed</p>
            <UsageTrendChart data={usage} />
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium">
              On hand at each month end
              {item.reorderLevel ? (
                <span className="ml-1 font-normal text-muted">· dashed line is the reorder level</span>
              ) : null}
            </p>
            <BalanceLineChart data={balances} reorderLevel={item.reorderLevel} />
          </Card>
        </div>
      </Panel>

      <Panel title="Entries" description="Everything recorded against this item, newest first.">
        <TxTable
          transactions={transactions}
          showItem={false}
          onChanged={reload}
          emptyTitle="No entries yet for this item."
          emptyHint="Use Receive to add the first batch."
        />
      </Panel>
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
    <Panel
      title="Edit item"
      description="Name, unit and reorder level feed the low-stock flag, so changing them affects every screen."
    >
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
            <div className="flex h-[38px] items-center">
              <Checkbox
                id="e-active"
                label={form.active ? "In the catalogue" : "Hidden"}
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            </div>
          </Field>
        </div>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <span className="text-xs text-muted">Saved straight to the audit log.</span>
        </div>
      </form>
    </Panel>
  );
}
