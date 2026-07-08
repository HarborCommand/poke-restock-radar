ALTER TABLE "InventorySale" ADD COLUMN "customerAccountId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerEmail" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerMatchMethod" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "rewardsEligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "InventorySale" ADD CONSTRAINT "InventorySale_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "InventorySale_customerAccountId_idx" ON "InventorySale"("customerAccountId");
CREATE INDEX IF NOT EXISTS "InventorySale_customerEmail_idx" ON "InventorySale"("customerEmail");
CREATE INDEX IF NOT EXISTS "InventorySale_customerPhone_idx" ON "InventorySale"("customerPhone");
CREATE INDEX IF NOT EXISTS "InventorySale_customerMatchMethod_idx" ON "InventorySale"("customerMatchMethod");
CREATE INDEX IF NOT EXISTS "InventorySale_rewardsEligible_idx" ON "InventorySale"("rewardsEligible");
