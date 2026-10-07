"use client";

// Small presentational pieces shared by the screens. Everything here is presentational or a
// plain controlled input, so the same file works on the server and the client.
//
// The visual rules live in this file so every screen matches: three depths of shadow, one radius
// scale, and controls that lift a little on hover and press in when used.

import type { ExpiryStatus, TxType } from "@/lib/api-types";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- icons ----------
// Hand-drawn on a 24-unit grid so they line up with the type. Stroke-based, so they inherit
// currentColor and never need a second palette.

type IconProps = { className?: string };

const iconBox = "size-5 shrink-0";

export function IconDashboard({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="2" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" />
    </svg>
  );
}

export function IconReceive({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <path d="M12 3.5v9" />
      <path d="M8.5 9.5 12 13l3.5-3.5" />
      <path d="M4 15.5v2.5a2.5 2.5 0 0 0 2.5 2.5h11a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </svg>
  );
}

export function IconDispense({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <path d="M12 4.5v9" />
      <path d="M15.5 10.5 12 14l-3.5-3.5" />
      <path d="M4 15.5v2.5a2.5 2.5 0 0 0 2.5 2.5h11a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </svg>
  );
}

export function IconStock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M3 11.5h18" />
      <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
    </svg>
  );
}

export function IconExpiry({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M12 13.5v3.2l2 1.3" />
    </svg>
  );
}

export function IconMonthEnd({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

export function IconItems({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <path d="M5 8.5h14l-1.2 10.2a2.5 2.5 0 0 1-2.5 2.3H8.7a2.5 2.5 0 0 1-2.5-2.3Z" />
      <path d="M9 8.5V6.8A3 3 0 0 1 12 4a3 3 0 0 1 3 2.8v1.7" />
    </svg>
  );
}

export function IconImport({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <path d="M12 3.5v10" />
      <path d="M8.5 10 12 13.5 15.5 10" />
      <path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" />
      <path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4H9" />
    </svg>
  );
}

export function IconAudit({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={cn(iconBox, className)} aria-hidden>
      <path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8.5H19" />
      <path d="M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path d="M12 3.5v10.5" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M4.5 16.5v1.8a2.2 2.2 0 0 0 2.2 2.2h10.6a2.2 2.2 0 0 0 2.2-2.2v-1.8" />
    </svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)} aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0 transition-transform", className)} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function IconAlert({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path d="M12 4.5 21 19.5H3Z" />
      <path d="M12 10v4" />
      <path d="M12 16.8h.01" />
    </svg>
  );
}

/** A small neutral mark for an empty list, so an empty screen is never a blank rectangle. */
export function IconEmpty({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={cn("size-9", className)} aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17" />
      <path d="M8 14.5h8M8 17h5" />
    </svg>
  );
}

// ---------- buttons ----------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "plain" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        // The lift is the whole character: a hair of movement and a softer shadow while hovered,
        // and it settles back down when pressed.
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap",
        "transition-[transform,box-shadow,background-color,border-color,opacity] duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-3.5 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-base",
        variant === "primary" &&
          "border border-transparent bg-accent text-accent-fg shadow-raised hover:-translate-y-px hover:shadow-float active:translate-y-0 active:shadow-card",
        variant === "plain" &&
          "border border-rule bg-surface text-fg shadow-card hover:-translate-y-px hover:border-accent/40 hover:shadow-raised active:translate-y-0 active:shadow-none",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" &&
          "border border-danger/30 bg-danger-soft text-danger shadow-card hover:-translate-y-px hover:shadow-raised active:translate-y-0 active:shadow-none",
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
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-rule bg-surface px-3 py-2 text-sm font-normal text-fg " +
  "shadow-[inset_0_1px_2px_rgb(20_35_43_/_0.04)] transition-[border-color,box-shadow] " +
  "placeholder:text-muted/70 focus:border-accent focus:outline-none focus:[box-shadow:var(--ring)]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(inputClass, className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  // A chevron on the right, drawn over the native one so the control matches the rest.
  return (
    // A span, not a div: Field renders a <label>, and a label may only hold phrasing content.
    <span className="relative block">
      <select
        {...rest}
        className={cn(inputClass, "cursor-pointer appearance-none pr-9", className)}
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea {...rest} className={cn(inputClass, "min-h-20 resize-y", className)} />;
}

export function Checkbox({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
      <input
        type="checkbox"
        {...rest}
        className="size-4 cursor-pointer rounded-md border-rule accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/** A search box with the magnifier inside the field, so the control reads as one thing. */
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <span className="relative block">
      <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input type="search" {...rest} className={cn(inputClass, "pl-9", className)} />
    </span>
  );
}

// ---------- layout ----------

export function Card({ className, children, ...rest }: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("rounded-2xl border border-rule bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

/** A card with a heading and an optional action on the right, for a titled block of content. */
export function Panel({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {description ? <p className="-mt-1 text-sm text-muted">{description}</p> : null}
      {children}
    </section>
  );
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
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  tone = "plain",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "plain" | "warn" | "danger" | "ok";
  hint?: React.ReactNode;
}) {
  const toneClass = { plain: "", warn: "text-warn", danger: "text-danger", ok: "text-ok" }[tone];
  // A tone also tints the card, so a number that needs attention is visible before it is read.
  const toneSurface = {
    plain: "",
    warn: "border-warn/25 bg-warn-soft/40",
    danger: "border-danger/25 bg-danger-soft/40",
    ok: "border-ok/25 bg-ok-soft/40",
  }[tone];
  return (
    <Card className={cn("p-4", toneSurface)}>
      <dt className="text-xs font-medium tracking-wider text-muted uppercase">{label}</dt>
      <dd className={cn("mt-1.5 font-mono text-2xl font-medium", toneClass)}>{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

// ---------- tables ----------
// One place for the frame, so every list on every screen has the same edges and the same header.

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-rule bg-surface shadow-card", className)}>
      <table className="sticky-head w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export const thClass =
  "bg-surface-2 px-3 py-2.5 text-left text-xs font-semibold tracking-wider text-muted uppercase";

export const thRightClass = `${thClass} text-right`;

/** A row that lifts slightly on hover, so a long list shows where the pointer is. */
export const rowClass = "border-t border-rule transition-colors hover:bg-surface-2";

/**
 * The link inside a table cell. Padded so the tap target is a comfortable size rather than the
 * height of the text, and tinted on hover so a long list still reads as clickable rows.
 */
export const linkClass =
  "-mx-1.5 inline-block rounded-lg px-1.5 py-1.5 font-medium underline-offset-2 transition-colors " +
  "hover:bg-accent-soft hover:underline focus-visible:bg-accent-soft";

/** A secondary link that sits in a panel header or under a table. Sized so it can be tapped. */
export const panelLink =
  "inline-flex h-8 items-center rounded-lg px-2 text-sm text-muted transition-colors hover:bg-surface hover:text-fg";

// ---------- feedback ----------

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "error" | "success" | "warn";
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    info: { box: "border-accent/20 bg-accent-soft text-accent", Icon: IconCheck },
    error: { box: "border-danger/25 bg-danger-soft text-danger", Icon: IconAlert },
    success: { box: "border-ok/25 bg-ok-soft text-ok", Icon: IconCheck },
    warn: { box: "border-warn/25 bg-warn-soft text-warn", Icon: IconAlert },
  } as const;
  const { box, Icon } = map[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-card", box, className)}
    >
      <Icon className="mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="py-12 text-center text-sm text-muted">{label}</p>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-rule bg-surface-2/50 px-4 py-12 text-center">
      <IconEmpty className="text-muted/50" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mx-auto max-w-sm text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
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

const badgeBase = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const tone = {
    EXPIRED: "bg-danger-soft text-danger",
    DAYS_30: "bg-danger-soft text-danger",
    DAYS_60: "bg-warn-soft text-warn",
    DAYS_90: "bg-warn-soft text-warn",
    OK: "bg-ok-soft text-ok",
    NO_EXPIRY: "bg-surface-2 text-muted",
  }[status];
  return <span className={cn(badgeBase, tone)}>{EXPIRY_LABEL[status]}</span>;
}

export function LowBadge() {
  return <span className={cn(badgeBase, "bg-warn-soft text-warn")}>Low</span>;
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
    <span className={cn("font-mono font-medium", value > 0 ? "text-ok" : value < 0 ? "text-danger" : "text-muted")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}