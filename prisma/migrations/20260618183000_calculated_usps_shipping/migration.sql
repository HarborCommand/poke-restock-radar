-- Add calculated USPS shipping quote snapshots.
-- Existing products, orders, reservations, refunds, and inventory quantities are untouched.

ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPackageLengthIn" REAL;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPackageWidthIn" REAL;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingPackageHeightIn" REAL;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteProvider" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingCarrier" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingService" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuotedAmountCents" INTEGER;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuotedZip" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteFallbackUsed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteRateProviderRef" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteShipmentProviderRef" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingQuoteExpiresAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "shippingZipMismatchReview" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ShippingQuote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteToken" TEXT NOT NULL,
  "userId" TEXT,
  "orderId" TEXT,
  "provider" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "destinationZip" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'US',
  "packageWeightOz" REAL,
  "packageLengthIn" REAL,
  "packageWidthIn" REAL,
  "packageHeightIn" REAL,
  "packageProfileKey" TEXT,
  "rateProviderRef" TEXT,
  "shipmentProviderRef" TEXT,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "warning" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  "cartHash" TEXT,
  CONSTRAINT "ShippingQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ShippingQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingQuote_quoteToken_key" ON "ShippingQuote"("quoteToken");
CREATE INDEX IF NOT EXISTS "ShippingQuote_userId_idx" ON "ShippingQuote"("userId");
CREATE INDEX IF NOT EXISTS "ShippingQuote_orderId_idx" ON "ShippingQuote"("orderId");
CREATE INDEX IF NOT EXISTS "ShippingQuote_expiresAt_idx" ON "ShippingQuote"("expiresAt");
CREATE INDEX IF NOT EXISTS "ShippingQuote_destinationZip_idx" ON "ShippingQuote"("destinationZip");
CREATE INDEX IF NOT EXISTS "ShippingQuote_cartHash_idx" ON "ShippingQuote"("cartHash");

