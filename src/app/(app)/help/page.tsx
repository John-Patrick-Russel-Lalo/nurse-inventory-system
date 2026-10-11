"use client";

import Link from "next/link";
import { usePermissions } from "@/components/SessionProvider";
import {
  IconReceive,
  IconStock,
  PageHeader,
  Panel,
  linkClass,
} from "@/components/ui";

/**
 * A plain-language guide for the people who run the office, not the people who built it.
 * Deliberately static and jargon-free: it never touches data, so it is always safe to open.
 */
export default function HelpPage() {
  const { isAdmin } = usePermissions();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="How to use this"
        description="A short guide in plain words. Nothing on this page changes any stock."
      />

      <Panel
        title="The two things you will do most"
        description="Almost all of your day is one of these."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HowCard
            href="/receive"
            Icon={IconReceive}
            title="Record"
            body="Receive, dispense, dispose or adjust stock. Pick the tab that matches what happened: Receive adds stock, Dispense hands it out, Dispose throws it away, and Adjust corrects a count."
          />
          <HowCard
            href="/stock"
            Icon={IconStock}
            title="Stock"
            body="Use this to check how much of anything is left. Type in the search box to find an item fast, or download the list to Excel."
          />
        </div>
      </Panel>

      <Panel title="Every screen, in one line" description="The menu on the left, explained.">
        <ul className="flex flex-col gap-2.5">
          <ScreenLink href="/" name="Dashboard" what="What needs attention today, and what moved recently." />
          <ScreenLink href="/receive" name="Record" what="Receive, dispense, dispose or adjust stock." />
          <ScreenLink href="/stock" name="Stock" what="How much of each item is left, and in which box." />
          <ScreenLink href="/expiry" name="Expiry" what="What is about to go out of date." />
          <ScreenLink href="/month-end" name="Month end" what="Count the shelf and close the month." />
          <ScreenLink href="/items" name="Items" what="The list of everything the office keeps." />
          {isAdmin ? (
            <>
              <ScreenLink href="/admin/import" name="Workbook import" what="What came in from the old spreadsheet." />
              <ScreenLink href="/admin/audit" name="Audit log" what="A record of every change and who made it." />
            </>
          ) : null}
        </ul>
      </Panel>

      <Panel title="Words we use" description="If a word on a screen is unfamiliar, it is probably here.">
        <dl className="flex flex-col gap-3">
          <Term term="Item">One thing the office keeps, such as a medicine or a supply. Each item has its own ID, like MED-001.</Term>
          <Term term="Batch">
            One box or delivery of an item with the same expiry date. When you receive stock, the expiry you type decides
            which batch it joins.
          </Term>
          <Term term="On hand">How much of an item is on the shelf right now.</Term>
          <Term term="Dispense">Give stock out. It leaves the shelf.</Term>
          <Term term="Dispose">Throw stock away, because it is expired, broken or recalled.</Term>
          <Term term="Adjust">
            Correct a batch so the system matches what you actually counted. A positive number adds, a negative number
            removes.
          </Term>
          <Term term="Reorder level">
            The number you set for an item. When on-hand stock drops to it, the item is flagged as low so you know to
            order more.
          </Term>
          <Term term="Void">Reverse an entry that was recorded by mistake. The system keeps a note of who reversed it.</Term>
          <Term term="Month end">
            Count everything, save the counts, and close the month so its numbers cannot change. Only an admin can close
            or reopen a month.
          </Term>
        </dl>
      </Panel>

      <Panel title="If something looks wrong">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>Recorded the wrong thing? Ask an admin to void the entry, then record it correctly. Nothing is ever deleted.</li>
          <li>A month is closed and you need to change something in it? Ask an admin to reopen it.</li>
          <li>Can&rsquo;t sign in? Ask an admin to reset your password.</li>
          <li>Not sure whether to Receive or Adjust? If stock arrived, Receive. If the system and the shelf disagree, Adjust.</li>
        </ul>
      </Panel>
    </div>
  );
}

function HowCard({
  href,
  title,
  body,
  Icon,
}: {
  href: string;
  title: string;
  body: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-2xl border border-rule bg-surface p-4 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-sm text-muted">{body}</span>
    </Link>
  );
}

function ScreenLink({ href, name, what }: { href: string; name: string; what: string }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <Link href={href} className={linkClass}>
        {name}
      </Link>
      <span className="text-sm text-muted">{what}</span>
    </li>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rule bg-surface-2/60 px-3.5 py-2.5">
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="mt-0.5 text-sm text-muted">{children}</dd>
    </div>
  );
}
