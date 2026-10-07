// Creates a sign-in account. The seed only makes the first admin, and the office is small enough
// (the plan says one to three people) that managing accounts from a command line is enough.
//
//   npm run user:create -- --email nurse@office.gov --name "A nurse"
//   npm run user:create -- --email nurse@office.gov --role ADMIN
//   npm run user:create -- --email nurse@office.gov --reset-password
//   npm run user:create -- --email nurse@office.gov --deactivate
//
// A password is generated and printed once unless --password is given. An existing account is
// never silently overwritten: the role and active flag are left alone unless the matching flag is
// passed, so this cannot quietly hand somebody admin.

import { randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

// Next.js loads .env for the app, but a plain tsx run does not, and Prisma reads these values
// when the client starts.
try {
  process.loadEnvFile();
} catch {
  // No .env file: the values must already be in the environment.
}

const prisma = new PrismaClient();

/** Matches the seed's floor and the app's own rule, so no account can be weaker than the others. */
const MIN_PASSWORD = 10;

const roleSchema = z.enum(["NURSE", "ADMIN"]);

interface Options {
  email: string;
  name: string | null;
  password: string | null;
  role: Role | null;
  resetPassword: boolean;
  deactivate: boolean;
  activate: boolean;
  help: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run user:create -- --email <address> [--name <name>] [--role NURSE|ADMIN]",
    "                          [--password <password>] [--reset-password]",
    "                          [--deactivate | --activate]",
    "",
    "  --email          Required. The address the account signs in with.",
    "  --name           Display name. Defaults to the part before the @.",
    "  --role           NURSE (the default) can record. ADMIN can also edit items, void entries,",
    "                   reopen months and import. Only pass this deliberately.",
    "  --password       At least 10 characters. One is generated and printed if this is left out.",
    "  --reset-password Change the password of an existing account.",
    "  --deactivate     Sign-in is refused, but the entries already recorded keep their name.",
    "  --activate       Undo --deactivate.",
    "",
    "Example:",
    '  npm run user:create -- --email nurse@office.gov --name "A nurse"',
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    email: "",
    name: null,
    password: null,
    role: null,
    resetPassword: false,
    deactivate: false,
    activate: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--email") options.email = argv[++i] ?? "";
    else if (arg === "--name") options.name = argv[++i] ?? null;
    else if (arg === "--password") options.password = argv[++i] ?? null;
    else if (arg === "--role") {
      const parsed = roleSchema.safeParse(argv[++i]);
      if (!parsed.success) throw new Error(`--role must be NURSE or ADMIN, not "${argv[i]}".`);
      options.role = parsed.data;
    } else if (arg === "--reset-password") options.resetPassword = true;
    else if (arg === "--deactivate") options.deactivate = true;
    else if (arg === "--activate") options.activate = true;
    else throw new Error(`Unknown option "${arg}". Run with --help to see the options.`);
  }
  return options;
}

/** Readable and long enough, with the ambiguous characters left out. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function checkPassword(password: string): string {
  if (password.length < MIN_PASSWORD) {
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  }
  return password;
}

async function createUser(options: Options): Promise<void> {
  if (!options.email) throw new Error("--email is required. Run with --help to see the options.");

  const emailParsed = z.string().email().safeParse(options.email.trim().toLowerCase());
  if (!emailParsed.success) throw new Error(`"${options.email}" is not an email address.`);
  const email = emailParsed.data;

  if (options.deactivate && options.activate) {
    throw new Error("Pass --deactivate or --activate, not both.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const changes: string[] = [];
    const data: { name?: string; role?: Role; active?: boolean; passwordHash?: string } = {};

    if (options.name && options.name !== existing.name) {
      data.name = options.name;
      changes.push("name");
    }
    if (options.role && options.role !== existing.role) {
      data.role = options.role;
      changes.push("role");
    }
    if (options.deactivate && existing.active) {
      data.active = false;
      changes.push("deactivated");
    }
    if (options.activate && !existing.active) {
      data.active = true;
      changes.push("activated");
    }
    if (options.resetPassword) {
      const password = checkPassword(options.password ?? generatePassword());
      data.passwordHash = await bcrypt.hash(password, 12);
      changes.push("password");
      if (!options.password) console.log(`New password: ${password}`);
      console.log("Print it once and do not keep it in a file or a message.");
    }

    if (Object.keys(data).length === 0) {
      console.log(`${email} already exists as ${existing.role}${existing.active ? "" : " (deactivated)"}, nothing to change.`);
      return;
    }
    await prisma.user.update({ where: { email }, data });
    console.log(`${email} updated: ${changes.join(", ")}.`);
    return;
  }

  const password = checkPassword(options.password ?? generatePassword());
  await prisma.user.create({
    data: {
      name: options.name?.trim() || email.split("@")[0],
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: options.role ?? "NURSE",
    },
  });
  console.log(`Created ${options.role ?? "NURSE"} ${email}.`);
  if (!options.password) console.log(`Password: ${password}`);
  console.log("Print it once and do not keep it in a file or a message.");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await createUser(options);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());