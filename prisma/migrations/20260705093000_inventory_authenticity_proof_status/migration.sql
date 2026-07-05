-- Track private admin-only authenticity evidence review status per inventory item.
-- These fields store status and notes only. Receipt, invoice, and product photo files remain private and are not stored here.

ALTER TABLE "InventoryItem" ADD COLUMN "authenticityProofStatus" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "authenticityReceiptStatus" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "authenticityPhotoStatus" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "authenticityUpcVerified" BOOLEAN;
ALTER TABLE "InventoryItem" ADD COLUMN "authenticityNotes" TEXT;
