import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

const presentation = readProjectFile("src/lib/order-status-presentation.ts");
const lookupClient = readProjectFile("src/components/OrderStatusLookupClient.tsx");
const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
const orderStatusPage = readProjectFile("src/app/order-status/page.tsx");
const accountOrdersPage = readProjectFile("src/app/account/orders/page.tsx");
const orderStatusRoute = readProjectFile("src/app/api/storefront/order-status/route.ts");
const css = readProjectFile("src/app/globals.css");
const accountDetail = sourceSlice(accountComponents, "export function AccountOrderDetail", "function RewardTierBadge");

test("customer-safe order status presentation exposes explicit timeline states", () => {
  for (const label of ["Order received", "Processing", "Ready for pickup", "Shipped", "Delivered", "Refunded", "Canceled"]) {
    assert.match(presentation, new RegExp(label));
  }
  assert.match(presentation, /customerSafeOrderMilestones/);
  assert.match(presentation, /customerSafeSupportCue/);
  assert.match(presentation, /fulfillmentMethod === "local_pickup"/);
  assert.match(presentation, /fulfillmentMethod === "in_store"/);
  assert.match(presentation, /trackingNumber/);
  assert.match(presentation, /tax|paymentStatus|refundStatus/);
  assert.doesNotMatch(presentation, /stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|adminNotes|internalNote|costBasis|netProfit|profitLoss|supplier|private lot/i);
});

test("guest order-status lookup remains proof-gated private and noindexed", () => {
  assert.match(orderStatusRoute, /publicOrderStatusLookupSchema/);
  assert.match(orderStatusRoute, /checkPublicRateLimit/);
  assert.match(orderStatusRoute, /lookupPublicOrderStatus\(input\)/);
  assert.match(orderStatusRoute, /privateOk\(result\)/);
  assert.match(orderStatusRoute, /withPrivateNoStore\(badRequest\(error\)\)/);
  assert.match(orderStatusPage, /noStore\(\)/);
  assert.match(orderStatusPage, /robots:\s*\{\s*\r?\n\s*index:\s*false,\s*\r?\n\s*follow:\s*false/);
  assert.match(lookupClient, /Enter your order number and the email used at checkout/);
  assert.match(lookupClient, /aria-label="Customer-safe order timeline"/);
  assert.match(lookupClient, /Sales tax/);
  assert.match(lookupClient, /Not recorded/);
  assert.doesNotMatch(lookupClient + orderStatusRoute, /customerAccountId|rewardBalance|rewardLedgerEntries|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|adminNotes|internalNote|costBasis|netProfit|supplier|private lot/i);
});

test("verified account order pages show safe status timeline without exposing internals", () => {
  assert.match(accountOrdersPage, /noStore\(\)/);
  assert.match(accountOrdersPage, /robots:\s*\{\s*\r?\n\s*index:\s*false,\s*\r?\n\s*follow:\s*false/);
  assert.match(accountComponents, /primaryOrderMilestone/);
  assert.match(accountComponents, /gdg-account-status-callout/);
  assert.match(accountDetail, /aria-label="Customer-safe order timeline"/);
  assert.match(accountDetail, /customerSafeOrderMilestones\(order\)/);
  assert.match(accountDetail, /customerSafeSupportCue\(order\)/);
  assert.match(accountDetail, /Customer account pages do not provide\s*\r?\n\s*cancellation or refund actions/);
  assert.match(accountDetail, /order\.tax === null \? "Not recorded" : money\(order\.tax\)/);
  assert.match(accountComponents, /Online orders and linked in-store purchases tied to your verified account/);
  assert.match(accountComponents, /Private payment references hidden/);
  assert.doesNotMatch(accountComponents + accountOrdersPage, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|stripeRefundId|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|customerLinkNote|customerLinkReason|paymentReference|costBasis|netProfit|profitLoss|roiPercent|supplier|private lot|billingAddress/i);
});

test("order support timeline is responsive and avoids narrow metadata columns", () => {
  assert.match(css, /\.order-status-timeline,\s*\r?\n\.gdg-account-order-timeline\s*\{[\s\S]*?border-radius: 16px;/);
  assert.match(css, /\.order-status-timeline li,\s*\r?\n\.gdg-account-order-timeline li\s*\{[\s\S]*?min-width: 0;[\s\S]*?display: grid;/);
  assert.match(css, /\.order-status-timeline p,\s*\r?\n\.gdg-account-order-timeline p\s*\{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(css, /\.gdg-account-status-callout\s*\{[\s\S]*?min-width: 0;/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.gdg-account-detail-layout\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.gdg-account-order-grid,\s*\r?\n\s*\.gdg-account-order-grid\.two\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: [^)]+\)[\s\S]*?\.order-status-form,\s*\r?\n\s*\.order-status-summary-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});
