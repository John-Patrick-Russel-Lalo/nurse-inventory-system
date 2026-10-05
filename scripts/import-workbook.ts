// One-time migration: reads the old workbook, rebuilds it as a ledger of stock movements and
// writes it to the database. Nothing is written until the numbers have been checked.
//
//   npm run import:workbook -- --report
//   npm run import:workbook -- --apply
//   npm run import:workbook -- --apply --reject-gap MED-018:2026-02-01
//   npm run import:workbook -- --apply --reset        # clears an earlier import first
//
// The report mode prints what would happen and writes import-report.json. The apply mode refuses
// to run while any stock movement exists, unless --reset is given, because this is meant to be
// the only time history is loaded in bulk.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma, PrismaClient, type Category, type TxType } from "@prisma/client";
import { buildImportPlan, batchKey, type GapReview, type ImportPlan } from "../src/lib/import-ledger.ts";
import { toDbDate, today as todayInManila } from "../src/lib/dates.ts";
import { readWorkbook, type ParsedWorkbook } from "../src/lib/workbook.ts";

// Next.js loads .env for the app, but a plain tsx run does not, and Prisma reads these values
// when the client starts. Loading it here means `npm run import:workbook` works on its own.
try {
  process.loadEnvFile();
} catch {
  // No .env file: the values must already be in the environment.
}

const prisma = new PrismaClient();

const DEFAULT_WORKBOOK = "NURSE.xlsx";
/** createMany sends one statement per chunk, so the work is split to stay under the limit. */
const CHUNK = 1000;

/** The ID prefix says what the item is, which is what the plan's Category list came from. */
function categoryFor(itemId: string): Category {
  const prefix = itemId.split("-")[0]?.toUpperCase() ?? "";
  switch (prefix) {
    case "MED": return "MEDICINE";
    case "SUP": return "SUPPLY";
    case "EQP": return "EQUIPMENT";
    case "TOP": return "TOPICAL";
    case "SOL": return "SOLUTION";
    case "MSC": return "MISC";
    default: throw new Error(`Item "${itemId}" has an unknown prefix. Add it to categoryFor().`);
  }
}

/** "--apply", "--reject-gap X", and so on. */
interface Options {
  workbook: string;
  apply: boolean;
  /** Report only, which is also what happens with no options. */
  report: boolean;
  help: boolean;
  reset: boolean;
  today: string;
  rejectGaps: string[];
}

const USAGE = `Reads the old workbook and rebuilds it as stock movements.

  npm run import:workbook -- --report              print the report and write import-report.json
  npm run import:workbook -- --apply               write the movements to the database
  npm run import:workbook -- --apply --reset       clear an earlier import first
  npm run import:workbook -- --apply --reject-gap MED-018:2026-02-01

Options
  --workbook PATH   the .xlsx to read. Default: $IMPORT_WORKBOOK_PATH, or NURSE.xlsx
  --today DATE      the date used to decide which batches have expired. Default: today
  --reset           delete existing batches and movements before importing
  --reject-gap      leave a month-opening gap unadjusted, repeated for each one
`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    workbook: process.env.IMPORT_WORKBOOK_PATH ?? DEFAULT_WORKBOOK,
    apply: false,
    report: false,
    help: false,
    reset: false,
    today: todayInManila(),
    rejectGaps: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--report") options.report = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--workbook") options.workbook = argv[++i] ?? options.workbook;
    else if (arg === "--today") options.today = argv[++i] ?? options.today;
    else if (arg === "--reject-gap") options.rejectGaps.push(argv[++i] ?? "");
    else throw new Error(`Unknown option "${arg}". Run with --help to see the options.`);
  }
  for (const gap of options.rejectGaps) {
    if (!/^[A-Z]{3}-\d{3}:\d{4}-\d{2}-\d{2}$/.test(gap)) {
      throw new Error(`--reject-gap wants ITEM:DATE, for example MED-018:2026-02-01, not "${gap}".`);
    }
  }
  return options;
}

/** Drops the rejected gaps and everything that hangs off them. */
function withoutRejectedGaps(plan: ImportPlan, rejected: Set<string>): ImportPlan {
  if (rejected.size === 0) return plan;
  const dropped = new Set(
    plan.transactions
      .filter((tx) => tx.type === "ADJUST" && rejected.has(`${tx.itemId}:${tx.date}`))
      .map((tx) => batchKey(tx.itemId, tx.expiry)),
  );
  return {
    ...plan,
    transactions: plan.transactions.filter((tx) => !(tx.type === "ADJUST" && rejected.has(`${tx.itemId}:${tx.date}`))),
    batches: plan.batches.filter((b) => !dropped.has(batchKey(b.itemId, b.expiry))),
    gaps: plan.gaps.filter((g) => !rejected.has(`${g.itemId}:${g.date}`)),
  };
}

// ---------- the report ----------

/** What the report file holds and the audit entry keeps: the whole story of the migration. */
interface ImportReport {
  generatedAt: string;
  workbook: string;
  today: string;
  months: { sheet: string; month: string; rows: number; firstDate: string; lastDate: string }[];
  sources: { month: string; source: string }[];
  summary: ImportPlan["summary"];
  reconciliation: {
    monthEndsChecked: number;
    mismatches: { month: string; itemId: string; expected: number; rebuilt: number }[];
    received: { inWorkbook: number; planned: number };
    dispensed: { inWorkbook: number; planned: number };
  };
  gaps: GapReview[];
  lateOpenings: ImportPlan["lateOpenings"];
  noExpiry: ImportPlan["noExpiry"];
  expired: ImportPlan["expired"];
  stoppedRecording: ImportPlan["stoppedRecording"];
  unusedItems: string[];
  unmatchedWideRows: ParsedWorkbook["unmatched"];
}

function buildReport(parsed: ParsedWorkbook, plan: ImportPlan, options: Options, generatedAt: string): ImportReport {
  return {
    generatedAt,
    workbook: resolve(options.workbook),
    today: options.today,
    months: parsed.months.map((m) => ({
      sheet: m.sheet,
      month: m.month,
      rows: m.rows.length,
      firstDate: m.firstDate,
      lastDate: m.lastDate,
    })),
    sources: parsed.sources,
    summary: plan.summary,
    reconciliation: {
      monthEndsChecked: plan.reconciliation.rows.length,
      mismatches: plan.reconciliation.mismatches,
      received: { inWorkbook: plan.reconciliation.receivedInWorkbook, planned: plan.reconciliation.receivedPlanned },
      dispensed: { inWorkbook: plan.reconciliation.dispensedInWorkbook, planned: plan.reconciliation.dispensedPlanned },
    },
    gaps: plan.gaps,
    lateOpenings: plan.lateOpenings,
    noExpiry: plan.noExpiry,
    expired: plan.expired,
    stoppedRecording: plan.stoppedRecording,
    unusedItems: plan.unusedItems,
    unmatchedWideRows: parsed.unmatched,
  };
}

function printReport(parsed: ParsedWorkbook, plan: ImportPlan, options: Options): void {
  const s = plan.summary;
  const line = (label = "") => console.log(label);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const units = (n: number) => `${String(n).padStart(6)} ${n === 1 ? "unit" : "units"}`;

  line("=".repeat(72));
  line(`Workbook  ${resolve(options.workbook)}`);
  line(`Months    ${s.months}, ${s.firstDate} to ${s.lastDate}, ${plural(s.days, "day")} with a movement`);
  line(`Items     ${parsed.items.length} in the catalogue, ${s.items} seen in the tabs`);
  line("=".repeat(72));

  line();
  line(`Entries to write: ${plan.transactions.length}`);
  line(`  OPENING  ${String(s.counts.OPENING).padStart(6)}  ${units(s.openingUnits)}`);
  line(`  RECEIVE  ${String(s.counts.RECEIVE).padStart(6)}  ${units(s.receivedUnits)}`);
  line(`  DISPENSE ${String(s.counts.DISPENSE).padStart(6)}  ${units(s.dispensedUnits)}`);
  line(`  ADJUST   ${String(s.counts.ADJUST).padStart(6)}  ${units(s.adjustUnits)}`);
  line(`Batches   ${plan.batches.length}, of which ${s.stockedBatches} hold stock`);
  line(`On hand   ${plural(s.unitsOnHand, "unit")}`);
  line(`Sources   ${parsed.sources.length ? parsed.sources.map((x) => `${x.month} ${x.source}`).join(", ") : "none found"}`);

  line();
  const { mismatches, rows, receivedInWorkbook, receivedPlanned, dispensedInWorkbook, dispensedPlanned } = plan.reconciliation;
  line(`Month ends rebuilt: ${rows.length - mismatches.length} of ${rows.length} match the workbook`);
  const totalsOk = receivedInWorkbook === receivedPlanned && dispensedInWorkbook === dispensedPlanned;
  line(`Totals: received ${receivedPlanned}/${receivedInWorkbook}, dispensed ${dispensedPlanned}/${dispensedInWorkbook} ${totalsOk ? "(match)" : "(DO NOT MATCH)"}`);
  for (const m of mismatches.slice(0, 20)) {
    line(`  MISMATCH ${m.month} ${m.itemId}: workbook ${m.expected}, rebuilt ${m.rebuilt}`);
  }
  if (mismatches.length > 20) line(`  ... and ${mismatches.length - 20} more`);

  section(`Month openings that do not match the previous close (${plan.gaps.length})`, plan.gaps, (g: GapReview) =>
    `  ${g.itemId.padEnd(9)} ${g.date}  ${String(g.from).padStart(6)} -> ${String(g.to).padStart(6)}  (${g.difference > 0 ? "+" : ""}${g.difference})  ${g.previousMonth} -> ${g.month}`);

  section(`Items that join the sheet later, already holding stock (${plan.lateOpenings.length})`, plan.lateOpenings, (o) =>
    `  ${o.itemId.padEnd(9)} ${o.date}  ${units(o.qty)}`);

  section(`Stock on hand with no expiry recorded (${plan.noExpiry.length})`, plan.noExpiry, (b) =>
    `  ${b.itemId.padEnd(9)} ${units(b.balance)}`);

  section(`Stock on hand in a batch that has already expired (${plan.expired.length})`, plan.expired, (b) =>
    `  ${b.itemId.padEnd(9)} ${b.expiry}  ${units(b.balance)}`);

  section(`Items whose rows stop before the newest month (${plan.stoppedRecording.length})`, plan.stoppedRecording, (r) =>
    `  ${r.itemId.padEnd(9)} last recorded ${r.lastDate}, ${units(r.balance)} frozen`);

  if (plan.unusedItems.length) line(`\nCatalogue items no tab ever mentions (${plan.unusedItems.length}): ${plan.unusedItems.join(", ")}`);
  if (parsed.unmatched.length) {
    line(`\nWide-tab rows that matched no item (${parsed.unmatched.length}):`);
    for (const u of parsed.unmatched) line(`  ${u.sheet} row ${u.row}: ${u.name}`);
  }
  line();
}

function section<T>(title: string, rows: T[], format: (row: T) => string): void {
  console.log();
  console.log(title);
  const shown = rows.slice(0, 25).map(format);
  for (const l of shown) console.log(l);
  if (rows.length > shown.length) console.log(`  ... and ${rows.length - shown.length} more`);
  if (rows.length === 0) console.log("  none");
}

// ---------- writing to the database ----------

async function findImporterId(): Promise<number> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const user = email
    ? await prisma.user.findUnique({ where: { email } })
    : await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { id: "asc" } });
  if (!user) {
    throw new Error(
      "No admin account to attribute the import to. Run `npm run db:seed` with SEED_ADMIN_EMAIL and " +
        "SEED_ADMIN_PASSWORD set, or create an admin first.",
    );
  }
  if (!user.active) throw new Error(`${user.email} is inactive and cannot be the importer.`);
  return user.id;
}

async function applyImport(
  plan: ImportPlan,
  parsed: ParsedWorkbook,
  report: ImportReport,
  options: Options,
  userId: number,
): Promise<void> {
  const existing = await prisma.transaction.count();
  if (existing > 0 && !options.reset) {
    throw new Error(
      `There are already ${existing} stock movements in the database. ` +
        "This import is for an empty database; add --reset to clear them first.",
    );
  }

  const started = Date.now();
  await prisma.$transaction(
    async (tx) => {
      if (options.reset) {
        // Movements first: every row points at a batch, and the key is RESTRICT, so the batches
        // cannot go until nothing references them. Audit rows are kept, because the record of the
        // import being replaced is itself history.
        await tx.transaction.deleteMany();
        await tx.batch.deleteMany();
      }

      for (const item of parsed.items) {
        await tx.item.upsert({
          where: { id: item.id },
          // Edits made in the app (unit, reorder level, active) are left alone.
          update: {},
          create: { id: item.id, name: item.name, variant: item.note || null, category: categoryFor(item.id) },
        });
      }

      // One batch at a time, because every movement needs its ID. There are only a few hundred.
      const batchIds = new Map<string, number>();
      for (const batch of plan.batches) {
        const created = await tx.batch.create({
          data: {
            itemId: batch.itemId,
            expiry: batch.expiry ? toDbDate(batch.expiry) : null,
            receivedOn: batch.receivedOn ? toDbDate(batch.receivedOn) : null,
            source: batch.source,
            qtyReceived: batch.qtyReceived,
          },
          select: { id: true },
        });
        batchIds.set(batchKey(batch.itemId, batch.expiry), created.id);
      }

      const data = plan.transactions.map((t) => {
        const batchId = batchIds.get(batchKey(t.itemId, t.expiry));
        if (!batchId) throw new Error(`No batch was created for ${t.itemId} expiring ${t.expiry ?? "unknown"}.`);
        return {
          date: toDbDate(t.date),
          itemId: t.itemId,
          batchId,
          type: t.type,
          qty: t.qty,
          remarks: t.remarks,
          source: t.source,
          userId,
        };
      });
      for (let i = 0; i < data.length; i += CHUNK) {
        await tx.transaction.createMany({ data: data.slice(i, i + CHUNK) });
      }

      // The whole report goes into the audit trail, which is where /admin/import reads it from.
      // A migration you cannot re-read later is a migration you cannot trust.
      await tx.auditLog.create({
        data: {
          userId,
          action: "workbook.import",
          entity: "workbook",
          entityId: report.workbook,
          detail: { ...report, appliedAt: new Date().toISOString(), rejectedGaps: options.rejectGaps } as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );

  console.log(`Applied in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  await verify(plan);
}

/** Reads the balances back out of the database, so the check is on what was stored. */
async function verify(plan: ImportPlan): Promise<void> {
  const grouped = await prisma.transaction.groupBy({
    by: ["type"],
    _sum: { qty: true },
    _count: { _all: true },
  });
  const stored = new Map(grouped.map((g) => [g.type, { count: g._count._all, units: g._sum.qty ?? 0 }]));

  const expected = new Map<TxType, { count: number; units: number }>([
    ["OPENING", { count: plan.summary.counts.OPENING, units: plan.summary.openingUnits }],
    ["RECEIVE", { count: plan.summary.counts.RECEIVE, units: plan.summary.receivedUnits }],
    ["DISPENSE", { count: plan.summary.counts.DISPENSE, units: -plan.summary.dispensedUnits }],
    ["ADJUST", { count: plan.summary.counts.ADJUST, units: plan.summary.adjustUnits }],
  ]);

  const problems: string[] = [];
  for (const [type, want] of expected) {
    const got = stored.get(type);
    if (!got) problems.push(`${type}: nothing was stored, expected ${want.count} entries`);
    else if (got.count !== want.count || got.units !== want.units) {
      problems.push(`${type}: stored ${got.count} entries / ${got.units} units, expected ${want.count} / ${want.units}`);
    }
  }
  console.log(
    problems.length === 0
      ? "Verified: the stored entry counts and unit totals match the plan."
      : `VERIFICATION FAILED:\n  ${problems.join("\n  ")}`,
  );

  const batches = await prisma.batch.count();
  const negative = await prisma.$queryRaw<{ itemId: string; expiry: Date | null; balance: number }[]>`
    SELECT b."itemId", b.expiry, SUM(t.qty)::int AS balance
    FROM batches b JOIN transactions t ON t."batchId" = b.id
    WHERE t."voidedAt" IS NULL
    GROUP BY b.id
    HAVING SUM(t.qty) < 0
    ORDER BY SUM(t.qty)
  `;
  console.log(`Batches stored: ${batches}.`);
  console.log(
    negative.length === 0
      ? "No batch ends below zero."
      : `WARNING: ${negative.length} batches end below zero: ${negative
          .slice(0, 10)
          .map((b) => `${b.itemId} expiring ${b.expiry ? b.expiry.toISOString().slice(0, 10) : "unknown"} = ${b.balance}`)
          .join("; ")}`,
  );
}

// ---------- main ----------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const path = resolve(options.workbook);

  console.log(`Reading ${path} ...`);
  const parsed = await readWorkbook(path);
  const raw = buildImportPlan(parsed, { today: options.today });
  const plan = withoutRejectedGaps(raw, new Set(options.rejectGaps));
  const generatedAt = new Date().toISOString();

  if (options.rejectGaps.length) {
    console.log(`\nRejected ${options.rejectGaps.length} gap(s): ${options.rejectGaps.join(", ")}`);
    const missed = options.rejectGaps.filter((g) => !raw.gaps.some((x) => `${x.itemId}:${x.date}` === g));
    if (missed.length) console.log(`  not a gap in this workbook, ignored: ${missed.join(", ")}`);
  }

  printReport(parsed, plan, options);

  const report = buildReport(parsed, plan, options, generatedAt);
  const reportPath = resolve("import-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${reportPath}`);

  if (!options.apply) {
    console.log("\nNothing was written. Re-run with --apply to load the workbook.");
    return;
  }

  if (plan.reconciliation.mismatches.length > 0) {
    throw new Error(
      `${plan.reconciliation.mismatches.length} month end(s) do not rebuild to the workbook's balance. ` +
        "Nothing was written. Look at reconciliation.mismatches in the report.",
    );
  }

  const userId = await findImporterId();
  await applyImport(plan, parsed, report, options, userId);
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());