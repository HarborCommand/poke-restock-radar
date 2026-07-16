ALTER TABLE "StorefrontSettings"
  ADD COLUMN "legacyManualTaxFallbackIncidentReason" TEXT,
  ADD COLUMN "legacyManualTaxFallbackAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "legacyManualTaxFallbackExpiresAt" TIMESTAMP(3);
