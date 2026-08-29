import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { customerVisibleOrderWhere, customerVisiblePosSaleWhere } from "../src/lib/customer-account-security";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifiedAccount = {
  id: "customer-a",
  email: " CustomerA@Example.test ",
  emailVerifiedAt: new Date("2026-07-01T00:00:00.000Z")
};

test("online order scope cannot email-fallback across an existing customer link", () => {
  const where = customerVisibleOrderWhere(verifiedAccount, "GDG-ORDER-1");
  assert.ok(where);
  assert.deepEqual(where, {
    orderNumber: "GDG-ORDER-1",
    isTestOrder: false,
    OR: [
      { customerAccountId: "customer-a" },
      { customerAccountId: null, customer: { is: { customerAccountId: "customer-a" } } },
      { customerAccountId: null, customerEmail: "customera@example.test" },
      { customerAccountId: null, customer: { is: { email: "customera@example.test" } } }
    ]
  });
});

test("POS purchase scope requires the authenticated customer id", () => {
  const where = customerVisiblePosSaleWhere(verifiedAccount, "POS-123");
  assert.deepEqual(where, {
    customerAccountId: "customer-a",
    platform: { notIn: ["website", "test", "smoke"] },
    OR: [{ saleReference: "POS-123" }, { id: "POS-123" }]
  });
});

test("unverified accounts receive no purchase scope", () => {
  assert.equal(customerVisibleOrderWhere({ ...verifiedAccount, emailVerifiedAt: null }), null);
  assert.equal(customerVisiblePosSaleWhere({ ...verifiedAccount, emailVerifiedAt: null }), null);
});

test("customer reward activity omits raw ledger reasons", () => {
  const source = readFileSync(path.join(root, "src/lib/customer-rewards.ts"), "utf8");
  const activityFunction = source.slice(source.indexOf("export async function listCustomerRewardActivity"));
  assert.doesNotMatch(activityFunction, /reason:\s*true|reason:\s*entry\.reason/);
  assert.match(activityFunction, /sourceType: customerRewardActivitySource\(entry\)/);
});

test("account pages are explicitly private and non-indexable", () => {
  const config = readFileSync(path.join(root, "next.config.mjs"), "utf8");
  const serviceWorker = readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.match(config, /source: "\/sw\.js"/);
  assert.match(config, /Service-Worker-Allowed/);
  assert.match(config, /source: "\/manifest-pos\.webmanifest"/);
  assert.match(config, /source: "\/account\/:path\*"/);
  assert.match(config, /source: "\/pos"/);
  assert.match(config, /source: "\/pos\/:path\*"/);
  assert.match(config, /private, no-store, no-cache/);
  assert.match(config, /X-Robots-Tag/);
  assert.match(serviceWorker, /url\.pathname === "\/account"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/account\/"\)/);
  assert.match(serviceWorker, /isPosPath/);
  assert.match(serviceWorker, /posShouldBypassCache/);
  assert.match(serviceWorker, /request\.headers\.get\("RSC"\) === "1"/);
  assert.match(serviceWorker, /!cacheControl\.includes\("private"\)/);
  assert.match(serviceWorker, /!cacheControl\.includes\("no-store"\)/);
});

test("purchase detail selects customer-safe fields instead of raw records", () => {
  const source = readFileSync(path.join(root, "src/lib/customer-account-auth.ts"), "utf8");
  const detail = source.slice(source.indexOf("export async function getCustomerAccountOrderDetail"));
  assert.match(detail, /customerVisiblePosSaleWhere\(account, saleKey\)/);
  assert.match(detail, /customerVisibleOrderWhere\(account, cleanOrderNumber\)/);
  assert.match(detail, /select: customerVisiblePosSaleSelect/);
  assert.doesNotMatch(detail, /costBasis|activeProfitLoss|roiPercent|paymentReference|adminNote/);
});

test("customer account reads use allowlisted selects", () => {
  const source = readFileSync(path.join(root, "src/lib/customer-account-auth.ts"), "utf8");
  assert.match(source, /rewardBalance:\s*\{\s*select:/);
  assert.match(source, /savedAddresses:\s*\{\s*select:/);
  assert.match(source, /const customerVisiblePosSaleSelect =/);
  assert.doesNotMatch(source, /const customerVisiblePosSaleInclude =/);
});

test("reward activity is account scoped and bounded", () => {
  const source = readFileSync(path.join(root, "src/lib/customer-rewards.ts"), "utf8");
  const activityFunction = source.slice(source.indexOf("export async function listCustomerRewardActivity"));
  assert.match(activityFunction, /where: \{ customerAccountId: account\.id \}/);
  assert.match(activityFunction, /Math\.max\(1, Math\.min\(50/);
  assert.match(activityFunction, /take: boundedTake/);
  assert.doesNotMatch(activityFunction, /reason: true|metadataJson: true|idempotencyKey: true|reversalOfEntryId: true/);
});

test("account mutations reject unknown ownership fields", () => {
  const addressRoute = readFileSync(path.join(root, "src/app/api/account/addresses/route.ts"), "utf8");
  const securityRoute = readFileSync(path.join(root, "src/app/api/account/security/sessions/route.ts"), "utf8");
  assert.match(addressRoute, /addressActionSchema/);
  assert.match(addressRoute, /\.strict\(\)/);
  assert.match(addressRoute, /assertCustomerSameOriginRequest\(request\)/);
  assert.match(securityRoute, /hasClientSuppliedCustomerOwnership\(input\.raw\)/);
  assert.match(securityRoute, /assertCustomerSameOriginRequest\(request\)/);
});

test("public order status responses cannot be shared-cached", () => {
  const route = readFileSync(path.join(root, "src/app/api/storefront/order-status/route.ts"), "utf8");
  assert.match(route, /return privateOk\(result\)/);
  assert.match(route, /withPrivateNoStore\(badRequest\(error\)\)/);
});
