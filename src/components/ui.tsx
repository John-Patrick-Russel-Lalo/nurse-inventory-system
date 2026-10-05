"use client";

// Small presentational pieces shared by the screens. Everything here is presentational or a
// plain controlled input, so the same file works on the server and the client.

import type { ExpiryStatus, TxType } from "@/lib/api-types";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- buttons ----------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "plain" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        "rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "plain" && "border border-rule bg-surface text-fg hover:bg-bg",
        variant === "danger" && "border border-danger/40 bg-danger-soft text-danger hover:opacity-80",
        className,
      )}
    />
  );
}

// ---------- form fields ----------

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm font-medium", className)} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-rule bg-bg px-2.5 py-2 text-sm font-normal outline-none focus:border-accent";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(inputClass, className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select {...rest} className={cn(inputClass, "pr-8", className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea {...rest} className={cn(inputClass, "min-h-16", className)} />;
}

export function Checkbox({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" {...rest} className="size-4 rounded border-rule accent-[var(--accent)]" />
      {label}
    </label>
  );
}

// ---------- layout ----------

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-md border border-rule bg-surface", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, tone = "plain" }: { label: string; value: React.ReactNode; tone?: "plain" | "warn" | "danger" | "ok" }) {
  const toneClass = { plain: "", warn: "text-warn", danger: "text-danger", ok: "text-ok" }[tone];
  return (
    <Card className="p-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cn("mt-1 font-mono text-2xl", toneClass)}>{value}</dd>
    </Card>
  );
}

// ---------- feedback ----------

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success" | "warn";
  children: React.ReactNode;
}) {
  const map = {
    info: "bg-accent-soft text-accent",
    error: "bg-danger-soft text-danger",
    success: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
  } as const;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md px-3 py-2 text-sm", map[tone])}>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-muted">{label}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return <Alert tone="error">{message}</Alert>;
}

// ---------- domain badges ----------

const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  NO_EXPIRY: "No expiry",
  EXPIRED: "Expired",
  DAYS_30: "≤30 days",
  DAYS_60: "31–60 days",
  DAYS_90: "61–90 days",
  OK: "OK",
};

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const tone = {
    EXPIRED: "bg-danger-soft text-danger",
    DAYS_30: "bg-danger-soft text-danger",
    DAYS_60: "bg-warn-soft text-warn",
    DAYS_90: "bg-warn-soft text-warn",
    OK: "bg-ok-soft text-ok",
    NO_EXPIRY: "bg-bg text-muted",
  }[status];
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", tone)}>{EXPIRY_LABEL[status]}</span>;
}

export function LowBadge() {
  return <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">Low</span>;
}

const TX_LABEL: Record<TxType, string> = {
  OPENING: "Opening",
  RECEIVE: "Received",
  DISPENSE: "Dispensed",
  ADJUST: "Adjusted",
  DISPOSE: "Disposed",
};

export const txLabel = (type: TxType): string => TX_LABEL[type];

/** A signed quantity, coloured by direction. */
export function Qty({ value }: { value: number }) {
  return (
    <span className={cn("font-mono", value > 0 ? "text-ok" : value < 0 ? "text-danger" : "text-muted")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}
