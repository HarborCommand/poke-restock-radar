-- Additive smart-shipping metadata for storefront listings and order snapshots.
ALTER TABLE "InventoryItem" ADD COLUMN "packageWeightOz" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "packageLengthIn" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "packageWidthIn" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "packageHeightIn" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "freeShippingEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryItem" ADD COLUMN "requiresBox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryItem" ADD COLUMN "insuranceRecommended" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingMethodLabel" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingRateSource" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPackageWeightOz" DOUBLE PRECISION;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPackageProfile" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingWarnings" TEXT;
