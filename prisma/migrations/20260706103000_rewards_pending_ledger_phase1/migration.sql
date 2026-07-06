ALTER TABLE "RewardLedgerEntry" ADD COLUMN "status" TEXT;
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "availableAt" TIMESTAMP(3);
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "eligibleSubtotalCents" INTEGER;
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "source" TEXT;
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "reversalOfEntryId" TEXT;

CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_status_idx" ON "RewardLedgerEntry"("status");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_availableAt_idx" ON "RewardLedgerEntry"("availableAt");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_source_idx" ON "RewardLedgerEntry"("source");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_reversalOfEntryId_idx" ON "RewardLedgerEntry"("reversalOfEntryId");
