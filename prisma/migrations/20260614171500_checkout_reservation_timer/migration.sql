-- Additive checkout reservation metadata for the 15-minute GameDayGrabs hold timer.
ALTER TABLE "StockReservation" ADD COLUMN "stripeCheckoutSessionId" TEXT;

CREATE INDEX "StockReservation_stripeCheckoutSessionId_idx" ON "StockReservation"("stripeCheckoutSessionId");
