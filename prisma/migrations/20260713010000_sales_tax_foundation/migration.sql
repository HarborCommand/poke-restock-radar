-- Additive sales-tax foundation. Historical rows intentionally remain NULL/not recorded.
ALTER TABLE "InventoryItem" ADD COLUMN "taxCategory" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "stripeTaxCode" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "taxableOverride" BOOLEAN;

ALTER TABLE "StorefrontSettings" ADD COLUMN "storeCountry" TEXT NOT NULL DEFAULT 'US';
ALTER TABLE "StorefrontSettings" ADD COLUMN "storeState" TEXT NOT NULL DEFAULT 'FL';
ALTER TABLE "StorefrontSettings" ADD COLUMN "storeCounty" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "stateTaxRateBasisPoints" INTEGER NOT NULL DEFAULT 600;
ALTER TABLE "StorefrontSettings" ADD COLUMN "countyTaxRateBasisPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StorefrontSettings" ADD COLUMN "taxProfileEffectiveAt" TIMESTAMP(3);
ALTER TABLE "StorefrontSettings" ADD COLUMN "taxProfileSourceNote" TEXT;
ALTER TABLE "StorefrontSettings" ADD COLUMN "posTaxEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontSettings" ADD COLUMN "taxExemptSalesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontSettings" ADD COLUMN "defaultTaxCategory" TEXT NOT NULL DEFAULT 'general_tangible_goods';
ALTER TABLE "StorefrontSettings" ADD COLUMN "defaultStripeTaxCode" TEXT NOT NULL DEFAULT 'txcd_99999999';

ALTER TABLE "StorefrontOrder" ADD COLUMN "subtotalCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "discountCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxableSubtotalCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "totalCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxProvider" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxCalculationId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxJurisdictionCountry" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxJurisdictionState" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxJurisdictionCounty" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxRateBasisPoints" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxInclusive" BOOLEAN;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxStatus" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxExemptReason" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxCalculatedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxBreakdownJson" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "refundedTaxCents" INTEGER;

ALTER TABLE "InventorySale" ADD COLUMN "subtotalCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "discountCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "taxableSubtotalCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "taxCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "totalCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "taxProvider" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "stateTaxCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "countySurtaxCents" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "combinedRateBasisPoints" INTEGER;
ALTER TABLE "InventorySale" ADD COLUMN "taxJurisdictionCountry" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxJurisdictionState" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxJurisdictionCounty" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxStatus" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxExempt" BOOLEAN;
ALTER TABLE "InventorySale" ADD COLUMN "taxExemptReason" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxExemptionReference" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxCalculatedAt" TIMESTAMP(3);
ALTER TABLE "InventorySale" ADD COLUMN "taxRateSnapshot" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "refundedTaxCents" INTEGER;

CREATE TABLE "TaxAdjustment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "adjustmentType" TEXT NOT NULL,
  "storefrontOrderId" TEXT,
  "inventorySaleId" TEXT,
  "saleReference" TEXT,
  "providerReference" TEXT,
  "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "refundedTaxCents" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "createdByUserId" TEXT,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxAdjustment_storefrontOrderId_fkey" FOREIGN KEY ("storefrontOrderId") REFERENCES "StorefrontOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaxAdjustment_inventorySaleId_fkey" FOREIGN KEY ("inventorySaleId") REFERENCES "InventorySale"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaxAdjustment_idempotencyKey_key" ON "TaxAdjustment"("idempotencyKey");
CREATE INDEX "TaxAdjustment_storefrontOrderId_idx" ON "TaxAdjustment"("storefrontOrderId");
CREATE INDEX "TaxAdjustment_inventorySaleId_idx" ON "TaxAdjustment"("inventorySaleId");
CREATE INDEX "TaxAdjustment_saleReference_idx" ON "TaxAdjustment"("saleReference");
CREATE INDEX "TaxAdjustment_channel_createdAt_idx" ON "TaxAdjustment"("channel", "createdAt");
CREATE INDEX "StorefrontOrder_taxStatus_idx" ON "StorefrontOrder"("taxStatus");
CREATE INDEX "StorefrontOrder_taxJurisdictionState_taxJurisdictionCounty_idx" ON "StorefrontOrder"("taxJurisdictionState", "taxJurisdictionCounty");
CREATE INDEX "InventorySale_taxStatus_idx" ON "InventorySale"("taxStatus");
CREATE INDEX "InventorySale_taxJurisdictionState_taxJurisdictionCounty_idx" ON "InventorySale"("taxJurisdictionState", "taxJurisdictionCounty");
