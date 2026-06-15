-- Add explicit buyer-facing purchase-limit enablement.
-- Existing maxQuantityPerOrder values are preserved, but no public/order cap is enforced
-- unless purchaseLimitEnabled is true.
ALTER TABLE "InventoryItem" ADD COLUMN "purchaseLimitEnabled" BOOLEAN NOT NULL DEFAULT false;
