-- Enable the requested Florida statewide base POS sales-tax profile.
-- County discretionary surtax remains intentionally 0 until the store county rate is confirmed.
UPDATE "StorefrontSettings"
SET
  "storeCountry" = 'US',
  "storeState" = 'FL',
  "storeCounty" = 'Statewide base only',
  "stateTaxRateBasisPoints" = 600,
  "countyTaxRateBasisPoints" = 0,
  "taxProfileEffectiveAt" = TIMESTAMP '2026-08-15 00:00:00',
  "taxProfileSourceNote" = 'Florida statewide base sales tax: 6.00%. County discretionary surtax is set to 0.00% until the store-location county rate is confirmed.',
  "posTaxEnabled" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
