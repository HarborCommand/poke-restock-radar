ALTER TABLE "InventorySale" ADD COLUMN "refundStatus" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "InventorySale" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "InventorySale" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "refundNote" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "refundIdempotencyKey" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "refundRestockedQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "InventorySale_refundStatus_idx" ON "InventorySale"("refundStatus");
CREATE INDEX "InventorySale_refundIdempotencyKey_idx" ON "InventorySale"("refundIdempotencyKey");
