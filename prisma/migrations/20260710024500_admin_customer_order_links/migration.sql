-- Add admin-only customer/order link metadata. All fields are nullable so
-- existing storefront orders, POS sales, customer accounts, and rewards remain valid.

ALTER TABLE "StorefrontOrder" ADD COLUMN "customerLinkSource" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerLinkedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerLinkedByUserId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerLinkReason" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerLinkNote" TEXT;

ALTER TABLE "InventorySale" ADD COLUMN "customerLinkSource" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerLinkedAt" TIMESTAMP(3);
ALTER TABLE "InventorySale" ADD COLUMN "customerLinkedByUserId" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerLinkReason" TEXT;
ALTER TABLE "InventorySale" ADD COLUMN "customerLinkNote" TEXT;

CREATE INDEX "StorefrontOrder_customerLinkSource_idx" ON "StorefrontOrder"("customerLinkSource");
CREATE INDEX "StorefrontOrder_customerLinkedByUserId_idx" ON "StorefrontOrder"("customerLinkedByUserId");
CREATE INDEX "InventorySale_customerLinkSource_idx" ON "InventorySale"("customerLinkSource");
CREATE INDEX "InventorySale_customerLinkedByUserId_idx" ON "InventorySale"("customerLinkedByUserId");
