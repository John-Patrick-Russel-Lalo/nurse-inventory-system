-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('NURSE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('MEDICINE', 'SUPPLY', 'EQUIPMENT', 'TOPICAL', 'SOLUTION', 'MISC');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('OPENING', 'RECEIVE', 'DISPENSE', 'ADJUST', 'DISPOSE');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'NURSE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "category" "Category" NOT NULL,
    "unit" TEXT,
    "reorderLevel" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "itemId" TEXT NOT NULL,
    "expiry" DATE,
    "label" TEXT,
    "source" TEXT,
    "receivedOn" DATE,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" INTEGER NOT NULL,
    "type" "TxType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "source" TEXT,
    "remarks" TEXT,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closed_months" (
    "month" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" INTEGER NOT NULL,

    CONSTRAINT "closed_months_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "month_closings" (
    "id" SERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "counted" INTEGER NOT NULL,
    "system" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "items_category_idx" ON "items"("category");

-- CreateIndex
CREATE INDEX "batches_itemId_expiry_idx" ON "batches"("itemId", "expiry");

-- CreateIndex
CREATE INDEX "transactions_itemId_date_idx" ON "transactions"("itemId", "date");

-- CreateIndex
CREATE INDEX "transactions_batchId_idx" ON "transactions"("batchId");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "month_closings_month_itemId_key" ON "month_closings"("month", "itemId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_months" ADD CONSTRAINT "closed_months_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_closings" ADD CONSTRAINT "month_closings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================

-- =====================================================================
-- Guards from prisma/constraints.sql (kept in sync by scripts/sync-constraints.mjs).
-- Prisma's schema language cannot express CHECK constraints or partial
-- unique indexes, so they are applied here as part of the init migration.
-- =====================================================================

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
