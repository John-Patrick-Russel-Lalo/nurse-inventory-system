
# Nurse Office Inventory

Next.js (App Router) + TypeScript + Prisma + PostgreSQL. A REST API under `src/app/api` does all
the work, and the screens under `src/app/(app)` are a TSX client for it. Stock is never stored as a
number: every change is a row, and balances are the sum of the rows.

## Screens

| Screen | Route | What it does |
| --- | --- | --- |
| Dashboard | `/` | Low stock, expiring batches, expired stock still on the shelf, latest entries, usage charts |
| Receive | `/receive` | Add stock. The expiry picks the batch. Admin-only opening balances |
| Dispense | `/dispense` | Dispense, Dispose and Adjust. Earliest expiry first, with a manual split |
| Stock | `/stock` | Balances with the batch breakdown, filtered by search, category or low stock. Download as xlsx |
| Expiry | `/expiry` | Stocked batches by how soon they expire: expired, 30, 60, 90 days |
| Month end | `/month-end` | Count the shelf, save counts, close the month, download the month as xlsx. Admin can reopen |
| Items | `/items` | The catalogue. Admin edits unit, reorder level and active |
| Item history | `/items/:id` | Batches, entries, and what the item was used and held month by month |
| Workbook import | `/admin/import` | What came in from NURSE.xlsx, and what still needs a decision |
| Audit log | `/admin/audit` | Every change, with who and when. Admin only |

## The API

All routes need a session and answer JSON. Failures come back as
`{ "error": string, "code": string }` with a real status: 400 for a bad request, 401/403 for
permission, 404 for missing, 409 when the stock rules refuse, 422 for a field that failed
validation. Pages are handled by the middleware; API routes are not, so they return JSON instead
of a redirect.

| Method | Route |
| --- | --- |
| `GET` | `/api/session` — who is signed in, today's date, closed months |
| `GET` | `/api/dashboard` |
| `GET` `POST` | `/api/items` — list, or add (admin) |
| `GET` `PATCH` | `/api/items/:id` — detail with batches and entries; edit (admin) |
| `GET` | `/api/stock` — balances per item |
| `GET` | `/api/expiry` |
| `GET` `POST` | `/api/transactions` — history, or record a movement |
| `POST` | `/api/transactions/allocate` — how a dispense would be split. Read-only |
| `POST` | `/api/transactions/:id/void` — reverse an entry (admin) |
| `GET` | `/api/months` |
| `GET` `POST` | `/api/month-end` — the counting sheet, or save counts |
| `POST` | `/api/month-end/close` · `/api/month-end/reopen` (admin) |
| `GET` | `/api/import` — the workbook migration report (admin) |
| `GET` | `/api/export/ledger?month=2026-09` or `?from=&to=` — the month as xlsx |
| `GET` | `/api/export/stock` — balances and batches as xlsx, honouring the stock filters |
| `GET` | `/api/audit` (admin) |

## Exporting

Both downloads are plain `.xlsx` files, so they open in Excel, LibreOffice or Sheets with no
import step. They are the *same* long shape as the old NURSE.xlsx tabs, one row per item per day,
because that is the layout a nurse or an auditor can actually read across.

**Month ledger** — from the Month end screen, or `GET /api/export/ledger?month=2026-09`. The
workbook has an `ITEMS` sheet naming every catalogue item, then one sheet per month, each with
`DATE`, `ITEM ID`, `ITEM NAME`, `BEGINNING`, `RECEIVED`, `DISPENSED`, `ENDING`, `EXPIRY`. Every
item appears on every day of the month, including the quiet ones, so each sheet is a full grid
rather than a list of changes.

| Column | Where it comes from |
| --- | --- |
| `BEGINNING` | The last day before the month, so the first row carries in the previous month's closing |
| `RECEIVED` | Everything that added stock: an `OPENING`, a `RECEIVE`, a positive `ADJUST` |
| `DISPENSED` | Everything that removed it: a `DISPENSE`, a `DISPOSE`, a negative `ADJUST` |
| `ENDING` | `BEGINNING + RECEIVED - DISPENSED`, which is the point of the sheet |
| `EXPIRY` | The earliest expiry among the batches still holding that item's stock that day |

Counting by direction is what keeps the arithmetic honest: received minus dispensed is always the
change in stock, whatever the entry was called. Voided entries are left out, and a month is refused
if it has not started yet. A range longer than 1,100 days is refused rather than attempted, so the
route cannot be asked for the whole history at once — ask for a month, or a few.

**Stock** — from the Stock screen, or `GET /api/export/stock`. Two sheets: `STOCK` with one row per
item (`ITEM ID`, `ITEM NAME`, `CATEGORY`, `UNIT`, `ON HAND`, `REORDER LEVEL`, `NEAREST EXPIRY`), and
`BATCHES` with the split behind it. The filters on the screen are the filters on the file, so
"low stock only" gives you a low-stock file.

Ledger exports write a `ledger.export` audit entry with the row count and the totals. Stock exports
are a read, so they do not.

## Usage charts

The dashboard plots received against dispensed for the last twelve months, and what the office used
most this month. An item's history plots the same movement for that item, plus what it held at each
month end, with the reorder level as a flat line to check it against.

Both are rebuilt from entries with the same direction rule as the export, so a chart and its
spreadsheet cannot disagree. The series runs to the month in progress and carries a balance forward
across a month with no movement, which means every chart ends at today's balance. A month with no
entries is a zero, never a gap.

The colours are the same CSS variables the tables use, so the charts follow the light and dark
setting rather than carrying a palette of their own.

## Where the code lives

| Part | Where |
| --- | --- |
| Stock rules (balances, earliest-expiry-first, no-negative, entry-date rules) | `src/lib/stock.ts`, tests in `src/lib/stock.test.ts` |
| Reading the old workbook (ITEMS, the 20 long tabs, the wide tab's expiry columns) | `src/lib/workbook.ts`, tests in `src/lib/workbook.test.ts` |
| Turning those rows into batches and movements | `src/lib/import-ledger.ts`, tests in `src/lib/import-ledger.test.ts` |
| Rebuilding a month's daily ledger rows from entries | `src/lib/export-ledger.ts`, tests in `src/lib/export-ledger.test.ts` |
| Writing the xlsx files, ledger and stock | `src/server/export.ts` |
| Running the import and checking it against the database | `scripts/import-workbook.ts`, `scripts/verify-import.ts` |
| Date handling, Manila time zone, `YYYY-MM-DD` strings | `src/lib/dates.ts`, tests in `src/lib/dates.test.ts` |
| The shape of every request and response | `src/lib/api-types.ts` |
| Domain services: balances, movements, voids, month close, audit | `src/server/` |
| Route handlers (validation, auth, status codes) | `src/app/api/**/route.ts` |
| Typed fetch client used by the screens | `src/lib/api.ts` |
| Shared UI pieces | `src/components/` |
| The three usage charts, on Recharts | `src/components/Charts.tsx` |
| Database schema | `prisma/schema.prisma`, extra guards in `prisma/constraints.sql` |
| Seed: 151 items from the workbook and the first admin | `prisma/seed.ts`, `prisma/items.seed.json` |
| Sign-in (Auth.js, email + password), roles NURSE and ADMIN | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` |
| Making and deactivating accounts | `scripts/create-user.ts` |

## Setup

Requires Node 22.18 or newer.

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, DIRECT_URL, AUTH_SECRET and the SEED_ADMIN_* values
```

### Database setup

Create an empty Postgres database (a free Neon project works; a local Postgres works too). Then:

```bash
npm run db:deploy           # applies prisma/migrations, which already includes constraints.sql
npm run db:seed
```

That is the whole setup. The init migration is committed, so there is no `--create-only` step and
nothing to paste by hand.

If you edit `prisma/constraints.sql`, run `npm run db:constraints` to copy it into the init
migration. On a database that is already migrated, apply the extra SQL by hand, since the guards
are deliberately not in the schema file that Prisma diffs.

### Accounts

`npm run db:seed` creates the first admin from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, and
leaves it alone if it already exists. There is no screen for accounts, because the office is one to
three people; they are made from the command line instead.

```bash
npm run user:create -- --email nurse@office.gov --name "A nurse"
npm run user:create -- --email supervisor@office.gov --role ADMIN
npm run user:create -- --email nurse@office.gov --reset-password
npm run user:create -- --email nurse@office.gov --deactivate   # and --activate to undo
```

A password is generated and printed once unless `--password` is passed. It must be at least ten
characters, the same floor the seed uses. Running the command against an account that already exists
changes nothing unless a matching flag is given, so it cannot quietly promote somebody to admin.

`NURSE` records entries. `ADMIN` also edits items, voids entries, reopens closed months, imports the
workbook and reads the audit log. Deactivating an account refuses its sign-in but keeps its name on
everything it already recorded, which is what the audit trail needs.

```bash
npm run dev          # http://localhost:3000
npm test             # stock, import, export and date rules, 77 tests, no database needed
npm run typecheck
npm run lint
npm run db:constraints   # copy constraints.sql into the init migration
npm run user:create -- --help
npm run db:studio    # browse the tables
```

## Bringing the old workbook in

NURSE.xlsx holds 20 converted months, 151 items and 73,719 daily rows. The import turns those
rows into movements, so the app never stores a balance — only the entries that produce one.

```bash
# See what would happen. Writes import-report.json and prints the reconciliation.
npm run import:workbook -- --report --workbook "C:\path\to\NURSE.xlsx"

# Write it. One transaction: either all of it lands or none of it does.
npm run import:workbook -- --apply --workbook "C:\path\to\NURSE.xlsx"
```

`--apply` refuses to run when any movement already exists, unless `--reset` is added. That is
deliberate: this is the one time history is loaded in bulk, and a second run should be a decision
rather than an accident. `--reject-gap MED-018:2026-02-01` leaves a single month-opening gap
unadjusted, which is the way to say "the sheet was wrong, not the stock".

On NURSE.xlsx the report is 1,675 entries: 86 openings, 137 receipts, 1,437 dispenses and 15
adjustments, across 179 batches. All 2,706 month ends rebuild to the balance the workbook wrote,
and the received and dispensed totals match the sheet exactly.

`npm run import:workbook -- --help` lists every option. `npm run import:verify -- --workbook <path>`
is the independent check: it reads the movements back out of the database and rebuilds each month
end from them, so it tests what was stored rather than what was planned.

### How each workbook row became an entry

| Workbook | In the app |
| --- | --- |
| An item's first row, with stock on hand | `OPENING` for that amount, on the batch whose expiry the tab recorded |
| A `RECEIVED` value | One `RECEIVE`, on the batch for that day's expiry |
| A `DISPENSED` value | One `DISPENSE`, earliest expiry first |
| Both zero | Nothing. Quiet days are not entries |
| A month opening at a different number than the last month closed | An `ADJUST` on the first day, so the numbers add up and the difference is visible |

A converted tab keeps only one expiry per item, so the workbook cannot say which physical batch
a movement came from. The rule used here is: a movement is booked against the batch whose expiry
the tab recorded *that day*, and when that batch cannot cover a dispense the remainder comes from
the item's other batches, earliest expiry first. That is the same rule the app applies when a
nurse dispenses, and it is what keeps every batch at or above zero. Stock the office never
recorded an expiry for goes into one "unknown expiry" batch per item.

The wide tabs are read for two things only: their two `EXPIRATION DATE` columns, which are the
only record of an item's second batch, and the `Additional (fr. HSO Alangilan)` header, which
names the source of a delivery. When the wide tab knows about a second batch the workbook does not
say how the balance on hand splits between the two, so the second batch is created empty rather
than guessed at, and the next delivery fills it.

### What the report lists

- **Month ends that do not rebuild.** Must be zero. `--apply` refuses to write if it is not.
- **Month-opening gaps.** The 15 the build plan predicted, each now an adjustment entry. Follow
  the item link to see it in the history, and correct it there if the sheet was the wrong one.
- **Stock past its expiry.** Imported as found and flagged, including BIOFLU's 500 units and a
  roll of LEUKOPLAST dated 2021. Dispose of them from `/expiry`.
- **Stock with no expiry.** 44 items hold stock the workbook never gave an expiry for. Receiving
  asks for one now, so this list should only get shorter.
- **Items the office stopped recording.** Their rows stop before the newest month, so the balance
  is frozen. Confirm whether the item is still in use.

The full report is kept in the audit trail under `workbook.import`, which is where `/admin/import`
reads it from. A migration you cannot re-read later is a migration you cannot trust.

## How a stock movement is recorded

1. The route validates the body with zod and the session with `src/server/context.ts`.
2. `src/lib/stock.ts` decides the signs and rejects anything impossible.
3. `src/server/inventory.ts` opens one serializable transaction: it reads the batch balances,
   picks the batches, writes one `Transaction` row per batch, and writes the audit entry with
   them. Serializable is what stops two nurses taking the last unit at the same time; a
   serialization conflict is retried, a rule violation is not.
4. The response carries the new balance and the rows that were written.

Nothing is ever deleted. Voiding an entry sets `voidedAt`, so the balance ignores it while the
history still shows what was recorded and who reversed it.

## Decisions worth knowing

- Dates are `YYYY-MM-DD` strings throughout, and today is computed in `Asia/Manila`, so the time
  zone cannot shift an entry into another day.
- Every transaction belongs to a batch. Items with no known expiry get one "unknown expiry"
  batch, which a partial unique index enforces.
- An expiry is stored as the last day of its month. A batch expiring today is still usable today.
- A DISPENSE spanning several batches becomes several rows sharing one date and remarks, so the
  split stays readable in the history.
- Nurses may record up to `NURSE_BACKDATE_DAYS` back (default 3) and never into a closed month.
  Admins have no backdate limit. Opening balances are admin-only.
- Closing a month needs a count for every active item, and also refuses the month in progress.
  Reopening deletes the closing rows and writes an audit entry saying why.
- The screens fetch from the API rather than calling Prisma, so the API is exercised in normal
  use and cannot quietly drift from what the app needs.
- The item `unit` and `reorderLevel` still start empty for the seeded items; fill them in on
  `/items`. An item with no reorder level is never flagged as low.
- Tests use Node's built-in runner, so the stock rules are tested without installing anything.
  The server services are not unit-tested: they need a database, and the rules they delegate to
  are.
- The workbook import is a command-line job, not a screen. It reads a 4 MB spreadsheet and writes
  thousands of rows, which does not belong in a request. `/admin/import` only reports what that
  run recorded.
- The whole history is importable without a name clash because `transactions.batchId` points at a
  batch that the import creates itself, so an item can hold stock in two batches on the same day.
- The export is a long grid, not a short list of changes. A month of 151 items is about 4,500 rows,
  which Excel opens without complaint, and every row carries its own arithmetic, so a gap shows up
  as a row that does not add up rather than as a number that is quietly missing.
- An export is built from entries, never from a stored balance, for the same reason the app has no
  stored balance: one rule produces the numbers everywhere.
- Recharts is the only chart library in the project. It is the one heavy dependency, and it is
  client-side only, so it never reaches a route handler or the database.
- A malformed date answers 400, never 500. `2026-13-01` passes a date's shape but is not a date,
  and the guard for that lives in `isDateString` so every caller gets it.
