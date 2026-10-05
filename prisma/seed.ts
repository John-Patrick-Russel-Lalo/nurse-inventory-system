// Loads the 151 items from the workbook and creates the first admin account.
// Safe to run again: items are upserted by ID, and an existing admin is left unchanged.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Category } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

interface SeedItem {
  id: string;
  name: string;
  variant: string | null;
  category: Category;
}

async function seedItems() {
  const items: SeedItem[] = JSON.parse(readFileSync(join(here, "items.seed.json"), "utf8"));
  for (const it of items) {
    await prisma.item.upsert({
      where: { id: it.id },
      // Existing rows keep any edits made in the app (unit, reorder level, active).
      update: {},
      create: { id: it.id, name: it.name, variant: it.variant, category: it.category },
    });
  }
  console.log(`Items: ${items.length} ensured.`);
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Office Admin";
  if (!email || !password) {
    console.log("Admin: skipped (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create one).");
    return;
  }
  if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters.");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin: ${email} already exists, left unchanged.`);
    return;
  }
  await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN" },
  });
  console.log(`Admin: created ${email}.`);
}

async function main() {
  await seedItems();
  await seedAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
