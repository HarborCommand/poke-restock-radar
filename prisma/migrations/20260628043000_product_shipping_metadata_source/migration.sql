-- Track whether product-level package data is measured, estimated, or fallback-only.
-- Nullable so existing catalog items remain compatible until the owner reviews each SKU.

ALTER TABLE "InventoryItem" ADD COLUMN "shippingMetadataSource" TEXT;
