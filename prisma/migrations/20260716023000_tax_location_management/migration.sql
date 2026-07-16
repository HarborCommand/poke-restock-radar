CREATE TABLE "TaxLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "county" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultForPos" BOOLEAN NOT NULL DEFAULT false,
    "defaultForLocalPickup" BOOLEAN NOT NULL DEFAULT false,
    "defaultShipFrom" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxLocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "InventorySale" ADD COLUMN "taxLocationId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxLocationNameSnapshot" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "taxLocationSnapshotJson" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxLocationId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxLocationNameSnapshot" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "taxLocationSnapshotJson" TEXT;

CREATE INDEX "TaxLocation_userId_active_idx" ON "TaxLocation"("userId", "active");
CREATE INDEX "TaxLocation_userId_defaultForPos_idx" ON "TaxLocation"("userId", "defaultForPos");
CREATE INDEX "TaxLocation_userId_defaultForLocalPickup_idx" ON "TaxLocation"("userId", "defaultForLocalPickup");
CREATE INDEX "TaxLocation_userId_defaultShipFrom_idx" ON "TaxLocation"("userId", "defaultShipFrom");
CREATE INDEX "InventorySale_taxLocationId_idx" ON "InventorySale"("taxLocationId");
CREATE INDEX "StorefrontOrder_taxLocationId_idx" ON "StorefrontOrder"("taxLocationId");
