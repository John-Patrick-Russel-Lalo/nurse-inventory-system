"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ItemSummary } from "@/lib/api-types";
import { Button, IconCheck, Input, Loading, LowBadge, cn } from "./ui";

interface ItemPickerProps {
  value: ItemSummary | undefined;
  onChange: (item: ItemSummary | undefined) => void;
  /** Called with the freshly fetched balance once an item is chosen. */
  onPicked?: (item: ItemSummary) => void;
  label?: string;
  autoFocus?: boolean;
}

/**
 * Search-as-you-type item selector. The list is fetched once from /api/items and filtered in
 * the browser, which keeps typing responsive on a phone with no second round trip per
 * keystroke.
 */
export function ItemPicker({ value, onChange, onPicked, label = "Item", autoFocus }: ItemPickerProps) {
  const [items, setItems] = useState<ItemSummary[]>();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    let live = true;
    api
      .items()
      .then((r) => live && setItems(r.items))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, []);

  // Close the list when the click lands outside the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return (items ?? []).slice(0, 12);
    return (items ?? [])
      .filter((i) => `${i.id} ${i.name} ${i.variant ?? ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [items, query]);

  const choose = (item: ItemSummary) => {
    onChange(item);
    onPicked?.(item);
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  return (
    <div className="flex flex-col gap-1 text-sm font-medium" ref={root}>
      <label htmlFor={`${listId}-input`}>{label}</label>

      {/* Once chosen, the field collapses to a single line. The pages show the balance and
          batch detail themselves, so this only needs to confirm the pick and offer Change. */}
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-2.5 shadow-card">
          <span className="flex min-w-0 items-center gap-2">
            <IconCheck className="size-4 shrink-0 text-accent" />
            <span className="truncate font-medium">{value.name}</span>
            {value.variant ? <span className="truncate text-muted">· {value.variant}</span> : null}
            <span className="shrink-0 font-mono text-xs text-muted">{value.id}</span>
          </span>
          <Button
            type="button"
            variant="plain"
            size="sm"
            className="shrink-0"
            onClick={() => {
              onChange(undefined);
              setQuery("");
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            id={`${listId}-input`}
            value={query}
            autoFocus={autoFocus}
            placeholder="Search by name, brand or ID…"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setHighlight((h) => Math.min(h + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                if (open && matches[highlight]) {
                  e.preventDefault();
                  choose(matches[highlight]);
                }
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />

          {open ? (
            <ul
              id={listId}
              role="listbox"
              className="max-h-72 overflow-auto rounded-2xl border border-rule bg-surface p-1.5 shadow-float"
            >
              {!items ? <Loading label="Loading items…" /> : null}
              {items && matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted">Nothing matches “{query}”.</li>
              ) : null}
              {matches.map((item, i) => (
                <li key={item.id} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(item)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-normal transition-colors",
                      i === highlight ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {item.name}
                      {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted">
                      {item.lowStock ? <LowBadge /> : null}
                      {item.id} · {item.balance}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
