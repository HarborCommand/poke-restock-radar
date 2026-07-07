ALTER TABLE "InventorySale" ADD COLUMN "originalUnitPrice" DOUBLE PRECISION;
ALTER TABLE "InventorySale" ADD COLUMN "adjustedUnitPrice" DOUBLE PRECISION;
ALTER TABLE "InventorySale" ADD COLUMN "discountAmount" DOUBLE PRECISION;
ALTER TABLE "InventorySale" ADD COLUMN "discountReason" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "discountNote" TEXT;
