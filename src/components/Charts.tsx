"use client";

// The three charts the screens need, built on Recharts. Kept deliberately thin: the app already
// styles with Tailwind tokens, so the charts read the same CSS variables the tables do and follow
// the light and dark themes without a second palette.
//
// Recharts needs the browser, so this file is a client component and takes plain numbers in.
// Nothing here fetches: the screens already hold the data.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;

/** "2026-09" as the short label an axis has room for. */
function shortMonth(month: string): string {
  return month.slice(5) === "01" ? month.slice(2, 4) : month.slice(5);
}

/** A month name, so a tooltip can say "September 2026" rather than "2026-09". */
const MONTH_WORDS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  const [year, index] = month.split("-");
  return `${MONTH_WORDS[Number(index) - 1] ?? month} ${year}`;
}

/** Shared tooltip shell: the tooltip surface should look like a card, not a floating box. */
function TooltipBox({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: React.ReactNode;
  rows?: { name: React.ReactNode; value: React.ReactNode; tone?: string }[];
}) {
  if (!active || !rows?.length) return null;
  return (
    <div className="rounded-xl border border-rule bg-surface px-2.5 py-1.5 text-xs shadow-raised">
      {label ? <p className="mb-1 font-medium">{label}</p> : null}
      {rows.map((r) => (
        <p key={String(r.name)} className="flex items-center gap-2">
          {r.tone ? <span className="size-2 rounded-sm" style={{ background: r.tone }} /> : null}
          <span className="text-muted">{r.name}</span>
          <span className="ml-auto pl-3 font-mono">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const CHART_HEIGHT = 200;

function Frame({ children, empty }: { children: React.ReactElement; empty: boolean }) {
  if (empty) {
    return <div className="py-10 text-center text-sm text-muted">No movements in this period.</div>;
  }
  return (
    <div style={{ height: CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// ---------- received against dispensed, by month ----------

export interface UsagePoint {
  month: string;
  received: number;
  dispensed: number;
}

/** What came in against what went out, month by month. Used whole-office and per item. */
export function UsageTrendChart({ data }: { data: UsagePoint[] }) {
  return (
    <Frame empty={data.length === 0}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--rule)" vertical={false} />
        <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "var(--bg)" }}
          content={({ active, label, payload }) => (
            <TooltipBox
              active={active}
              label={monthLabel(String(label ?? ""))}
              rows={(payload ?? []).map((p) => ({
                name: String(p.name),
                value: String(p.value),
                tone: p.color as string,
              }))}
            />
          )}
        />
        <Bar dataKey="received" name="Received" fill="var(--ok)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="dispensed" name="Dispensed" fill="var(--danger)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

// ---------- what an item held, month by month ----------

export function BalanceLineChart({
  data,
  reorderLevel,
}: {
  data: { month: string; balance: number }[];
  /** Drawn as a flat line, so "is this item actually low?" is answerable at a glance. */
  reorderLevel?: number | null;
}) {
  const points = data.map((d) => ({ ...d, reorder: reorderLevel ?? null }));
  // A line needs two points to draw anything, and most items here have one or two months of
  // history, so show the dots whenever the series is short enough for them not to crowd.
  const showDots = points.length <= 12;
  return (
    <Frame empty={points.length === 0}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--rule)" vertical={false} />
        <XAxis dataKey="month" tickFormatter={shortMonth} tick={AXIS} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, "auto"]} />
        <Tooltip
          content={({ active, label, payload }) => (
            <TooltipBox
              active={active}
              label={monthLabel(String(label ?? ""))}
              rows={(payload ?? [])
                .filter((p) => p.value !== null)
                .map((p) => ({
                  name: String(p.name),
                  value: String(p.value),
                  tone: p.color as string,
                }))}
            />
          )}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name="On hand"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={showDots ? { r: 2.5 } : false}
          activeDot={{ r: 3 }}
        />
        {reorderLevel ? (
          <Line
            type="linear"
            dataKey="reorder"
            name="Reorder at"
            stroke="var(--warn)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
          />
        ) : null}
      </LineChart>
    </Frame>
  );
}

// ---------- what the office used most, this month ----------

export interface TopUsedPoint {
  itemName: string;
  dispensed: number;
}

/**
 * A horizontal bar chart, because an item name is longer than a month and a rotated axis label
 * is worse than a bar chart on its side.
 */
export function TopUsedChart({ data }: { data: TopUsedPoint[] }) {
  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-muted">Nothing has been dispensed yet this month.</div>;
  }
  return (
    <div style={{ height: data.length * 28 + 30 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--rule)" horizontal={false} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="itemName"
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            width={140}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: "var(--bg)" }}
            content={({ active, payload }) => (
              <TooltipBox
                active={active}
                rows={(payload ?? []).map((p) => ({
                  name: "Dispensed",
                  value: String(p.value),
                  tone: p.color as string,
                }))}
              />
            )}
          />
          <Bar dataKey="dispensed" radius={[0, 2, 2, 0]}>
            {data.map((d) => (
              <Cell key={d.itemName} fill="var(--accent)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}