import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { taxFeatureConfig } from "../src/lib/tax";
import { taxAdminSettingsSchema } from "../src/lib/validation";

const validFallback = {
  storeCountry: "US", storeState: "FL", storeCounty: "Orange", storeAddressLine1: "100 Test Way", storeAddressLine2: "", storeCity: "Orlando", storePostalCode: "32801",
  stateRateBasisPoints: 600, countyRateBasisPoints: 50, effectiveDate: "2026-07-16", sourceNote: "Approved incident rate source",
  onlineTaxProfileEnabled: false, posTaxEnabled: false, taxExemptSalesEnabled: false, taxReportingProfileEnabled: false,
  localPickupTaxTreatment: "pending_review", exemptionReferenceRequired: true, exemptionReasonRequired: true,
  defaultTaxCategory: "general_tangible_goods", defaultStripeTaxCode: "txcd_99999999", shippingStripeTaxCode: "txcd_92010001",
  legacyManualTaxFallbackEnabled: true, legacyManualTaxFallbackConfirmed: true,
  legacyManualTaxFallbackIncidentReason: "Stripe Tax is unavailable during a documented incident",
  legacyManualTaxFallbackStripeUnavailableAcknowledged: true,
  legacyManualTaxFallbackExpiresAt: "2026-07-16T18:00:00.000Z",
  defaultReportingPeriod: "monthly", registrationConfirmed: false, storeAddressConfirmed: false, countyConfirmed: false, defaultCodeConfirmed: false,
  previewOnlinePassed: false, previewPickupPassed: false, previewPosPassed: false, receiptVerified: false, refundVerified: false, reportReconciled: false, ownerApproved: false
} as const;

test("manual fallback is false by default and conflicts with POS Stripe Tax", () => {
  assert.equal(taxFeatureConfig({}).manualTaxFallbackEnabled, false);
  assert.equal(taxFeatureConfig({ MANUAL_TAX_FALLBACK_ENABLED: "true" }).posTaxModeConflict, false);
  assert.equal(taxFeatureConfig({ MANUAL_TAX_FALLBACK_ENABLED: "true", POS_STRIPE_TAX_ENABLED: "true" }).posTaxModeConflict, true);
});

test("manual fallback input requires incident evidence and cannot coexist with the saved Stripe profile", () => {
  assert.equal(taxAdminSettingsSchema.safeParse(validFallback).success, true);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...validFallback, legacyManualTaxFallbackIncidentReason: "short" }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...validFallback, legacyManualTaxFallbackStripeUnavailableAcknowledged: false }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...validFallback, legacyManualTaxFallbackExpiresAt: null }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...validFallback, posTaxEnabled: true }).success, false);
});

test("cashiers and browsers cannot select fallback, while historical snapshots remain supported", () => {
  const service = fs.readFileSync("src/lib/radar-service.ts", "utf8");
  const validation = fs.readFileSync("src/lib/validation.ts", "utf8");
  const settings = fs.readFileSync("src/lib/tax-admin.ts", "utf8");
  const workspace = fs.readFileSync("src/components/TaxSettingsWorkspace.tsx", "utf8");
  const reporting = fs.readFileSync("src/lib/tax-reporting.ts", "utf8");
  const refund = service.slice(service.indexOf("export async function refundPosSale"));
  assert.doesNotMatch(validation.slice(validation.indexOf("export const posSaleSchema"), validation.indexOf("export const posRefundSchema")), /fallback|manualTax/i);
  assert.match(settings, /tax\.manual_fallback\.activated/);
  assert.match(settings, /24 \* 60 \* 60 \* 1000/);
  assert.match(service, /legacyManualFallbackActive/);
  assert.match(service, /configured_pos_rate/);
  assert.match(workspace, /Legacy emergency fallback — not used for normal sales/);
  assert.match(workspace, /Cashiers cannot choose this mode/);
  assert.match(reporting, /historical_legacy_manual/);
  assert.doesNotMatch(refund, /stateTaxRateBasisPoints|countyTaxRateBasisPoints|calculateConfiguredPosTax/);
});

test("migration is additive and keeps the historical enabled flag disabled by default", () => {
  const migration = fs.readFileSync("prisma/migrations/20260716053000_deprecate_manual_tax_fallback/migration.sql", "utf8");
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /legacyManualTaxFallbackEnabled Boolean\s+@default\(false\)/);
  assert.match(migration, /IncidentReason/);
  assert.match(migration, /AcknowledgedAt/);
  assert.match(migration, /ExpiresAt/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|UPDATE)\b/i);
});
