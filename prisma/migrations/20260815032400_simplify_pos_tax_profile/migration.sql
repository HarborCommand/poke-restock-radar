-- Keep the Florida 6% POS tax calculation while removing unused county/surtax display metadata.
UPDATE "StorefrontSettings"
SET
  "storeCounty" = NULL,
  "taxProfileSourceNote" = 'Florida sales tax: 6.00%.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "storeState" = 'FL'
  AND "posTaxEnabled" = TRUE;
