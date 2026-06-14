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
  assert.match(sessionCreateParams, /shipping_options: checkoutShippingOptions/);
  assert.match(sessionRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.match(legacyCheckoutRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.doesNotMatch(sessionCreateParams, /product_data: \{ name: "Shipping" \}/);
  assert.doesNotMatch(sessionCreateParams, /payment_method_data|card_number|cardNumber|cvc|cvv/i);
});

test("Stripe Checkout session creation only creates temporary stock reservations", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const createCheckoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );

  assert.match(createCheckoutSession, /const cart = await getCartProducts\(input\.items\)/);
  assert.match(createCheckoutSession, /reservations: \{\s*create: cart\.map/);
  assert.match(createCheckoutSession, /expiresAt: new Date\(Date\.now\(\) \+ reservationMinutes \* 60 \* 1000\)/);
  assert.match(createCheckoutSession, /cancel_url: `\$\{checkoutBaseUrl\}\/checkout\/cancel\?order=\$\{order\.id\}`/);
  assert.doesNotMatch(createCheckoutSession, /prisma\.inventorySale\.create/);
  assert.doesNotMatch(createCheckoutSession, /prisma\.inventoryStockLot\.update/);
  assert.doesNotMatch(createCheckoutSession, /remainingQuantity:\s*lot\.remainingQuantity -/);
  assert.doesNotMatch(createCheckoutSession, /quantitySold:/);
  assert.doesNotMatch(createCheckoutSession, /paymentStatus: "paid"/);
});

test("cart availability refresh is read-only and unpaid reservations do not appear as sold stock", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const sellableQuantity = sourceSlice(storefront, "function sellableQuantity", "function publicCategoryForItem");
  const listPublicStoreProducts = sourceSlice(storefront, "export async function listPublicStoreProducts", "export async function getPublicStoreProduct");
  const getPublicStoreProduct = sourceSlice(storefront, "export async function getPublicStoreProduct", "export async function getCartProducts");
  const getCartProducts = sourceSlice(storefront, "export async function getCartProducts", "function stripeClient");
  const createCheckoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );

  assert.match(sellableQuantity, /const owned = quantityOwned\(item\)/);
  assert.doesNotMatch(sellableQuantity, /activeReservedQuantity|stockReservations|StockReservation/);

  for (const readPath of [listPublicStoreProducts, getPublicStoreProduct, getCartProducts]) {
    assert.doesNotMatch(readPath, /releaseExpiredReservations\(\)/);
    assert.doesNotMatch(readPath, /prisma\.stockReservation\.(create|update|updateMany|upsert|delete|deleteMany)/);
    assert.doesNotMatch(readPath, /prisma\.inventorySale\.create|prisma\.inventoryStockLot\.update|quantitySold:|remainingQuantity:\s*lot\.remainingQuantity -/);
  }

  assert.match(createCheckoutSession, /await releaseExpiredReservations\(\);\s+const cart = await getCartProducts\(input\.items\)/);
  assert.doesNotMatch(getCartProducts, /reservations:\s*\{\s*create/);
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

test("paid checkout completion is the permanent inventory decrement path", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const createStorefrontSale = sourceSlice(storefront, "async function createStorefrontSale", "async function releaseOrderReservations");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  assert.match(handleStripeWebhook, /const event = stripeClient\(\)\.webhooks\.constructEvent\(rawBody, signature, secret\)/);
  assert.match(handleStripeWebhook, /if \(session\.payment_status !== "paid"\) return \{ ok: true, skipped: "checkout_session_not_paid" \}/);
  assert.match(handleStripeWebhook, /const wasPaid = order\.paymentStatus === "paid"/);
  assert.match(handleStripeWebhook, /if \(!wasPaid && order\.paymentStatus !== "paid"\) await createStorefrontSale\(order\)/);
  assert.match(createStorefrontSale, /prisma\.\$transaction/);
  assert.match(createStorefrontSale, /tx\.storefrontOrder\.updateMany/);
  assert.match(createStorefrontSale, /where: \{ id: order\.id, paymentStatus: \{ not: "paid" \} \}/);
  assert.match(createStorefrontSale, /if \(claimed\.count === 0\) return \{ created: false/);
  assert.match(createStorefrontSale, /tx\.inventoryStockLot\.update/);
  assert.match(createStorefrontSale, /remainingQuantity: lot\.remainingQuantity - quantityFromLot/);
  assert.match(createStorefrontSale, /tx\.inventorySale\.create/);
  assert.match(createStorefrontSale, /quantitySold: orderItem\.quantity/);
  assert.match(createStorefrontSale, /tx\.stockReservation\.updateMany/);
  assert.match(createStorefrontSale, /data: \{ status: "completed" \}/);
});

test("unpaid, expired, or canceled checkouts release reservations without recording paid inventory sales", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const cancelPage = readProjectFile("src/app/checkout/cancel/page.tsx");
  const releaseOrderReservations = sourceSlice(storefront, "async function releaseOrderReservations", "async function markStorefrontOrderPaymentFailed");
  const markStorefrontOrderPaymentFailed = sourceSlice(
    storefront,
    "async function markStorefrontOrderPaymentFailed",
    "export async function releaseUnpaidCheckoutOrder"
  );
  const releaseUnpaidCheckoutOrder = sourceSlice(storefront, "export async function releaseUnpaidCheckoutOrder", "async function orderForStripeEvent");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  assert.match(releaseOrderReservations, /prisma\.stockReservation\.updateMany/);
  assert.match(releaseOrderReservations, /where: \{ orderId, status: "reserved" \}/);
  assert.match(releaseOrderReservations, /data: \{ status: "released", releasedAt: new Date\(\) \}/);
  assert.match(markStorefrontOrderPaymentFailed, /if \(order\.paymentStatus === "paid" \|\| order\.paymentStatus === paymentStatus\) return/);
  assert.match(markStorefrontOrderPaymentFailed, /await releaseOrderReservations\(order\.id\)/);
  assert.match(handleStripeWebhook, /event\.type === "checkout\.session\.expired"/);
  assert.match(handleStripeWebhook, /markStorefrontOrderPaymentFailed\(order, "expired"/);
  assert.match(handleStripeWebhook, /event\.type === "checkout\.session\.async_payment_failed" \|\| event\.type === "payment_intent\.payment_failed"/);
  assert.match(handleStripeWebhook, /markStorefrontOrderPaymentFailed\(order, "failed"/);
  assert.match(releaseUnpaidCheckoutOrder, /if \(order\.paymentStatus === "paid"\) return \{ ok: true, released: false, reason: "already_paid" \}/);
  assert.match(releaseUnpaidCheckoutOrder, /await markStorefrontOrderPaymentFailed\(order, "failed", "Stripe Checkout was canceled before payment completed\."\)/);
  assert.doesNotMatch(releaseUnpaidCheckoutOrder, /prisma\.inventorySale\.create|prisma\.inventoryStockLot\.update|paymentStatus: "paid"/);
  assert.match(cancelPage, /releaseUnpaidCheckoutOrder\(params\.order\)/);
});

test("duplicate Stripe sessions and events do not duplicate orders or customer totals", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const orderForStripeEvent = sourceSlice(storefront, "async function orderForStripeEvent", "type StripeAddressLike");
  const createStorefrontSale = sourceSlice(storefront, "async function createStorefrontSale", "async function releaseOrderReservations");
  const persistPaidCheckoutSession = sourceSlice(storefront, "async function persistPaidCheckoutSession", "export async function handleStripeWebhook");
  const syncStorefrontCustomerTotals = sourceSlice(storefront, "async function syncStorefrontCustomerTotals", "async function persistPaidCheckoutSession");
  const upsertSafePaymentEvent = sourceSlice(storefront, "async function upsertSafePaymentEvent", "function checkoutCustomerSnapshot");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  assert.match(schema, /stripeCheckoutSessionId\s+String\?\s+@unique/);
  assert.match(schema, /eventId\s+String\s+@unique/);
  assert.match(orderForStripeEvent, /stripeCheckoutSessionId: object\.id/);
  assert.match(persistPaidCheckoutSession, /prisma\.storefrontOrder\.update\(\{\s*where: \{ id: order\.id \}/);
  assert.doesNotMatch(persistPaidCheckoutSession, /prisma\.storefrontOrder\.create/);
  assert.match(upsertSafePaymentEvent, /prisma\.paymentEvent\.upsert/);
  assert.match(upsertSafePaymentEvent, /where: \{ eventId: event\.id \}/);
  assert.match(handleStripeWebhook, /const wasPaid = order\.paymentStatus === "paid"/);
  assert.match(handleStripeWebhook, /if \(!wasPaid && order\.paymentStatus !== "paid"\) await createStorefrontSale\(order\)/);
  assert.match(createStorefrontSale, /tx\.storefrontOrder\.updateMany/);
  assert.match(createStorefrontSale, /where: \{ id: order\.id, paymentStatus: \{ not: "paid" \} \}/);
  assert.match(createStorefrontSale, /if \(claimed\.count === 0\) return \{ created: false/);
  assert.match(syncStorefrontCustomerTotals, /paymentStatus: \{ in: activeRevenuePaymentStatuses \}/);
  assert.match(syncStorefrontCustomerTotals, /totalOrders: paidOrders\.filter\(\(order\) => storefrontOrderNetRevenue\(order\) > 0\)\.length/);
  assert.match(syncStorefrontCustomerTotals, /totalSpent: paidOrders\.reduce\(\(sum, order\) => sum \+ storefrontOrderNetRevenue\(order\), 0\)/);
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
  assert.match(persistPaidCheckoutSession, /shippingCharged,/);
  assert.match(persistPaidCheckoutSession, /shippingMethodLabel: shippingSnapshot\.shippingMethodLabel/);
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

test("Admin Orders renders an operational shipping section without raw payment details", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontCancelRefundModal");
  const shippingSection = sourceSlice(orderModal, '<section className="storefront-shipping-section">', "<section>");
  const storefrontSummary = sourceSlice(storefront, "export async function storefrontSummary", "async function returnOrderInventory");

  assert.match(app, /function formatShippingPackageWeight/);
  assert.match(app, /function formatShippingPackageProfile/);
  assert.match(app, /function formatShippingPackageDimensions/);
  assert.match(app, /function storefrontOrderShippingProfitLoss/);
  assert.match(app, /order\.shippingCharged - order\.shippingCost/);
  assert.match(app, /function storefrontOrderShippingReadiness/);

  assert.match(shippingSection, /<h3>Shipping<\/h3>/);
  assert.match(shippingSection, /Shipping method selected/);
  assert.match(shippingSection, /Shipping charged to customer/);
  assert.match(shippingSection, /Package weight snapshot/);
  assert.match(shippingSection, /Package profile snapshot/);
  assert.match(shippingSection, /Package dimensions snapshot/);
  assert.match(shippingSection, /Actual shipping cost/);
  assert.match(shippingSection, /Shipping profit\/loss/);
  assert.match(shippingSection, /Carrier/);
  assert.match(shippingSection, /Tracking number/);
  assert.match(shippingSection, /Fulfillment status/);
  assert.match(shippingSection, /name="shippingCost"/);
  assert.match(shippingSection, /name="carrier"/);
  assert.match(shippingSection, /name="trackingNumber"/);
  assert.match(shippingSection, /name="fulfillmentStatus"/);
  assert.match(orderModal, /disabled=\{busy \|\| !order\.needsFulfillment\}/);
  assert.match(orderModal, /Only active paid orders can be marked shipped/);
  assert.doesNotMatch(shippingSection, /JSON\.stringify\(order|<pre|<code|payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);

  assert.match(css, /storefront-shipping-section/);
  assert.match(css, /storefront-shipping-form/);
  assert.match(css, /storefront-shipping-head,[\s\S]*storefront-shipping-form \{[\s\S]*grid-template-columns: 1fr/);

  assert.match(storefrontSummary, /ordersToShipCount/);
  assert.match(storefrontSummary, /paymentStatus: "paid", fulfillmentStatus: \{ in: \["unfulfilled", "packing", "pickup_ready"\] \}/);
  assert.doesNotMatch(storefrontSummary, /prisma\.storefrontOrder\.count\(\{ where: \{ [^}]*paymentStatus: \{ in: activeRevenuePaymentStatuses \}/);
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

test("admin cancel refund flow stores safe refund metadata and uses Stripe Refund API", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const validation = readProjectFile("src/lib/validation.ts");
  const route = readProjectFile("src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");

  for (const field of [
    "refundStatus",
    "refundedAmount",
    "refundCurrency",
    "stripeRefundId",
    "refundReason",
    "refundNote",
    "stockReturnStatus",
    "stockReturnedAt",
    "customerCancellationEmailStatus",
    "customerCancellationEmailSentAt"
  ]) {
    assert.match(schema, new RegExp(`${field}\\s+`), `missing refund field ${field}`);
  }
  assert.match(validation, /storefrontOrderCancelRefundSchema/);
  assert.match(validation, /refundType: z\.enum\(\["full", "partial", "none"\]\)/);
  assert.match(validation, /partialRefundAmount/);
  assert.match(route, /requireUser/);
  assert.match(route, /storefrontOrderCancelRefundSchema\.parse/);
  assert.match(route, /cancelOrRefundStorefrontOrder\(user, orderId, input\)/);
  assert.match(cancelOrRefund, /stripeClient\(\)\.refunds\.create/);
  assert.match(cancelOrRefund, /payment_intent: order\.stripePaymentIntentId/);
  assert.match(cancelOrRefund, /amount: refundCents/);
  assert.match(cancelOrRefund, /idempotencyKey: `storefront-cancel-refund:\$\{input\.idempotencyKey\}`/);
  assert.match(cancelOrRefund, /if \(refundCents > remainingRefundableCents\) throw new Error\("Refund amount exceeds the remaining refundable order total\."\)/);
  assert.match(cancelOrRefund, /if \(input\.refundType === "none" && isPaidStripeOrder\)/);
  assert.match(cancelOrRefund, /if \(input\.refundType !== "none" && !isPaidStripeOrder\)/);
  assert.doesNotMatch(cancelOrRefund, /payment_method_details|payment_method_data|card_number|cvc|cvv/i);
});

test("admin cancel refund flow is idempotent and returns inventory once", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const returnOrderInventory = sourceSlice(storefront, "async function returnOrderInventory", "export async function cancelOrRefundStorefrontOrder");
  const alertLifecycle = sourceSlice(storefront, "function canceledOrRefundedOrderAlertInput", "async function createStorefrontSale");

  assert.match(cancelOrRefund, /const requestEventId = `admin\.cancel_refund:\$\{input\.idempotencyKey\}`/);
  assert.match(cancelOrRefund, /prisma\.paymentEvent\.findUnique\(\{ where: \{ eventId: requestEventId \} \}\)/);
  assert.match(cancelOrRefund, /prisma\.\$transaction/);
  assert.match(cancelOrRefund, /const duplicate = await tx\.paymentEvent\.findUnique/);
  assert.match(cancelOrRefund, /!current\.stockReturnedAt/);
  assert.match(returnOrderInventory, /data: \{ status: "returned"/);
  assert.match(returnOrderInventory, /tx\.inventoryStockLot\.update/);
  assert.match(returnOrderInventory, /remainingQuantity: \{ increment: orderItem\.quantity \}/);
  assert.match(returnOrderInventory, /tx\.inventoryItem\.update/);
  assert.match(returnOrderInventory, /quantity: \{ increment: orderItem\.quantity \}/);
  assert.match(cancelOrRefund, /eventType: "admin\.cancel_refund\.started"/);
  assert.match(cancelOrRefund, /eventType: "admin\.refund\.created"/);
  assert.match(cancelOrRefund, /eventType: "admin\.inventory\.returned"/);
  assert.match(cancelOrRefund, /await reconcileCanceledOrRefundedOrderAlerts\(finalOrder\)/);
  assert.match(alertLifecycle, /dedupeKey: `storefront-order:\$\{order\.id\}:paid`/);
  assert.match(alertLifecycle, /suppressedAt: now/);
  assert.match(alertLifecycle, /title: "Order refunded"/);
  assert.match(alertLifecycle, /title: "Order canceled"/);
  assert.match(alertLifecycle, /title: "Order partially refunded"/);
  assert.match(alertLifecycle, /priority: "MEDIUM"/);
});

test("admin orders UI exposes cancel refund modal without replacing fulfillment actions", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const types = readProjectFile("src/types/radar.ts");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontCancelRefundModal");
  const cancelModal = sourceSlice(app, "function StorefrontCancelRefundModal", "function InventoryKpiCard");

  assert.match(types, /refundStatus: string \| null/);
  assert.match(types, /refundedAmount: number/);
  assert.match(types, /refundableAmount: number/);
  assert.match(types, /canCancelOrRefund: boolean/);
  assert.match(orderModal, /Mark Packing/);
  assert.match(orderModal, /Mark Shipped/);
  assert.match(orderModal, /Packing Slip/);
  assert.match(orderModal, /order\.canCancelOrRefund/);
  assert.match(orderModal, /Cancel \/ Refund/);
  assert.match(cancelModal, /Cancellation reason/);
  assert.match(cancelModal, /Out of stock/);
  assert.match(cancelModal, /Customer requested cancellation/);
  assert.match(cancelModal, /Fraud \/ suspicious order/);
  assert.match(cancelModal, /Full refund/);
  assert.match(cancelModal, /Partial refund/);
  assert.match(cancelModal, /No refund/);
  assert.match(cancelModal, /Return purchased items to stock/);
  assert.match(cancelModal, /Send cancellation email to customer/);
  assert.match(cancelModal, /\/api\/radar\/storefront\/orders\/\$\{order\.id\}\/cancel-refund/);
  assert.match(cancelModal, /idempotencyKey/);
  assert.doesNotMatch(cancelModal, /payment_method_details|payment_method_data|card_number|cvv/i);
});

test("admin cancel refund modal confirms success and prevents duplicate submissions", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const submitHelper = sourceSlice(app, "const submit: SubmitHandler", "const runAction: ActionHandler");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontCancelRefundModal");
  const cancelModal = sourceSlice(app, "function StorefrontCancelRefundModal", "function InventoryKpiCard");

  assert.match(submitHelper, /await loadDashboard\(\);\s+await options\.onSuccess\?\.\(result\);/);
  assert.match(submitHelper, /options\.onError\?\.\(message\);/);
  assert.match(orderModal, /order\.canCancelOrRefund && !\(order\.paymentStatus === "paid" && order\.refundableAmount <= 0\)/);
  assert.match(cancelModal, /const \[successOrder, setSuccessOrder\] = useState<StorefrontOrderDTO \| null>\(null\)/);
  assert.match(cancelModal, /const \[localError, setLocalError\] = useState<string \| null>\(null\)/);
  assert.match(cancelModal, /const submittedRef = useRef\(false\)/);
  assert.match(cancelModal, /if \(submittedRef\.current\)/);
  assert.match(cancelModal, /submittedRef\.current = true/);
  assert.match(cancelModal, /disabled=\{busy \|\| processing \|\| submittedRef\.current \|\| !idempotencyKey\}/);
  assert.match(cancelModal, /Processing refund\.\.\./);
  assert.match(cancelModal, /Canceling order\.\.\./);
  assert.match(cancelModal, /onSuccess: \(result\) => setSuccessOrder\(result\.order\)/);
  assert.match(cancelModal, /onError: \(message\) => \{\s+submittedRef\.current = false;\s+setLocalError\(message\);/);
  assert.match(cancelModal, /role="alert"/);
  assert.match(cancelModal, /Order canceled/);
  assert.match(cancelModal, /Refund and order updates were completed\./);
  assert.match(cancelModal, /Full refund created/);
  assert.match(cancelModal, /Partial refund created/);
  assert.match(cancelModal, /No refund required/);
  assert.match(cancelModal, /Items returned to stock/);
  assert.match(cancelModal, /Stock not returned/);
  assert.match(cancelModal, /Stock return not applicable/);
  assert.match(cancelModal, /Cancellation email sent/);
  assert.match(cancelModal, /Email not configured/);
  assert.match(cancelModal, /No customer email on file/);
  assert.match(cancelModal, /Email failed/);
  assert.match(cancelModal, /Done — View Updated Order/);
  assert.match(cancelModal, /This order has no refundable balance remaining\./);
  assert.doesNotMatch(cancelModal, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);
});

test("refunded storefront orders are netted out of sales and revenue summaries", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const service = readProjectFile("src/lib/radar-service.ts");
  const app = readProjectFile("src/components/RadarApp.tsx");
  const inventoryRoute = readProjectFile("src/app/api/radar/inventory/route.ts");
  const storefrontSummary = sourceSlice(storefront, "export async function storefrontSummary", "async function returnOrderInventory");
  const salesLog = sourceSlice(app, "function SalesLog", "function saleProfitStatus");
  const saleCard = sourceSlice(app, "function SaleCard", "function SaleDetailsModal");
  const saleDetails = sourceSlice(app, "function SaleDetailsModal", "function EditSaleModal");

  assert.match(storefront, /const activeRevenuePaymentStatuses = \["paid", "partially_refunded"\]/);
  assert.match(storefront, /function storefrontOrderNetRevenue/);
  assert.match(storefront, /function storefrontOrderNetProfitAfterRefund/);
  assert.match(storefrontSummary, /todaySales: todayPaidOrders\.reduce\(\(sum, order\) => sum \+ storefrontOrderNetRevenue\(order\), 0\)/);
  assert.match(storefrontSummary, /totalRevenue: paidOrders\.reduce\(\(sum, order\) => sum \+ storefrontOrderNetRevenue\(order\), 0\)/);
  assert.match(storefrontSummary, /netProfit: paidOrders\.reduce\(\(sum, order\) => sum \+ storefrontOrderNetProfitAfterRefund\(order\), 0\)/);
  assert.match(storefrontSummary, /paymentStatus: "paid", fulfillmentStatus: \{ in: \["unfulfilled", "packing", "pickup_ready"\] \}/);
  assert.match(service, /export function applyStorefrontOrderAdjustmentsToInventory/);
  assert.match(service, /function storefrontOrderNumberFromSaleNotes/);
  assert.match(service, /saleStatus === "refunded" \|\| saleStatus === "canceled"/);
  assert.match(service, /const activeGrossSale = isFullyInactive \? 0/);
  assert.match(service, /totalSalesGross = allSales\.reduce\(\(sum, sale\) => sum \+ saleActiveGross\(sale\), 0\)/);
  assert.match(service, /export function filterDashboardAlertsForStorefrontOrderStatus/);
  assert.match(service, /isStorefrontPaidFulfillmentAlert/);
  assert.match(service, /alert\.dedupeKey\?\.endsWith\(":paid"\)/);
  assert.match(service, /latestAlerts: dashboardAlerts\.slice\(0, 5\)/);
  assert.match(service, /alerts: dashboardAlerts/);
  assert.match(salesLog, /label="Active Sales"/);
  assert.match(salesLog, /saleState: "ALL"/);
  assert.match(salesLog, /label: "Refunded \/ canceled"/);
  assert.match(saleCard, /Original Sale/);
  assert.match(saleCard, /Refunded/);
  assert.match(saleCard, /Net Revenue/);
  assert.match(saleCard, /saleLifecycleLabel\(sale\)/);
  assert.match(saleDetails, /Original sale amount/);
  assert.match(saleDetails, /Net revenue after refund/);
  assert.match(saleDetails, /Refund status/);
  assert.match(inventoryRoute, /activeQuantitySold/);
  assert.match(inventoryRoute, /originalSaleAmount/);
  assert.match(inventoryRoute, /refundedAmount/);
  assert.match(inventoryRoute, /netRevenueAfterRefund/);
  assert.match(inventoryRoute, /netProfitAfterRefund/);
  assert.match(inventoryRoute, /saleStatus/);
  assert.match(inventoryRoute, /storefrontOrderNumber/);
  assert.match(inventoryRoute, /sale\.activeProfitLoss/);
  assert.doesNotMatch([storefrontSummary, salesLog, saleCard, saleDetails, inventoryRoute].join("\n"), /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);
});
