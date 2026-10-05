// Appends prisma/constraints.sql to the init migration, so the guards live in
// exactly one place. Run after editing constraints.sql:
//   node scripts/sync-constraints.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const constraints = readFileSync(join(root, "prisma", "constraints.sql"), "utf8").trim();

const migrationsDir = join(root, "prisma", "migrations");
const initDir = readdirSync(migrationsDir)
  .filter((d) => d.endsWith("_init"))
  .sort()[0];

if (!initDir) {
  console.error("No *_init migration found under prisma/migrations.");
  process.exit(1);
}

const file = join(migrationsDir, initDir, "migration.sql");
const MARKER = "-- Guards from prisma/constraints.sql";

let sql = readFileSync(file, "utf8");
const at = sql.indexOf(MARKER);

if (at !== -1) {
  sql = sql.slice(0, at).trimEnd();
}

const banner = [
  "-- =====================================================================",
  `-- Guards from prisma/constraints.sql (kept in sync by scripts/sync-constraints.mjs).`,
  "-- Prisma's schema language cannot express CHECK constraints or partial",
  "-- unique indexes, so they are applied here as part of the init migration.",
  "-- =====================================================================",
].join("\n");

writeFileSync(file, `${sql}\n\n${banner}\n\n${constraints}\n`);
console.log(`Synced constraints into prisma/migrations/${initDir}/migration.sql`);
