-- Add reporting-only test/smoke order markers. This migration is additive and
-- does not modify order status, payments, refunds, shipping, or inventory.
ALTER TABLE "StorefrontOrder" ADD COLUMN "isTestOrder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontOrder" ADD COLUMN "testOrderReason" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "testMarkedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "testMarkedBy" TEXT;

CREATE INDEX "StorefrontOrder_isTestOrder_idx" ON "StorefrontOrder"("isTestOrder");
