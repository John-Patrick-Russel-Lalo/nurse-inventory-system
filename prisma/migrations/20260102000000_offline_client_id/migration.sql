-- Idempotency key for offline devices replaying a queued movement.
ALTER TABLE "transactions" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "transactions_clientId_key" ON "transactions"("clientId");
