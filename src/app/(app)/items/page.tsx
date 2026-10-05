"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { CATEGORIES, type Category, type ItemCreateBody } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  LowBadge,
  PageHeader,
  Select,
  Stat,
  cn,
} from "@/components/ui";

export default function ItemsPage() {
  const { isAdmin } = usePermissions();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data, error, loading, reload, refreshing } = useApi(
    () => api.items({ q, category, includeInactive }),
    [q, category, includeInactive],
  );

  const rows = data?.items ?? [];
  const missingUnit = rows.filter((i) => !i.unit).length;
  const missingLevel = rows.filter((i) => i.reorderLevel === null).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Items"
        description={
          isAdmin
            ? "The catalogue. Units and reorder levels decide what counts as low stock."
            : "The catalogue. Ask an admin to change anything here."
        }
        actions={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>Add item</Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand or ID…" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Category
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
            <option value="ALL">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        {isAdmin ? (
          <div className="pb-2">
            <Checkbox
              label="Show inactive"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
          </div>
        ) : null}
      </div>

      {data ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Items shown" value={rows.length} />
          <Stat label="No unit set" value={missingUnit} tone={missingUnit ? "warn" : "plain"} />
          <Stat label="No reorder level" value={missingLevel} tone={missingLevel ? "warn" : "plain"} />
          <Stat label="Low stock" value={rows.filter((i) => i.lowStock).length} />
        </dl>
      ) : null}

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}
      {refreshing ? <p className="text-xs text-muted">Refreshing…</p> : null}

      {data && rows.length === 0 ? <EmptyState title="No items match." /> : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">ID</th>
                <th scope="col" className="px-3 py-2 font-medium">Item</th>
                <th scope="col" className="px-3 py-2 font-medium">Category</th>
                <th scope="col" className="px-3 py-2 font-medium">Unit</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Reorder at</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">On hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className={cn("border-t border-rule", !item.active && "opacity-55")}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/items/${item.id}`} className="underline underline-offset-2">
                      {item.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {item.name}
                    {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                    {!item.active ? <span className="ml-2 text-xs text-muted">(inactive)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{item.category}</td>
                  <td className={cn("px-3 py-2 text-xs", !item.unit && "text-warn")}>{item.unit ?? "—"}</td>
                  <td className={cn("px-3 py-2 text-right font-mono text-xs", item.reorderLevel === null && "text-warn")}>
                    {item.reorderLevel ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {item.balance}
                    {item.lowStock ? <LowBadge /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {creating ? <NewItemDialog onClose={() => setCreating(false)} onSaved={reload} /> : null}
    </div>
  );
}

function NewItemDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ItemCreateBody>({ name: "", category: "MEDICINE" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ItemCreateBody>(key: K, value: ItemCreateBody[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.createItem(form);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the item.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-md border border-rule bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Add an item</h2>
        <p className="mt-1 text-sm text-muted">
          Leave the ID empty to continue after the highest one in the same block.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Field label="Name" htmlFor="new-name">
            <Input
              id="new-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Variant or brand" htmlFor="new-variant" hint="Optional, e.g. a size or a brand.">
            <Input id="new-variant" value={form.variant ?? ""} onChange={(e) => set("variant", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="new-category">
              <Select
                id="new-category"
                value={form.category}
                onChange={(e) => set("category", e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit" htmlFor="new-unit" hint="e.g. box, bottle.">
              <Input id="new-unit" value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID" htmlFor="new-id" hint="e.g. MED-152.">
              <Input id="new-id" value={form.id ?? ""} onChange={(e) => set("id", e.target.value)} />
            </Field>
            <Field label="Reorder level" htmlFor="new-level" hint="Blank or 0 to turn it off.">
              <Input
                id="new-level"
                type="number"
                min={0}
                step={1}
                value={form.reorderLevel ?? ""}
                onChange={(e) => set("reorderLevel", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="plain" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Add item"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
