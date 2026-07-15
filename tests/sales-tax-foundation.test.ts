import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  allocateCentsByWeight,
  calculateConfiguredPosTax,
  cumulativeRefundedTaxCents,
  floridaRoundTaxCents,
  normalizeStripeTaxCode,
  safeTaxBreakdownJson,
  taxFeatureConfig,
  type PosTaxProfile
} from "../src/lib/tax";

const floridaProfile: PosTaxProfile = {
  country: "US", state: "FL", county: "Miami-Dade", stateRateBasisPoints: 600,
  countyRateBasisPoints: 50, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), sourceNote: "Owner-approved test snapshot", enabled: true
};

test("all tax flags are disabled by default and require explicit true", () => {
  assert.deepEqual(taxFeatureConfig({}), {
    onlineStripeTaxEnabled: false, posSalesTaxEnabled: false, taxExemptSalesEnabled: false, taxReportingEnabled: false
  });
  assert.deepEqual(taxFeatureConfig({ ONLINE_STRIPE_TAX_ENABLED: "TRUE", POS_SALES_TAX_ENABLED: "true", TAX_EXEMPT_SALES_ENABLED: "1", TAX_REPORTING_ENABLED: "false" }), {
    onlineStripeTaxEnabled: true, posSalesTaxEnabled: true, taxExemptSalesEnabled: false, taxReportingEnabled: false
  });
});

test("Florida rounding carries the third decimal and rounds half up", () => {
  assert.equal(floridaRoundTaxCents(8, 600), 0);
  assert.equal(floridaRoundTaxCents(9, 600), 1);
  assert.equal(floridaRoundTaxCents(10_000, 600), 600);
});

test("configured POS tax reconciles state and county exactly", () => {
  const result = calculateConfiguredPosTax({ subtotalCents: 10_000, profile: floridaProfile });
  assert.deepEqual(result, {
    subtotalCents: 10_000, discountCents: 0, taxableSubtotalCents: 10_000,
    stateTaxCents: 600, countySurtaxCents: 50, taxCents: 650, totalCents: 10_650, combinedRateBasisPoints: 650
  });
  assert.equal(result.stateTaxCents + result.countySurtaxCents, result.taxCents);
});

test("discounts reduce taxable merchandise before tax", () => {
  const result = calculateConfiguredPosTax({ subtotalCents: 10_000, discountCents: 1_000, profile: { ...floridaProfile, countyRateBasisPoints: 0 } });
  assert.equal(result.taxableSubtotalCents, 9_000);
  assert.equal(result.taxCents, 540);
  assert.equal(result.totalCents, 9_540);
});

test("zero and exempt sales collect zero tax", () => {
  assert.equal(calculateConfiguredPosTax({ subtotalCents: 0, profile: floridaProfile }).taxCents, 0);
  const exempt = calculateConfiguredPosTax({ subtotalCents: 12_345, discountCents: 45, profile: floridaProfile, exempt: true });
  assert.equal(exempt.taxableSubtotalCents, 12_300);
  assert.equal(exempt.taxCents, 0);
  assert.equal(exempt.totalCents, 12_300);
});

test("largest-remainder allocation is exact and deterministic", () => {
  assert.deepEqual(allocateCentsByWeight(2, [1, 1, 1]), [1, 1, 0]);
  const allocation = allocateCentsByWeight(650, [2_500, 7_500]);
  assert.deepEqual(allocation, [163, 487]);
  assert.equal(allocation.reduce((sum, cents) => sum + cents, 0), 650);
});

test("refund tax allocation is cumulative, bounded, and exact at full refund", () => {
  assert.equal(cumulativeRefundedTaxCents({ originalTotalCents: 10_600, originalTaxCents: 600, cumulativeRefundedAmountCents: 2_650 }), 150);
  assert.equal(cumulativeRefundedTaxCents({ originalTotalCents: 10_600, originalTaxCents: 600, cumulativeRefundedAmountCents: 5_300 }), 300);
  assert.equal(cumulativeRefundedTaxCents({ originalTotalCents: 10_600, originalTaxCents: 600, cumulativeRefundedAmountCents: 99_999 }), 600);
});

test("unknown historical refund tax remains unknown", () => {
  assert.equal(cumulativeRefundedTaxCents({ originalTotalCents: null, originalTaxCents: null, cumulativeRefundedAmountCents: 500 }), null);
});

test("Stripe tax codes are allowlisted", () => {
  assert.equal(normalizeStripeTaxCode(undefined, {}), "txcd_99999999");
  assert.equal(normalizeStripeTaxCode("txcd_12345678", {}), null);
  assert.equal(normalizeStripeTaxCode("txcd_12345678", { STRIPE_ALLOWED_PRODUCT_TAX_CODES: "txcd_12345678" }), "txcd_12345678");
});

test("provider breakdown sanitizer excludes arbitrary and customer fields", () => {
  const value = safeTaxBreakdownJson({ country: "us", state: "FL", amountCents: 650, customerEmail: "private@example.com", arbitrary: "secret" });
  assert.equal(value?.includes("private@example.com"), false);
  assert.equal(value?.includes("arbitrary"), false);
  assert.match(value ?? "", /"amountCents":650/);
});

test("migration is additive and preserves historical unknowns as nullable", () => {
  const migration = fs.readFileSync("prisma/migrations/20260713010000_sales_tax_foundation/migration.sql", "utf8");
  assert.match(migration, /ADD COLUMN "taxCents" INTEGER/);
  assert.doesNotMatch(migration, /ADD COLUMN "taxCents" INTEGER NOT NULL/);
  assert.match(migration, /CREATE TABLE "TaxAdjustment"/);
  assert.match(migration, /"idempotencyKey" TEXT NOT NULL/);
});

test("Stripe Checkout tax path is guarded and persists authoritative provider cents", () => {
  const source = fs.readFileSync("src/lib/storefront.ts", "utf8");
  assert.match(source, /ONLINE_STRIPE_TAX_ENABLED|onlineStripeTaxEnabled/);
  assert.match(source, /automatic_tax: \{ enabled: true \}/);
  assert.match(source, /onlineTaxEnabled \? \{ billing_address_collection: "required" as const \} : \{\}/);
  assert.match(source, /total_details\?\.amount_tax/);
  assert.match(source, /const taxCents = automaticTaxEnabled/);
  assert.match(source, /taxSnapshot\.taxCents === null \? order\.tax/);
  assert.match(source, /stripe\.checkout\.sessions\.retrieve/);
  assert.match(source, /const stripeTaxCodeByInventoryId = onlineTaxEnabled/);
  assert.match(source, /tax_code: stripeTaxCodeByInventoryId\?\.get/);
  assert.match(source, /Tax-enabled Local Pickup requires an approved store-location tax policy/);
});

test("POS tax, exemptions, partial refunds, and adjustment audit are server authoritative", () => {
  const source = fs.readFileSync("src/lib/radar-service.ts", "utf8");
  assert.match(source, /calculateConfiguredPosTax/);
  assert.match(source, /taxExemptSalesEnabled/);
  assert.match(source, /partialRefundAmount/);
  assert.match(source, /allocateCentsByWeight\(requestedRefundCents/);
  assert.match(source, /tax:pos-refund:/);
  assert.match(source, /cumulativeEligibleRefundCents/);
  assert.match(source, /sale\.taxStatus === "not_recorded" \? null : line\.taxCents/);
});

test("tax reporting is feature-gated, read-only, authenticated, no-store, and user-scoped", () => {
  const route = fs.readFileSync("src/app/api/radar/tax-report/route.ts", "utf8");
  const service = fs.readFileSync("src/lib/tax-reporting.ts", "utf8");
  assert.match(route, /requireUser/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /taxReportingEnabled/);
  assert.match(route, /privateNoStoreHeaders/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.match(service, /userId: currentUser\.id/);
  assert.match(service, /Math\.min\(200/);
  assert.doesNotMatch(service, /customerEmail|customerName|customerPhone/);
});

test("receipts and accounting separate tax while rewards remain merchandise-only", () => {
  const email = fs.readFileSync("src/lib/storefront-email-templates.ts", "utf8");
  const storefront = fs.readFileSync("src/lib/storefront.ts", "utf8");
  const rewards = fs.readFileSync("src/lib/customer-rewards.ts", "utf8");
  assert.match(email, /summaryRow\("Sales tax"/);
  assert.match(storefront, /refundedTaxDeltaCents/);
  assert.match(storefront, /storefrontOrderNetRevenue/);
  assert.match(rewards, /eligibleSubtotalCents/);
  assert.match(rewards, /taxCentsExcluded/);
});

test("production-facing env template keeps every tax feature off", () => {
  const env = fs.readFileSync(".env.example", "utf8");
  for (const name of ["ONLINE_STRIPE_TAX_ENABLED", "POS_SALES_TAX_ENABLED", "TAX_EXEMPT_SALES_ENABLED", "TAX_REPORTING_ENABLED"]) {
    assert.match(env, new RegExp(`${name}="false"`));
  }
});

test("foundation UI keeps tax configuration dormant until the settings workspace phase", () => {
  const dashboard = fs.readFileSync("src/components/RadarApp.tsx", "utf8");
  assert.doesNotMatch(dashboard, /<strong>Sales tax foundation<\/strong>/);
  assert.doesNotMatch(dashboard, /name="posTaxEnabled"/);
  assert.doesNotMatch(dashboard, /href="\/api\/radar\/tax-report\?format=csv"/);
});
