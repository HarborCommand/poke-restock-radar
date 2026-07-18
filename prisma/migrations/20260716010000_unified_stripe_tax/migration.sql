ALTER TABLE "StorefrontSettings" ADD COLUMN "storeAddressLine1" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "storeAddressLine2" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "storeCity" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "storePostalCode" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "shippingStripeTaxCode" TEXT NOT NULL DEFAULT 'txcd_92010001';

ALTER TABLE "InventorySale" ADD COLUMN "taxCalculationId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "fulfillmentMode" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "posShippingCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "posShippingTaxCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "taxTransactionId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxTransactionStatus" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxTransactionLineItemId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxabilityReason" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxBreakdownJson" TEXT;

CREATE INDEX "InventorySale_taxCalculationId_idx" ON "InventorySale"("taxCalculationId");
CREATE INDEX "InventorySale_taxTransactionId_idx" ON "InventorySale"("taxTransactionId");
CREATE INDEX "InventorySale_taxTransactionStatus_idx" ON "InventorySale"("taxTransactionStatus");
