"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/session";
import { SignOutButton } from "./SignOutButton";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "./ui";

interface NavItem {
  label: string;
  href: string;
  /** Hidden from nurses. */
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Receive", href: "/receive" },
  { label: "Dispense", href: "/dispense" },
  { label: "Stock", href: "/stock" },
  { label: "Expiry", href: "/expiry" },
  { label: "Month end", href: "/month-end" },
  { label: "Items", href: "/items" },
  { label: "Audit log", href: "/admin/audit", adminOnly: true },
];

/** True for "/" and for "/items/MED-001" under "/items". */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.adminOnly || user.role === "ADMIN");

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl grid-cols-1 gap-x-8 px-4 md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 py-6 md:sticky md:top-0 md:h-dvh md:py-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Nurse office</p>
          <p className="text-lg font-semibold leading-tight">Inventory</p>
        </div>

        <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 md:flex-col md:gap-y-0.5">
          {items.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded px-1.5 py-1.5 -mx-1.5 text-sm",
                  active ? "bg-accent-soft font-medium text-accent" : "font-medium hover:text-accent",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-rule pt-4">
          <div>
            <p className="font-medium">{user.name}</p>
            <p className="text-xs uppercase tracking-wider text-muted">{user.role}</p>
          </div>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 py-6 md:py-8">{children}</main>
    </div>
  );
}
