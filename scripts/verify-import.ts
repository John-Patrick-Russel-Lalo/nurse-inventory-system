// Checks the database against the workbook, independently of the importer: it reads the stored
// movements back out, rebuilds every month end from them, and compares with what NURSE.xlsx says.
// Run with: npx tsx scripts/verify-import.ts --workbook <path>
process.loadEnvFile();

import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { readWorkbook } from "../src/lib/workbook.ts";
import { fromDbDate } from "../src/lib/dates.ts";

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] ?? null : null;
}

async function main(): Promise<void> {
  const path = resolve(arg("workbook") ?? process.env.IMPORT_WORKBOOK_PATH ?? "NURSE.xlsx");
  console.log(`Workbook ${path}`);
  const parsed = await readWorkbook(path);

  const rows = await prisma.transaction.findMany({
    select: { itemId: true, date: true, qty: true, voidedAt: true, type: true, batch: { select: { expiry: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const live = rows.filter((r) => r.voidedAt === null);
  console.log(`Stored: ${rows.length} movements, ${live.length} not voided.`);

  const batches = await prisma.batch.findMany({ select: { id: true, itemId: true, expiry: true } });
  console.log(`Batches: ${batches.length}`);

  // Running balance per item, in date order. The stored date is a Date, the workbook's is a
  // "YYYY-MM-DD" string, so it is converted before anything is compared.
  const byItem = new Map<string, { date: string; qty: number }[]>();
  for (const r of live) {
    let list = byItem.get(r.itemId);
    if (!list) byItem.set(r.itemId, (list = []));
    list.push({ date: fromDbDate(r.date)!, qty: r.qty });
  }

  let checks = 0;
  const problems: string[] = [];
  for (const month of parsed.months) {
    const expected = new Map<string, number>();
    for (const row of month.rows) expected.set(row.itemId, row.ending);

    for (const [itemId, ending] of expected) {
      let balance = 0;
      for (const r of byItem.get(itemId) ?? []) {
        if (r.date > month.lastDate) break;
        balance += r.qty;
      }
      checks++;
      if (balance !== ending) problems.push(`${month.month} ${itemId}: workbook ${ending}, database ${balance}`);
    }
  }

  const units = live.reduce((s, r) => s + r.qty, 0);
  const itemsWithStock = [...byItem.entries()].filter(([, list]) => list.reduce((s, r) => s + r.qty, 0) > 0).length;

  const negativeBatches = await prisma.$queryRaw<{ itemId: string; expiry: Date | null; balance: number }[]>`
    SELECT b."itemId", b.expiry, SUM(t.qty)::int AS balance
    FROM batches b JOIN transactions t ON t."batchId" = b.id
    WHERE t."voidedAt" IS NULL GROUP BY b.id HAVING SUM(t.qty) < 0`;
  const unknownExpiryStock = await prisma.$queryRaw<{ itemId: string; balance: number }[]>`
    SELECT b."itemId", SUM(t.qty)::int AS balance
    FROM batches b JOIN transactions t ON t."batchId" = b.id
    WHERE t."voidedAt" IS NULL AND b.expiry IS NULL GROUP BY b."itemId" HAVING SUM(t.qty) > 0`;
  const expiredStock = await prisma.$queryRaw<{ itemId: string; expiry: Date; balance: number }[]>`
    SELECT b."itemId", b.expiry, SUM(t.qty)::int AS balance
    FROM batches b JOIN transactions t ON t."batchId" = b.id
    WHERE t."voidedAt" IS NULL AND b.expiry < CURRENT_DATE GROUP BY b.id HAVING SUM(t.qty) > 0
    ORDER BY b.expiry`;

  console.log(`\nMonth ends checked: ${checks}, matching: ${checks - problems.length}`);
  for (const p of problems.slice(0, 25)) console.log(`  MISMATCH ${p}`);
  if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`);
  console.log(`\nUnits on hand (sum of all stored movements): ${units}`);
  console.log(`Items holding stock: ${itemsWithStock}`);
  console.log(`Batches below zero: ${negativeBatches.length}`);
  console.log(`Stock with no expiry: ${unknownExpiryStock.length} items, ${unknownExpiryStock.reduce((s, r) => s + r.balance, 0)} units`);
  console.log(`Expired stock on hand: ${expiredStock.length} batches, ${expiredStock.reduce((s, r) => s + r.balance, 0)} units`);
  for (const e of expiredStock) console.log(`  ${e.itemId} ${e.expiry.toISOString().slice(0, 10)} ${e.balance}`);

  const audit = await prisma.auditLog.findFirst({ where: { action: "workbook.import" }, orderBy: { id: "desc" } });
  console.log(`\nAudit entry: ${audit ? `${audit.action} on ${audit.entityId} at ${audit.at.toISOString()}` : "MISSING"}`);

  console.log(problems.length === 0 && negativeBatches.length === 0 ? "\nPASS" : "\nFAIL");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());