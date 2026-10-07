"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/session";
import { SignOutButton } from "./SignOutButton";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconAudit,
  IconDashboard,
  IconDispense,
  IconExpiry,
  IconImport,
  IconItems,
  IconMonthEnd,
  IconReceive,
  IconStock,
  cn,
} from "./ui";

interface NavItem {
  label: string;
  href: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  /** A one-line reminder of what the screen is for, shown on the wide sidebar. */
  blurb: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped so it is obvious which screens are the day's work and which are looking things up.
// A flat list of nine links in no order is the thing people get lost in.
const NAV: NavGroup[] = [
  {
    label: "Day to day",
    items: [
      { label: "Dashboard", href: "/", Icon: IconDashboard, blurb: "What needs attention" },
      { label: "Receive", href: "/receive", Icon: IconReceive, blurb: "Add stock coming in" },
      { label: "Dispense", href: "/dispense", Icon: IconDispense, blurb: "Hand stock out" },
    ],
  },
  {
    label: "Look things up",
    items: [
      { label: "Stock", href: "/stock", Icon: IconStock, blurb: "Balances and batches" },
      { label: "Expiry", href: "/expiry", Icon: IconExpiry, blurb: "What runs out soonest" },
      { label: "Month end", href: "/month-end", Icon: IconMonthEnd, blurb: "Count and close" },
      { label: "Items", href: "/items", Icon: IconItems, blurb: "The catalogue" },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Workbook import", href: "/admin/import", Icon: IconImport, blurb: "The old spreadsheet", adminOnly: true },
      { label: "Audit log", href: "/admin/audit", Icon: IconAudit, blurb: "Who changed what", adminOnly: true },
    ],
  },
];

/** True for "/" and for "/items/MED-001" under "/items". */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => !n.adminOnly || user.role === "ADMIN") })).filter(
    (g) => g.items.length > 0,
  );
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="mx-auto grid min-h-dvh max-w-7xl grid-cols-1 gap-x-8 px-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 py-6 md:sticky md:top-0 md:h-dvh md:py-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-xl">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-raised">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
              <path d="M12 4.5v15M4.5 12h15" />
            </svg>
          </span>
          <span>
            <span className="block text-sm leading-tight font-semibold">Nurse office</span>
            <span className="block text-xs leading-tight text-muted">Inventory</span>
          </span>
        </Link>

        {/* The wide sidebar carries the groups. Below md the same links become one scrolling row. */}
        <nav aria-label="Main" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:hidden">
          {groups.flatMap((g) => g.items).map((n) => (
            <NavLink key={n.href} item={n} active={isActive(pathname, n.href)} compact />
          ))}
        </nav>

        <nav aria-label="Sections" className="hidden flex-col gap-5 md:flex">
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-2.5 text-xs font-semibold tracking-wider text-muted uppercase">{group.label}</p>
              {group.items.map((n) => (
                <NavLink key={n.href} item={n} active={isActive(pathname, n.href)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-2xl border border-rule bg-surface p-3 shadow-card">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
          >
            {initials || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">
              {user.role === "ADMIN" ? "Admin — can also edit and void" : "Nurse — can record entries"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 py-6 md:py-8">{children}</main>
    </div>
  );
}

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact?: boolean }) {
  const { label, href, Icon, blurb } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={compact ? `${label} — ${blurb}` : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl text-sm transition-[background-color,color,transform,box-shadow] duration-150",
        compact ? "px-2.5 py-2 whitespace-nowrap" : "px-2.5 py-2 shadow-card",
        // The active link is the one filled thing on the page, so the eye lands on it first.
        active
          ? "bg-accent-soft font-semibold text-accent"
          : "text-muted hover:bg-surface hover:text-fg hover:shadow-card",
      )}
    >
      <Icon className={cn(active ? "text-accent" : "text-muted group-hover:text-fg")} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate leading-tight">{label}</span>
        {compact ? null : <span className="truncate text-xs leading-tight text-muted/80">{blurb}</span>}
      </span>
    </Link>
  );
}