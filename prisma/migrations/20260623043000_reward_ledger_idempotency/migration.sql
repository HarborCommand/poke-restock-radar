-- Add idempotency keys for reward ledger entries.
-- This is additive and does not modify checkout totals, payment state, refunds, inventory, or existing points.

ALTER TABLE "RewardLedgerEntry" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key" ON "RewardLedgerEntry"("idempotencyKey");
