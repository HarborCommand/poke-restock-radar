import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("sales tax go-live runbook preserves safe defaults and complete release order", () => {
  const runbook = read("docs/sales-tax-go-live-runbook.md");
  const env = read(".env.example");
  for (const pr of ["#80", "#81", "#82", "#83", "#84", "#85", "#86"]) assert.match(runbook, new RegExp(pr));
  for (const flag of [
    "ONLINE_STRIPE_TAX_ENABLED",
    "POS_SALES_TAX_ENABLED",
    "TAX_EXEMPT_SALES_ENABLED",
    "TAX_REPORTING_ENABLED"
  ]) {
    assert.match(runbook, new RegExp(`${flag}=false`));
    assert.match(env, new RegExp(`${flag}="false"`));
  }
  assert.match(runbook, /20260713010000_sales_tax_foundation/);
  assert.match(runbook, /20260713023000_tax_settings_workspace/);
  assert.match(runbook, /Do not backfill historical tax/);
  assert.match(runbook, /Never use `prisma db push` against an existing Production database/);
});

test("runbook covers owner inputs launch rollback monitoring and filing without private identifiers", () => {
  const runbook = read("docs/sales-tax-go-live-runbook.md");
  for (const requirement of [
    "Legal business/store address",
    "Florida sales-tax registration confirmation",
    "Filing frequency",
    "Accountant or tax professional contact",
    "Stripe Tax live-mode registration/readiness",
    "Written tax-exemption policy",
    "Local Pickup",
    "Preview transaction checklist",
    "Production flag plan",
    "Rollback / disable procedure",
    "Post-launch monitoring",
    "Filing-support workflow"
  ]) assert.match(runbook, new RegExp(requirement, "i"));
  assert.match(runbook, /not legal, accounting, or filing advice/i);
  assert.match(runbook, /do not put registration or certificate numbers in source code/i);
  assert.match(runbook, /does not file a return/i);
  assert.match(runbook, /does not create a competing UI or a second source of truth/i);
});

test("runbook records the deployed state and keeps unresolved go-live work blocking", () => {
  const runbook = read("docs/sales-tax-go-live-runbook.md");
  for (const requirement of [
    "Production contains PRs #80 through #86",
    "Live tax collection is not approved",
    "valid, isolated Stripe test credential set",
    "same-county Florida delivery",
    "different-county Florida delivery",
    "Local Pickup treatment",
    "Signed webhook processing",
    "Full and partial refunds",
    "legal store address",
    "approved rate source",
    "written exemption/evidence-retention policy",
    "explicit owner approval"
  ]) assert.match(runbook, new RegExp(requirement, "i"));
  assert.match(runbook, /rewards redemption remains disabled/i);
  assert.match(runbook, /PR #22 remains parked and untouched/i);
  assert.doesNotMatch(runbook, /â€œ|â€/);
});
