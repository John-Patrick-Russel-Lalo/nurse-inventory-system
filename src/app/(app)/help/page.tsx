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
 * A plain-language guide for the person who runs the office, not for whoever built the app.
 * Deliberately static and jargon-free: it never touches data, so it is always safe to open.
 */
export default function HelpPage() {
  const { isAdmin } = usePermissions();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="How to use this"
        description="A short guide in plain words. Nothing on this page changes any stock, so you can read it safely any time."
      />

      <Panel title="The two things you will do most" description="Almost all of your day is one of these.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HowCard
            href="/receive"
            Icon={IconReceive}
            title="Record stock"
            body="This is where you write down what happened: something arrived, you gave something out, you threw something away, or the count needs correcting. Pick the tab that matches what actually happened."
          />
          <HowCard
            href="/stock"
            Icon={IconStock}
            title="Check stock"
            body="Use this to see how much of anything is left. Type in the search box to find an item fast, or download the list to Excel."
          />
        </div>
      </Panel>

      <Panel title="What do you want to do?" description="Find your situation, then tap the screen on the right.">
        <ul className="flex flex-col gap-2">
          <TaskRow to="Record stock → Received" href="/receive" when="Medicine or supplies arrived" />
          <TaskRow to="Record stock → Given out" href="/receive?tab=dispense" when="You handed something to a patient or a ward" />
          <TaskRow to="Record stock → Thrown away" href="/receive?tab=dispose" when="Something expired, broke, or was recalled" />
          <TaskRow to="Record stock → Correction" href="/receive?tab=adjust" when="The shelf count does not match the system" />
          <TaskRow to="Check stock" href="/stock" when="You want to know how much is left" />
          <TaskRow to="Expiry dates" href="/expiry" when="You want to know what will go out of date soon" />
          <TaskRow to="Month closing" href="/month-end" when="It is the end of the month" />
          <TaskRow to="Item list" href="/items" when="You want to look at one item and its full past" />
        </ul>
      </Panel>

      <Panel title="Every screen, in one line" description="The menu on the left, explained.">
        <ul className="flex flex-col gap-2.5">
          <ScreenLink href="/" name="Home" what="What needs attention today, and what moved recently." />
          <ScreenLink href="/receive" name="Record stock" what="Something arrived, went out, was thrown away, or needs correcting." />
          <ScreenLink href="/stock" name="Stock on hand" what="How much of each item is left, and which batch it sits in." />
          <ScreenLink href="/expiry" name="Expiry dates" what="What is about to go out of date." />
          <ScreenLink href="/month-end" name="Month closing" what="Count the shelf and close the month." />
          <ScreenLink href="/items" name="Item list" what="Everything the office keeps." />
          {isAdmin ? (
            <>
              <ScreenLink href="/admin/import" name="Old spreadsheet" what="What came in from the old Excel file." />
              <ScreenLink href="/admin/audit" name="Activity history" what="A record of every change and who made it." />
            </>
          ) : null}
        </ul>
      </Panel>

      <Panel title="Words we use" description="If a word on a screen is unfamiliar, it is probably here.">
        <dl className="flex flex-col gap-3">
          <Term term="Item">One thing the office keeps, such as a medicine or a supply. Each item has its own ID, like MED-001.</Term>
          <Term term="Batch">
            One delivery, or one box, of an item that all shares the same expiry date. When you record something as Received, the
            expiry you type decides which batch it joins.
          </Term>
          <Term term="On hand">How much of an item is on the shelf right now.</Term>
          <Term term="Received">Stock that came in. It adds to what is on the shelf.</Term>
          <Term term="Given out">Stock you handed out to a patient or a ward. It leaves the shelf.</Term>
          <Term term="Thrown away">Stock you removed from the shelf because it expired, broke or was recalled.</Term>
          <Term term="Correction">
            Changing one batch so the system matches what you actually counted. A positive number adds, a negative number removes.
          </Term>
          <Term term="Refill level">
            The number you set for an item. When the stock on the shelf reaches it, the item is flagged as Low so you know to order
            more.
          </Term>
          <Term term="Cancel">
            Undo an entry that was recorded by mistake. The entry stays in the history with a note that it was cancelled; nothing is
            ever deleted.
          </Term>
          <Term term="Month closing">
            Count everything, save the counts, then close the month so its numbers cannot change. You can reopen it later if a
            mistake turns up.
          </Term>
        </dl>
      </Panel>

      <Panel title="If something looks wrong">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>
            Recorded the wrong thing? Open <Link href="/admin/audit" className={linkClass}>Activity history</Link>, find the entry and
            cancel it (you will be asked to write why). Then record it correctly. Nothing is ever deleted.
          </li>
          <li>
            A month is closed and you need to change something inside it? Open{" "}
            <Link href="/month-end" className={linkClass}>Month closing</Link>, pick the month and reopen it. You will be asked for a
            reason.
          </li>
          <li>Cannot sign in? Check your email and password. If it still does not work, ask whoever set the system up to reset it.</li>
          <li>Not sure whether to record Received or Correction? If stock arrived, Received. If the system and the shelf disagree, Correction.</li>
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

function TaskRow({ when, to, href }: { when: string; to: string; href: string }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-xl border border-rule bg-surface-2/60 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="text-sm">{when}</span>
      <Link href={href} className={linkClass}>
        {to}
      </Link>
    </li>
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
