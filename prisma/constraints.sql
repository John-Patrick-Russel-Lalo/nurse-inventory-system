-- Database-level guards that Prisma's schema language cannot express.
-- Append this to the first migration (see README, "Database setup") before applying it.

-- Quantity is never zero, and its sign must match the entry type.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_qty_sign_check" CHECK (
  ("type" IN ('OPENING', 'RECEIVE') AND "qty" > 0)
  OR ("type" IN ('DISPENSE', 'DISPOSE') AND "qty" < 0)
  OR ("type" = 'ADJUST' AND "qty" <> 0)
);

-- A voided entry must say when and by whom.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_void_check" CHECK (
  ("voidedAt" IS NULL AND "voidedById" IS NULL)
  OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL)
);

-- Each item has at most one batch with an unknown expiry.
CREATE UNIQUE INDEX "batches_one_unknown_expiry_per_item"
  ON "batches" ("itemId")
  WHERE "expiry" IS NULL;

-- Month keys look like 2026-09.
ALTER TABLE "closed_months" ADD CONSTRAINT "closed_months_month_check" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "month_closings" ADD CONSTRAINT "month_closings_month_check" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');
