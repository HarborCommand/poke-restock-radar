import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { evaluateTaxGoLivePreflight, type TaxGoLivePreflightInput } from "../src/lib/tax-go-live";

const ready: TaxGoLivePreflightInput = {
  stripeMode: "live", registrationActive: true, verifiedPos: true, verifiedPickup: true, productCodeReady: true, shippingCodeReady: true,
  webhookConfigured: true, certificationComplete: true, certificationPassed: 20, certificationRequired: 20, reconciliationClean: true,
  ownerApproved: true, accountantReviewed: true, onlineFlag: false, posFlag: false
};

test("incomplete readiness reports every required blocker", () => {
  const result = evaluateTaxGoLivePreflight({ ...ready, stripeMode: "missing", registrationActive: false, verifiedPos: false, verifiedPickup: false, productCodeReady: false, shippingCodeReady: false, webhookConfigured: false, certificationComplete: false, certificationPassed: 0, reconciliationClean: false, ownerApproved: false, accountantReviewed: false });
  assert.equal(result.status, "blocked");
  for (const code of ["live_stripe_key_missing", "florida_registration_missing", "pos_location_missing", "pickup_location_missing", "product_tax_code_missing", "shipping_tax_code_missing", "webhook_missing", "certification_incomplete", "reconciliation_not_clean", "owner_approval_missing", "accountant_review_missing"]) assert.ok(result.blockers.some((item) => item.code === code));
});

test("ready preflight distinguishes flags off from live gates", () => {
  assert.deepEqual(evaluateTaxGoLivePreflight(ready), { blockers: [], status: "ready_flags_off" });
  assert.equal(evaluateTaxGoLivePreflight({ ...ready, onlineFlag: true }).status, "live");
});

test("test mode and missing registration always block live treatment", () => {
  const testMode = evaluateTaxGoLivePreflight({ ...ready, stripeMode: "test" });
  assert.equal(testMode.status, "blocked");
  assert.ok(testMode.blockers.some((item) => item.code === "stripe_test_mode"));
  const registrationMissing = evaluateTaxGoLivePreflight({ ...ready, onlineFlag: true, posFlag: true, registrationActive: false });
  assert.equal(registrationMissing.status, "blocked");
  assert.ok(registrationMissing.blockers.some((item) => item.code === "florida_registration_missing"));
});

test("preflight GET is private and read-only, while approvals cannot mutate runtime flags", () => {
  const route = fs.readFileSync("src/app/api/radar/tax-go-live/route.ts", "utf8");
  const service = fs.readFileSync("src/lib/tax-go-live.ts", "utf8");
  const getSlice = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  const preflightSlice = service.slice(service.indexOf("export async function getTaxGoLiveSwitchboard"), service.indexOf("export async function saveTaxGoLiveApprovals"));
  const approvalSlice = service.slice(service.indexOf("export async function saveTaxGoLiveApprovals"));
  assert.match(route, /requireAdmin/); assert.match(route, /authorizeAdminMutation/); assert.match(route, /withPrivateNoStore/);
  assert.doesNotMatch(getSlice, /saveTaxGoLiveApprovals|\.create\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(preflightSlice, /\.create\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(approvalSlice, /tax\.go_live\.approvals_updated/);
  assert.doesNotMatch(approvalSlice, /process\.env\[[^\]]+\]\s*=|ONLINE_STRIPE_TAX_ENABLED\s*=|POS_STRIPE_TAX_ENABLED\s*=/);
});

test("switchboard displays safe status and exact rollback guidance without secrets or environment mutation controls", () => {
  const component = fs.readFileSync("src/components/TaxGoLiveSwitchboard.tsx", "utf8");
  const service = fs.readFileSync("src/lib/tax-go-live.ts", "utf8");
  for (const text of ["Online gate", "POS gate", "Reporting gate", "Exemption gate", "Build commit", "Last health check", "Unresolved blockers", "Emergency kill switch", "Save approvals only"]) assert.match(component, new RegExp(text));
  assert.match(component, /cannot change Vercel environment variables/);
  assert.match(service, /Set ONLINE_STRIPE_TAX_ENABLED=false and POS_STRIPE_TAX_ENABLED=false/);
  assert.match(service, /Preserve every completed tax snapshot/);
  assert.doesNotMatch(component, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|DATABASE_URL|password|token:/i);
});

test("switchboard migration is additive", () => {
  const migration = fs.readFileSync("prisma/migrations/20260716063000_tax_go_live_switchboard/migration.sql", "utf8");
  assert.match(migration, /taxAccountantReviewedAt/); assert.match(migration, /taxAccountantReviewNote/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|UPDATE)\b/i);
});
