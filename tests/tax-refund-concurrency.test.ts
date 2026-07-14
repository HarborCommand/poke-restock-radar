import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("online and POS refunds use explicit Postgres row locks", () => {
  const storefront = read("src/lib/storefront.ts");
  const radar = read("src/lib/radar-service.ts");
  const concurrency = read("src/lib/tax-refund-concurrency.ts");
  assert.match(concurrency, /TransactionIsolationLevel\.Serializable/);
  assert.match(concurrency, /FROM "StorefrontOrder"[\s\S]*?FOR UPDATE/);
  assert.match(concurrency, /FROM "InventorySale"[\s\S]*?FOR UPDATE/);
  assert.match(storefront, /runTaxRefundTransaction\(async \(tx\) => \{[\s\S]*?lockStorefrontOrderForRefund/);
  assert.match(radar, /runTaxRefundTransaction\(async \(tx\) => \{[\s\S]*?lockPosSaleForRefund/);
});

test("provider refund happens behind the order lock and tax uses the original snapshot", () => {
  const storefront = read("src/lib/storefront.ts");
  const transactionStart = storefront.indexOf("const transactionResult = await runTaxRefundTransaction");
  const refundFunction = storefront.slice(
    storefront.indexOf("export async function cancelOrRefundStorefrontOrder"),
    storefront.indexOf("export async function updateStorefrontOrder")
  );
  const lock = storefront.indexOf("await lockStorefrontOrderForRefund", transactionStart);
  const provider = storefront.indexOf("dependencies.createRefund", transactionStart);
  const snapshot = storefront.indexOf("originalTaxCents: current.taxCents", transactionStart);
  assert.ok(transactionStart >= 0 && transactionStart < lock && lock < provider && provider < snapshot);
  assert.match(storefront, /current\.taxCents !== null/);
  assert.match(storefront, /current\.totalCents \?\? totalCents/);
  assert.doesNotMatch(refundFunction, /input\.(?:tax|taxCents|refundedTax|refundedTaxCents)/);
});

test("Stripe events are claimed once and failed processing can be retried", () => {
  const storefront = read("src/lib/storefront.ts");
  const concurrency = read("src/lib/tax-refund-concurrency.ts");
  assert.match(storefront, /claimProviderEvent/);
  assert.match(storefront, /if \(claim !== "claimed"\)/);
  assert.match(storefront, /completeProviderEvent/);
  assert.match(storefront, /abandonProviderEvent/);
  assert.match(concurrency, /processing:\$\{input\.eventType\}/);
  assert.match(concurrency, /error\.code !== "P2002"/);
});

test("checkout tax snapshots become immutable after payment or refund finalization", () => {
  const storefront = read("src/lib/storefront.ts");
  assert.match(storefront, /paymentStatus: \{ notIn: \["paid", "partially_refunded", "refunded", "refund_pending"\] \}/);
  assert.match(storefront, /status: \{ notIn: \["canceled", "refunded", "partially_refunded", "refund_pending"\] \}/);
  assert.match(storefront, /checkout_session_already_finalized/);
  assert.match(storefront, /checkout_session_state_changed/);
});

test("tax stays outside revenue, profit, and reward eligibility", () => {
  const storefront = read("src/lib/storefront.ts");
  const rewards = read("src/lib/customer-rewards.ts");
  assert.match(storefront, /totalCents - taxCents - Math\.max\(0, refundedCents - refundedTaxCents\)/);
  assert.match(storefront, /Math\.max\(0, order\.total - order\.tax\)/);
  assert.match(rewards, /taxCentsExcluded/);
  assert.match(rewards, /eligibleSubtotalCents/);
});

test("POS customer receipts show refunded tax without inventing historical tax", () => {
  const app = read("src/components/RadarApp.tsx");
  const receiptHelpers = app.slice(
    app.indexOf("function posReceiptTotals"),
    app.indexOf("type SaleAttachTarget")
  );
  const saleDetails = app.slice(
    app.indexOf("function SaleDetailsModal"),
    app.indexOf("function EditSaleModal")
  );
  assert.match(receiptHelpers, /const refundedTax = snapshotKnown[\s\S]*?: null/);
  assert.match(receiptHelpers, /`Refunded tax: \$\{totals\.refundedTax === null \? "Not recorded" : money\(totals\.refundedTax\)\}`/);
  assert.match(saleDetails, /Refunded tax <strong>\{receiptTotals\.refundedTax === null \? "Not recorded" : money\(receiptTotals\.refundedTax\)\}/);
});

test("refund idempotency is scoped to the authoritative order or POS sale", () => {
  const storefront = read("src/lib/storefront.ts");
  const radar = read("src/lib/radar-service.ts");
  assert.match(storefront, /admin\.cancel_refund:\$\{orderId\}:\$\{input\.idempotencyKey\}/);
  assert.match(storefront, /storefront-cancel-refund:\$\{current\.id\}:\$\{input\.idempotencyKey\}/);
  assert.match(storefront, /tax:storefront-refund:\$\{current\.id\}:\$\{input\.idempotencyKey\}/);
  assert.match(storefront, /where: \{ orderId: order\.id, eventId: \{ in:/);
  assert.match(radar, /inventorySaleId: \{ in: lockedSales\.map\(\(sale\) => sale\.id\) \}/);
});

test("successful and rejected refund responses are private and conflict-safe", () => {
  const onlineRoute = read("src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts");
  const posRoute = read("src/app/api/radar/pos/sales/[saleReference]/refund/route.ts");
  const http = read("src/lib/http.ts");
  for (const route of [onlineRoute, posRoute]) {
    assert.match(route, /withPrivateNoStore\(withRequestId\(response, requestId\)\)/);
    assert.match(route, /privateOk/);
  }
  assert.match(http, /TAX_REFUND_CONFLICT[\s\S]*?409/);
  assert.match(http, /TAX_REFUND_AMOUNT_INVALID[\s\S]*?422/);
});

test("provider refund webhooks use the stored order snapshot and deduplicate by provider refund", () => {
  const storefront = read("src/lib/storefront.ts");
  const applyRefund = storefront.slice(
    storefront.indexOf("export async function applyStripeRefundSnapshot"),
    storefront.indexOf("async function processStripeWebhookEvent")
  );
  assert.match(storefront, /event\.type === "refund\.created" \|\| event\.type === "refund\.updated"/);
  assert.match(applyRefund, /lockStorefrontOrderForRefund/);
  assert.match(applyRefund, /providerReference: input\.providerRefundId/);
  assert.match(applyRefund, /originalTaxCents: current\.taxCents/);
  assert.match(applyRefund, /cumulativeRefundedAmountCents: nextRefundedCents/);
  assert.doesNotMatch(applyRefund, /taxFeatureConfig|stateTaxRateBasisPoints|countyTaxRateBasisPoints/);
});

test("stale provider-event claims can be reclaimed without overlapping active processing", () => {
  const concurrency = read("src/lib/tax-refund-concurrency.ts");
  assert.match(concurrency, /providerEventClaimTimeoutMs = 5 \* 60 \* 1_000/);
  assert.match(concurrency, /receivedAt: \{ lte: new Date\(Date\.now\(\) - providerEventClaimTimeoutMs\) \}/);
  assert.match(concurrency, /if \(reclaimed\.count === 1\) return "claimed"/);
});
