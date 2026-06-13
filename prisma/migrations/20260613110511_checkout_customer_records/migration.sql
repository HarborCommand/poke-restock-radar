-- Add safe customer/order snapshots for Stripe Checkout fulfillment.
-- All Stripe-collected personal details are nullable because Checkout can omit them.
-- Aggregate defaults preserve existing StorefrontCustomer rows.

ALTER TABLE "StorefrontCustomer" ADD COLUMN "firstOrderAt" TIMESTAMP(3);
ALTER TABLE "StorefrontCustomer" ADD COLUMN "lastOrderAt" TIMESTAMP(3);
ALTER TABLE "StorefrontCustomer" ADD COLUMN "totalOrders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingName" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingLine1" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingLine2" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingCity" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingState" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingPostalCode" TEXT;
ALTER TABLE "StorefrontCustomer" ADD COLUMN "defaultShippingCountry" TEXT;

ALTER TABLE "StorefrontOrder" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingName" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLine1" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingLine2" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingCity" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingState" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPostalCode" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingCountry" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingName" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingLine1" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingLine2" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingCity" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingState" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingPostalCode" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "billingCountry" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StorefrontCustomer_email_key" ON "StorefrontCustomer"("email");
CREATE INDEX IF NOT EXISTS "StorefrontCustomer_stripeCustomerId_idx" ON "StorefrontCustomer"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "StorefrontOrder_stripeCheckoutSessionId_key" ON "StorefrontOrder"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_eventId_key" ON "PaymentEvent"("eventId");
