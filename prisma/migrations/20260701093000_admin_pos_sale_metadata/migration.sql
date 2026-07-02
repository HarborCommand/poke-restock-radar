ALTER TABLE "InventorySale" ADD COLUMN "saleReference" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "paymentReference" TEXT;

CREATE INDEX "InventorySale_saleReference_idx" ON "InventorySale"("saleReference");
CREATE INDEX "InventorySale_paymentMethod_idx" ON "InventorySale"("paymentMethod");
