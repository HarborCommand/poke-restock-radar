-- Add database-backed admin shipping profiles.
-- Existing product shippingProfile keys remain strings and existing orders keep their shipping snapshots.

CREATE TABLE IF NOT EXISTS "ShippingProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "packageType" TEXT NOT NULL,
  "defaultWeightOz" REAL NOT NULL,
  "packageLengthIn" REAL,
  "packageWidthIn" REAL,
  "packageHeightIn" REAL,
  "defaultShippingCharge" REAL,
  "localPickupEligibleDefault" BOOLEAN NOT NULL DEFAULT false,
  "freeShippingEligibleDefault" BOOLEAN NOT NULL DEFAULT false,
  "requiresBoxDefault" BOOLEAN NOT NULL DEFAULT false,
  "insuranceRecommendedDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "systemDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShippingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingProfile_key_key" ON "ShippingProfile"("key");
CREATE INDEX IF NOT EXISTS "ShippingProfile_userId_idx" ON "ShippingProfile"("userId");
CREATE INDEX IF NOT EXISTS "ShippingProfile_active_idx" ON "ShippingProfile"("active");
CREATE INDEX IF NOT EXISTS "ShippingProfile_systemDefault_idx" ON "ShippingProfile"("systemDefault");
