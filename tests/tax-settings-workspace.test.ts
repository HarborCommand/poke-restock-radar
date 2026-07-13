import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { taxAdminSettingsSchema } from "../src/lib/validation";

const valid = {
  storeCountry: "US",
  storeState: "FL",
  storeCounty: "Test County",
  stateRateBasisPoints: 600,
  countyRateBasisPoints: 100,
  effectiveDate: "2026-07-01",
  sourceNote: "Preview fixture only",
  posTaxEnabled: false,
  taxExemptSalesEnabled: false,
  exemptionReferenceRequired: true,
  exemptionReasonRequired: true,
  defaultTaxCategory: "general_tangible_goods",
  defaultStripeTaxCode: "txcd_99999999",
  defaultReportingPeriod: "monthly",
  registrationConfirmed: false,
  storeAddressConfirmed: false,
  countyConfirmed: false,
  defaultCodeConfirmed: false,
  previewOnlinePassed: false,
  previewPickupPassed: false,
  previewPosPassed: false,
  receiptVerified: false,
  refundVerified: false,
  reportReconciled: false,
  ownerApproved: false
} as const;

test("tax admin schema accepts the allowlisted profile", () => {
  assert.equal(taxAdminSettingsSchema.safeParse(valid).success, true);
});

test("negative, excessive, and combined excessive rates are rejected", () => {
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, stateRateBasisPoints: -1 }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, countyRateBasisPoints: 2001 }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, stateRateBasisPoints: 1100, countyRateBasisPoints: 1000 }).success, false);
});

test("unknown fields and unapproved tax codes are rejected", () => {
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, secretKey: "do-not-return" }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, defaultStripeTaxCode: "txcd_12345678" }).success, false);
});

test("exemption reason and reference invariants cannot be disabled", () => {
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, exemptionReasonRequired: false }).success, false);
  assert.equal(taxAdminSettingsSchema.safeParse({ ...valid, exemptionReferenceRequired: false }).success, false);
});

test("tax settings route is admin-only, same-origin protected, private, and GET-only for reads", () => {
  const route = fs.readFileSync("src/app/api/radar/tax-settings/route.ts", "utf8");
  const getSlice = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  assert.match(route, /requireUser/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /authorizeAdminMutation/);
  assert.match(route, /taxAdminSettingsSchema\.parse/);
  assert.match(route, /privateOk/);
  assert.match(route, /withRequestId/);
  assert.doesNotMatch(getSlice, /create|update|upsert|delete|saveTaxAdminSettings/);
});

test("saved tax settings are account-scoped, audited, and explicitly confirmed before enablement", () => {
  const source = fs.readFileSync("src/lib/tax-admin.ts", "utf8");
  assert.match(source, /findUnique\(\{ where: \{ userId \} \}\)/);
  assert.match(source, /where: \{ userId: user\.id \}/);
  assert.match(source, /enableTaxCollectionConfirmed !== true/);
  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /tax\.settings\.updated/);
  assert.match(source, /actorEmail: user\.email/);
});

test("tax settings response exposes status only and never returns provider secrets", () => {
  const source = fs.readFileSync("src/lib/tax-admin.ts", "utf8");
  const responseSlice = source.slice(source.indexOf("return {", source.indexOf("export async function getTaxAdminSettings")), source.indexOf("export async function saveTaxAdminSettings"));
  assert.match(responseSlice, /stripeMode/);
  assert.match(responseSlice, /documentStorageAvailable/);
  assert.doesNotMatch(responseSlice, /secretKey:|webhookSecret:|publishableKey:|databaseUrl:|password:|token:/i);
});

test("general storefront settings can no longer mutate tax policy", () => {
  const route = fs.readFileSync("src/app/api/radar/storefront/settings/route.ts", "utf8");
  const schema = fs.readFileSync("src/lib/validation.ts", "utf8");
  const storefrontSlice = schema.slice(schema.indexOf("export const storefrontSettingsSchema"), schema.indexOf("export const taxAdminSettingsSchema"));
  assert.doesNotMatch(route, /stateTaxRateBasisPoints: input|posTaxEnabled: input|defaultStripeTaxCode: input/);
  assert.doesNotMatch(storefrontSlice, /stateTaxRateBasisPoints|posTaxEnabled|defaultStripeTaxCode/);
  assert.match(storefrontSlice, /\.strict\(\)/);
});

test("workspace supplies explicit save, warnings, responsive checklist, and unsaved-change protection", () => {
  const component = fs.readFileSync("src/components/TaxSettingsWorkspace.tsx", "utf8");
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(component, /beforeunload/);
  assert.match(component, /Save tax settings/);
  assert.match(component, /Live-mode Stripe credentials are present in Preview/);
  assert.match(component, /Go-Live Readiness/);
  assert.match(component, /enableTaxCollectionConfirmed/);
  assert.match(css, /\.tax-workspace/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("migration is additive and readiness defaults are safe", () => {
  const migration = fs.readFileSync("prisma/migrations/20260713023000_tax_settings_workspace/migration.sql", "utf8");
  assert.match(migration, /taxRegistrationConfirmed.*DEFAULT false/);
  assert.match(migration, /taxOwnerApprovedAt.*TIMESTAMP/);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE/i);
});

test("tax workspace does not alter rewards redemption", () => {
  for (const file of [
    "src/lib/tax-admin.ts",
    "src/app/api/radar/tax-settings/route.ts",
    "src/components/TaxSettingsWorkspace.tsx",
    "prisma/migrations/20260713023000_tax_settings_workspace/migration.sql"
  ]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /redemption|redeem/i);
  }
});
