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

test("Stripe Checkout session creation collects customer contact and address details", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const sessionRoute = readProjectFile("src/app/api/storefront/checkout/session/route.ts");
  const legacyCheckoutRoute = readProjectFile("src/app/api/storefront/checkout/route.ts");
  const createCheckoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );
  const sessionCreateParams = sourceSlice(
    createCheckoutSession,
    "const session = await stripe.checkout.sessions.create({",
    "    });"
  );

  assert.match(storefront, /const stripeShippingAllowedCountries = \["US"\]/);
  assert.match(sessionCreateParams, /mode: "payment"/);
  assert.match(sessionCreateParams, /customer_email: input\.customerEmail/);
  assert.match(sessionCreateParams, /customer_creation: "always"/);
  assert.doesNotMatch(sessionCreateParams, /(^|[\s,{])customer:\s/);
  assert.match(sessionCreateParams, /phone_number_collection: \{ enabled: true \}/);
  assert.match(sessionCreateParams, /billing_address_collection: "auto"/);
  assert.match(sessionCreateParams, /shipping_address_collection: \{\s*allowed_countries: stripeShippingAllowedCountries\s*\}/);
  assert.match(sessionRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.match(legacyCheckoutRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.doesNotMatch(sessionCreateParams, /payment_method_data|card_number|cardNumber|cvc|cvv/i);
});

test("Stripe webhook handlers verify raw request bodies before trusting events", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const currentWebhookRoute = readProjectFile("src/app/api/storefront/webhook/stripe/route.ts");
  const legacyWebhookRoute = readProjectFile("src/app/api/storefront/stripe/webhook/route.ts");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  for (const route of [currentWebhookRoute, legacyWebhookRoute]) {
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /const rawBody = await request\.text\(\)/);
    assert.match(route, /request\.headers\.get\("stripe-signature"\)/);
    assert.match(route, /handleStripeWebhook\(rawBody, signature\)/);
    assert.doesNotMatch(route, /await request\.json\(\)/);
  }

  const verifyIndex = handleStripeWebhook.indexOf("webhooks.constructEvent(rawBody, signature, secret)");
  const eventStoreIndex = handleStripeWebhook.indexOf("await upsertSafePaymentEvent");
  const completedIndex = handleStripeWebhook.indexOf('event.type === "checkout.session.completed"');

  assert.ok(verifyIndex >= 0, "webhook signature verification is missing");
  assert.ok(eventStoreIndex > verifyIndex, "payment event storage must happen after signature verification");
  assert.ok(completedIndex > verifyIndex, "checkout.session.completed handling must happen after signature verification");
});

test("checkout.session.completed only persists paid orders", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  const completedIndex = handleStripeWebhook.indexOf('event.type === "checkout.session.completed"');
  const paidGuardIndex = handleStripeWebhook.indexOf('session.payment_status !== "paid"');
  const persistIndex = handleStripeWebhook.indexOf("await persistPaidCheckoutSession");
  const saleIndex = handleStripeWebhook.indexOf("await createStorefrontSale");

  assert.ok(completedIndex >= 0, "checkout.session.completed branch is missing");
  assert.ok(paidGuardIndex > completedIndex, "paid-only guard must be inside checkout.session.completed handling");
  assert.ok(paidGuardIndex < persistIndex, "non-paid sessions must be ignored before persistence");
  assert.ok(paidGuardIndex < saleIndex, "non-paid sessions must be ignored before fulfillment/sale creation");
  assert.match(handleStripeWebhook, /return \{ ok: true, skipped: "checkout_session_not_paid" \}/);
});

test("duplicate Stripe sessions and events do not duplicate orders or customer totals", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const orderForStripeEvent = sourceSlice(storefront, "async function orderForStripeEvent", "type StripeAddressLike");
  const persistPaidCheckoutSession = sourceSlice(storefront, "async function persistPaidCheckoutSession", "export async function handleStripeWebhook");
  const syncStorefrontCustomerTotals = sourceSlice(storefront, "async function syncStorefrontCustomerTotals", "async function persistPaidCheckoutSession");
  const upsertSafePaymentEvent = sourceSlice(storefront, "async function upsertSafePaymentEvent", "function checkoutCustomerSnapshot");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  assert.match(schema, /stripeCheckoutSessionId String\?\s+@unique/);
  assert.match(schema, /eventId\s+String\s+@unique/);
  assert.match(orderForStripeEvent, /stripeCheckoutSessionId: object\.id/);
  assert.match(persistPaidCheckoutSession, /prisma\.storefrontOrder\.update\(\{\s*where: \{ id: order\.id \}/);
  assert.doesNotMatch(persistPaidCheckoutSession, /prisma\.storefrontOrder\.create/);
  assert.match(upsertSafePaymentEvent, /prisma\.paymentEvent\.upsert/);
  assert.match(upsertSafePaymentEvent, /where: \{ eventId: event\.id \}/);
  assert.match(handleStripeWebhook, /const wasPaid = order\.paymentStatus === "paid"/);
  assert.match(handleStripeWebhook, /if \(!wasPaid && order\.paymentStatus !== "paid"\) await createStorefrontSale\(order\)/);
  assert.match(syncStorefrontCustomerTotals, /where: \{ customerEmail, paymentStatus: "paid" \}/);
  assert.match(syncStorefrontCustomerTotals, /totalOrders: paidOrders\.length/);
  assert.match(syncStorefrontCustomerTotals, /totalSpent: paidOrders\.reduce\(\(sum, order\) => sum \+ order\.total, 0\)/);
  assert.doesNotMatch(syncStorefrontCustomerTotals, /increment:/);
});

test("verified paid sessions persist safe customer and address snapshots with nullable handling", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const types = readProjectFile("src/types/radar.ts");
  const checkoutCustomerSnapshot = sourceSlice(storefront, "function checkoutCustomerSnapshot", "function storefrontCustomerShippingSnapshot");
  const persistPaidCheckoutSession = sourceSlice(storefront, "async function persistPaidCheckoutSession", "export async function handleStripeWebhook");
  const orderToDTO = sourceSlice(storefront, "export function storefrontOrderToDTO", "export async function createCheckoutSession");

  assert.match(checkoutCustomerSnapshot, /normalizedCustomerEmail\(session\.customer_details\?\.email \?\? session\.customer_email \?\? order\.customerEmail\)/);
  assert.match(checkoutCustomerSnapshot, /session\.customer_details\?\.phone \?\? shippingDetails\?\.phone \?\? order\.customerPhone \?\? null/);
  assert.match(checkoutCustomerSnapshot, /stripeCustomerId: stripeId\(session\.customer\)/);
  assert.match(checkoutCustomerSnapshot, /shippingDetails\?\.address \?\? null/);
  assert.match(checkoutCustomerSnapshot, /session\.customer_details\?\.address \?\? null/);
  assert.match(persistPaidCheckoutSession, /customerPhone: snapshot\.customerPhone/);
  assert.match(persistPaidCheckoutSession, /shippingName: snapshot\.shippingDetails\?\.name \?\? snapshot\.customerName \?\? null/);
  assert.match(persistPaidCheckoutSession, /shippingLine1: snapshot\.shippingAddress\?\.line1 \?\? null/);
  assert.match(persistPaidCheckoutSession, /shippingCity: snapshot\.shippingAddress\?\.city \?\? null/);
  assert.match(persistPaidCheckoutSession, /billingName: session\.customer_details\?\.name \?\? snapshot\.customerName \?\? null/);
  assert.match(persistPaidCheckoutSession, /billingLine1: snapshot\.billingAddress\?\.line1 \?\? null/);
  assert.match(persistPaidCheckoutSession, /billingCity: snapshot\.billingAddress\?\.city \?\? null/);
  assert.match(persistPaidCheckoutSession, /stripeCheckoutSessionId: session\.id/);
  assert.match(persistPaidCheckoutSession, /stripePaymentIntentId: snapshot\.stripePaymentIntentId \?\? order\.stripePaymentIntentId/);
  assert.match(orderToDTO, /customerPhone: order\.customerPhone \?\? order\.customer\?\.phone \?\? null/);
  assert.match(orderToDTO, /shippingAddress: orderAddress\(\{/);
  assert.match(orderToDTO, /billingAddress: orderAddress\(\{/);

  for (const field of ["customerEmail", "customerPhone", "shippingLine1", "billingLine1"]) {
    assert.match(schema, new RegExp(`${field}\\s+String\\?`), `schema field should be nullable: ${field}`);
  }
  assert.match(types, /customerEmail: string \| null/);
  assert.match(types, /customerPhone: string \| null/);
  assert.match(types, /shippingAddress: StorefrontAddressDTO \| null/);
  assert.match(types, /billingAddress: StorefrontAddressDTO \| null/);
});

test("Admin Orders renders saved customer and address data instead of old placeholders", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function DetailStat");
  const customerSection = sourceSlice(orderModal, "<h3>Customer</h3>", "<h3>Order</h3>");

  assert.match(app, /function formatStorefrontAddressLines/);
  assert.match(app, /className="storefront-address-lines"/);
  assert.match(css, /\.storefront-address-lines \{[\s\S]*display: grid;[\s\S]*gap: 2px;/);
  assert.match(customerSection, /value=\{order\.customerEmail \|\| "Not provided"\}/);
  assert.match(customerSection, /value=\{order\.customerPhone \|\| "Not provided"\}/);
  assert.match(customerSection, /value=\{order\.stripeCustomerId \|\| "Not provided"\}/);
  assert.match(customerSection, /<StorefrontAddressLines address=\{order\.shippingAddress\} \/>/);
  assert.match(customerSection, /<StorefrontAddressLines address=\{order\.billingAddress\} \/>/);
  assert.doesNotMatch(customerSection, /email not saved|Not saved|Not collected|Not stored|JSON\.stringify|<pre|<code/);
});

test("checkout customer records never persist raw card or payment method details", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const types = readProjectFile("src/types/radar.ts");
  const safeStripeEventPayload = sourceSlice(storefront, "function safeStripeEventPayload", "async function upsertSafePaymentEvent");
  const storefrontModels = sourceSlice(schema, "model StorefrontCustomer", "model Fulfillment");
  const storefrontOrderTypes = sourceSlice(types, "export type StorefrontAddressDTO", "export type StorefrontSummaryDTO");

  for (const source of [storefront, safeStripeEventPayload, storefrontModels, storefrontOrderTypes]) {
    assert.doesNotMatch(source, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);
  }
  assert.match(safeStripeEventPayload, /provider: "stripe"/);
  assert.match(safeStripeEventPayload, /stripeCustomerId: stripeIdFromUnknown\(object\.customer\)/);
  assert.match(safeStripeEventPayload, /customerPhone: stringValue\(customerDetails\?\.phone\)/);
});
