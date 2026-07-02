ALTER TABLE "InventorySale" ADD COLUMN "stripePaymentIntentId" TEXT;

CREATE INDEX "InventorySale_stripePaymentIntentId_idx" ON "InventorySale"("stripePaymentIntentId");
