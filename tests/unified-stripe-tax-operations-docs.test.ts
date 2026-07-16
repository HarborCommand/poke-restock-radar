import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const operations = fs.readFileSync("docs/unified-stripe-tax-operations.md", "utf8");
const runbook = fs.readFileSync("docs/sales-tax-go-live-runbook.md", "utf8");
const security = fs.readFileSync("docs/tax-security-privacy-review.md", "utf8");

test("operations documentation assigns unified provider and application responsibilities", () => {
  for (const responsibility of ["online tax calculation", "POS tax calculation", "tax on shipping", "tax transaction recording", "tax reversals"]) assert.match(operations, new RegExp(responsibility, "i"));
  for (const responsibility of ["product prices", "discounts", "shipping price", "inventory", "customer accounts", "rewards", "receipts", "immutable internal tax snapshots", "reporting and reconciliation"]) assert.match(operations, new RegExp(responsibility, "i"));
});

test("cashier, refund, reporting, certification, fallback, and rollback workflows are documented", () => {
  for (const heading of ["POS cashier workflow", "Refund workflow", "Reporting and reconciliation workflow", "Stripe test certification", "Emergency manual fallback", "Emergency kill switch and rollback"]) assert.match(operations, new RegExp(`## ${heading}`));
  assert.match(operations, /current rates never re-rate history/i);
  assert.match(operations, /cannot request, select, edit, or extend/i);
  assert.match(operations, /refuses live keys, Production runtime\/base URLs/i);
  assert.match(operations, /Set `ONLINE_STRIPE_TAX_ENABLED=false` and `POS_STRIPE_TAX_ENABLED=false`/);
});

test("remaining owner and accountant inputs are explicit", () => {
  for (const input of ["legal store address", "Florida registration", "filing frequency", "accountant review", "product tax code", "shipping tax code", "Local Pickup", "exemption policy", "evidence-retention"]) assert.match(operations, new RegExp(input, "i"));
});

test("go-live and security docs use the unified Stripe Tax architecture", () => {
  assert.match(runbook, /Unified Stripe Tax operating model \(authoritative\)/);
  assert.match(runbook, /POS_STRIPE_TAX_ENABLED=false/);
  assert.match(runbook, /MANUAL_TAX_FALLBACK_ENABLED=false/);
  assert.match(security, /Online and POS tax authority is Stripe Tax/);
  assert.match(security, /Tax Go-Live Switchboard/);
  assert.doesNotMatch(runbook, /`POS_SALES_TAX_ENABLED=true`/);
});

test("documentation contains no credential or official registration values", () => {
  const combined = `${operations}\n${runbook}\n${security}`;
  assert.doesNotMatch(combined, /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/);
  assert.doesNotMatch(combined, /whsec_[A-Za-z0-9]+/);
  assert.doesNotMatch(combined, /Florida registration (?:number|id)\s*[:=]\s*\S+/i);
});
