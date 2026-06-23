-- Add disabled Shippo label workflow snapshot fields.
-- Existing orders, quotes, payments, refunds, and inventory quantities are untouched.

ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelProvider" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelProviderId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelUrl" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelFileType" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingTrackingNumber" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingTrackingUrl" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelCostCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelCurrency" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelPurchasedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelVoidedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLabelStatus" TEXT;
