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
  const sessionCreateParams = sourceSlice(
    createCheckoutSession,
    "const session = await stripe.checkout.sessions.create({",
    "    });"
  );

  assert.match(createCheckoutSession, /const \[settings, profileDefinitions\] = await Promise\.all\(/);
  assert.match(createCheckoutSession, /const cart = await getCartProducts\(input\.items, \{ profileDefinitions \}\)/);
  assert.match(storefront, /const reservationMinutes = 15/);
  assert.match(storefront, /const stripeCheckoutExpirationMinutes = 30/);
  assert.match(storefront, /function checkoutReservationExpiresAt\(now = new Date\(\)\)/);
  assert.match(storefront, /function stripeCheckoutSessionExpiresAt\(now = new Date\(\)\)/);
  assert.match(storefront, /async function createCheckoutReservations/);
  assert.match(createCheckoutSession, /const checkoutStartedAt = new Date\(\)/);
  assert.match(createCheckoutSession, /const reservationExpiresAt = checkoutReservationExpiresAt\(checkoutStartedAt\)/);
  assert.match(createCheckoutSession, /await createCheckoutReservations\(tx, created\.id, cart, reservationExpiresAt\)/);
  assert.match(createCheckoutSession, /internalReservationExpiresAt: reservationExpiresAt\.toISOString\(\)/);
  assert.match(createCheckoutSession, /internalReservationMinutes: String\(reservationMinutes\)/);
  assert.match(sessionCreateParams, /expires_at: stripeCheckoutSessionExpiresAt\(checkoutStartedAt\)/);
  assert.match(createCheckoutSession, /data: \{ stripeCheckoutSessionId: session\.id \}/);
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
  const getCartProducts = sourceSlice(storefront, "export async function getCartProducts", "function checkoutReservationExpiresAt");
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

  assert.match(createCheckoutSession, /await cleanupExpiredReservationsForCheckoutOnly\(checkoutStartedAt\);\s+const cart = await getCartProducts\(input\.items, \{ profileDefinitions \}\)/);
  assert.match(createCheckoutSession, /validateCheckoutReservationAvailability\(cart, checkoutStartedAt\)/);
  assert.doesNotMatch(getCartProducts, /reservations:\s*\{\s*create/);
});

test("Stripe webhook handlers verify raw request bodies before trusting events", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const currentWebhookRoute = readProjectFile("src/app/api/storefront/webhook/stripe/route.ts");
  const legacyWebhookRoute = readProjectFile("src/app/api/storefront/stripe/webhook/route.ts");
  const webhookRouteHelper = readProjectFile("src/lib/stripe-webhook-route.ts");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );
  const processStripeWebhookEvent = sourceSlice(
    storefront,
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
  );
  for (const route of [currentWebhookRoute, legacyWebhookRoute]) {
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /handleStripeWebhookRequest\(request\)/);
    assert.doesNotMatch(route, /await request\.json\(\)/);
  }
  assert.match(webhookRouteHelper, /const rawBody = await request\.text\(\)/);
  assert.match(webhookRouteHelper, /request\.headers\.get\("stripe-signature"\)/);
  assert.match(webhookRouteHelper, /handleStripeWebhook\(rawBody, signature\)/);

  const verifyIndex = handleStripeWebhook.indexOf("webhooks.constructEvent(rawBody, signature, secret)");
  const eventStoreIndex = handleStripeWebhook.indexOf("await claimProviderEvent");
  const processIndex = handleStripeWebhook.indexOf("await processStripeWebhookEvent(event, order)");

  assert.ok(verifyIndex >= 0, "webhook signature verification is missing");
  assert.ok(eventStoreIndex > verifyIndex, "payment event storage must happen after signature verification");
  assert.ok(processIndex > verifyIndex, "verified event processing must happen after signature verification");
  assert.match(processStripeWebhookEvent, /event\.type === "checkout\.session\.completed"/);
});

test("checkout.session.completed only persists paid orders", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
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
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
  );

  assert.match(storefront, /const event = stripeClient\(\)\.webhooks\.constructEvent\(rawBody, signature, secret\)/);
  assert.match(handleStripeWebhook, /if \(receivedSession\.payment_status !== "paid"\) return \{ ok: true, skipped: "checkout_session_not_paid" \}/);
  assert.match(handleStripeWebhook, /if \(!persisted\.persisted\) return \{ ok: true, skipped: "checkout_session_state_changed" \}/);
  assert.match(handleStripeWebhook, /if \(order\.paymentStatus !== "paid"\) \{\s*await createStorefrontSale\(order\);\s*order = await loadFreshStorefrontOrder\(order\.id\);\s*\}/);
  assert.match(storefront, /async function loadFreshStorefrontOrder\(orderId: string\) \{\s*return prisma\.storefrontOrder\.findUniqueOrThrow\(\{ where: \{ id: orderId \}, include: storefrontOrderInclude \}\);\s*\}/);
  assert.match(createStorefrontSale, /prisma\.\$transaction/);
  assert.match(createStorefrontSale, /tx\.storefrontOrder\.updateMany/);
  assert.match(createStorefrontSale, /where: \{ id: order\.id, paymentStatus: \{ not: "paid" \} \}/);
  assert.match(createStorefrontSale, /if \(claimed\.count === 0\) return \{ created: false/);
  assert.match(createStorefrontSale, /tx\.inventoryStockLot\.update/);
  assert.match(createStorefrontSale, /remainingQuantity: lot\.remainingQuantity - quantityFromLot/);
  assert.match(createStorefrontSale, /tx\.inventorySale\.create/);
  assert.match(createStorefrontSale, /quantitySold: orderItem\.quantity/);
  assert.match(createStorefrontSale, /completeReservationsForSessionInTransaction\(tx, order\.stripeCheckoutSessionId, order\.id\)/);
  assert.match(storefront, /export async function completeReservationsForSession\(stripeCheckoutSessionId: string \| null \| undefined, orderId\?: string \| null\)/);
  assert.match(storefront, /data: \{ status: "completed" \}/);
  assert.match(createStorefrontSale, /status: "inventory_review"/);
  assert.match(createStorefrontSale, /fulfillmentStatus: "review_required"/);
  assert.match(createStorefrontSale, /Paid order needs inventory review/);
});

test("checkout.session.completed reloads fresh paid order state before post-payment side effects", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
  );
  const paidSideEffects = sourceSlice(
    storefront,
    "async function completePaidCheckoutSideEffects",
    "export async function applyStripeRefundSnapshot"
  );

  const persistIndex = handleStripeWebhook.indexOf("order = persisted.order");
  const createSaleIndex = handleStripeWebhook.indexOf("await createStorefrontSale(order)");
  const reloadIndex = handleStripeWebhook.indexOf("order = await loadFreshStorefrontOrder(order.id)", createSaleIndex);
  const sideEffectIndex = handleStripeWebhook.indexOf("await completePaidCheckoutSideEffects(order)", reloadIndex);

  assert.ok(persistIndex >= 0, "webhook must use the persisted Stripe session snapshot");
  assert.ok(createSaleIndex > persistIndex, "sale finalization must run after the Stripe session snapshot is persisted");
  assert.ok(reloadIndex > createSaleIndex, "order must be reloaded after sale finalization changes paid state in the database");
  assert.ok(sideEffectIndex > reloadIndex, "paid side effects must use the fresh paid order state, not the stale pre-sale object");
  assert.match(paidSideEffects, /await awardRewardsForPaidOrder\(order\)/);
  assert.match(paidSideEffects, /await sendStorefrontOrderConfirmationEmail\(await loadFreshStorefrontOrder\(order\.id\)\)/);
  assert.doesNotMatch(handleStripeWebhook, /createStorefrontSale\(order\);\s*if \(!wasPaid && order\.paymentStatus === "paid"\)/);
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
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
  );

  assert.match(releaseOrderReservations, /return releaseReservationsForSession\(null, orderId\)/);
  assert.match(storefront, /export async function releaseReservationsForSession\(stripeCheckoutSessionId: string \| null \| undefined, orderId\?: string \| null, now = new Date\(\)\)/);
  assert.match(storefront, /data: \{ status: "released", releasedAt: now \}/);
  assert.match(markStorefrontOrderPaymentFailed, /if \(order\.paymentStatus === "paid"\) return \{ released: 0, skipped: "already_paid" as const \}/);
  assert.match(markStorefrontOrderPaymentFailed, /await releaseReservationsForSession\(order\.stripeCheckoutSessionId, order\.id\)/);
  assert.match(handleStripeWebhook, /event\.type === "checkout\.session\.expired"/);
  assert.match(handleStripeWebhook, /markStorefrontOrderPaymentFailed\(order, "expired"/);
  assert.match(handleStripeWebhook, /event\.type === "checkout\.session\.async_payment_failed" \|\| event\.type === "payment_intent\.payment_failed"/);
  assert.match(handleStripeWebhook, /markStorefrontOrderPaymentFailed\(order, "failed"/);
  assert.match(releaseUnpaidCheckoutOrder, /if \(order\.paymentStatus === "paid"\) return \{ ok: true, released: false, reason: "already_paid" \}/);
  assert.match(releaseUnpaidCheckoutOrder, /await markStorefrontOrderPaymentFailed\(order, "failed", "Stripe Checkout was canceled before payment completed\."\)/);
  assert.doesNotMatch(releaseUnpaidCheckoutOrder, /prisma\.inventorySale\.create|prisma\.inventoryStockLot\.update|paymentStatus: "paid"/);
  assert.match(cancelPage, /releaseUnpaidCheckoutOrder\(params\.order\)/);
  assert.match(cancelPage, /Your checkout session expired\. Your items were released back to inventory\. You can start checkout again if they are still available\./);
});

test("15-minute checkout holds are expired by a protected reservation cron without touching real stock", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const route = readProjectFile("src/app/api/radar/storefront/reservations/expire/route.ts");
  const vercel = readProjectFile("vercel.json");
  const expireHelper = sourceSlice(storefront, "export async function expireOpenStripeSessionsForExpiredReservations", "export async function releaseUnpaidCheckoutOrder");

  assert.match(expireHelper, /where: \{ status: "reserved", expiresAt: \{ lte: now \} \}/);
  assert.match(expireHelper, /stripe\.checkout\.sessions\.retrieve\(group\.stripeCheckoutSessionId\)/);
  assert.match(expireHelper, /session\.status === "open"/);
  assert.match(expireHelper, /stripe\.checkout\.sessions\.expire\(group\.stripeCheckoutSessionId\)/);
  assert.match(expireHelper, /markStorefrontOrderPaymentFailed\(order, "expired", "GameDayGrabs 15-minute checkout reservation expired\."\)/);
  assert.match(expireHelper, /releaseReservationsForSession\(group\.stripeCheckoutSessionId, group\.orderId\)/);
  assert.doesNotMatch(expireHelper, /inventoryStockLot\.update|inventoryItem\.update|inventorySale\.create|quantitySold|remainingQuantity:\s*lot\.remainingQuantity -/);

  assert.match(route, /MONITOR_JOB_SECRET/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /expireOpenStripeSessionsForExpiredReservations/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(vercel, /"path": "\/api\/radar\/storefront\/reservations\/expire"/);
  assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
});

test("duplicate Stripe sessions and events do not duplicate orders or customer totals", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const orderForStripeEvent = sourceSlice(storefront, "async function orderForStripeEvent", "type StripeAddressLike");
  const createStorefrontSale = sourceSlice(storefront, "async function createStorefrontSale", "async function releaseOrderReservations");
  const persistPaidCheckoutSession = sourceSlice(storefront, "async function persistPaidCheckoutSession", "async function processStripeWebhookEvent");
  const syncStorefrontCustomerTotals = sourceSlice(storefront, "async function syncStorefrontCustomerTotals", "async function persistPaidCheckoutSession");
  const concurrency = readProjectFile("src/lib/tax-refund-concurrency.ts");
  const sendCustomerEmailNotificationOnce = sourceSlice(storefront, "async function sendCustomerEmailNotificationOnce", "async function sendStorefrontOrderConfirmationEmail");
  const handleStripeWebhook = sourceSlice(
    storefront,
    "async function processStripeWebhookEvent",
    "export async function handleStripeWebhook"
  );

  assert.match(schema, /stripeCheckoutSessionId\s+String\?\s+@unique/);
  assert.match(schema, /eventId\s+String\s+@unique/);
  assert.match(orderForStripeEvent, /stripeCheckoutSessionId: object\.id/);
  assert.match(persistPaidCheckoutSession, /prisma\.storefrontOrder\.updateMany\(\{/);
  assert.doesNotMatch(persistPaidCheckoutSession, /prisma\.storefrontOrder\.create/);
  assert.match(concurrency, /client\.paymentEvent\.create/);
  assert.match(concurrency, /where: \{ eventId: input\.eventId \}/);
  assert.match(concurrency, /eventType: `processing:\$\{input\.eventType\}`/);
  assert.match(sendCustomerEmailNotificationOnce, /prisma\.paymentEvent\.findUnique\(\{ where: \{ eventId: input\.eventId \} \}\)/);
  assert.match(sendCustomerEmailNotificationOnce, /createCustomerEmailEventClaim\(\{ eventId: input\.eventId, order: input\.order, kind: input\.kind, recipient \}\)/);
  assert.match(storefront, /eventId: customerEmailEventId\("order_confirmation", order\.id\)/);
  assert.match(handleStripeWebhook, /if \(!persisted\.persisted\) return \{ ok: true, skipped: "checkout_session_state_changed" \}/);
  assert.match(handleStripeWebhook, /if \(order\.paymentStatus !== "paid"\) \{\s*await createStorefrontSale\(order\);\s*order = await loadFreshStorefrontOrder\(order\.id\);\s*\}/);
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
  const customerSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-order-customer-card">', "<h3>Ship To</h3>");
  const shipToSection = sourceSlice(orderModal, "<h3>Ship To</h3>", "<h3>Items</h3>");

  assert.match(app, /function formatStorefrontAddressLines/);
  assert.match(app, /className="storefront-address-lines"/);
  assert.match(css, /\.storefront-address-lines \{[\s\S]*display: grid;[\s\S]*gap: 2px;/);
  assert.match(customerSection, /\{order\.customerEmail \|\| "Not provided"\}/);
  assert.match(customerSection, /\{order\.customerPhone \|\| "Not provided"\}/);
  assert.match(customerSection, /value=\{order\.stripeCustomerId \|\| "Not provided"\}/);
  assert.match(shipToSection, /<StorefrontAddressLines address=\{order\.shippingAddress\} \/>/);
  assert.match(shipToSection, /<StorefrontAddressLines address=\{order\.billingAddress\} \/>/);
  assert.match(shipToSection, /Same as shipping/);
  assert.match(shipToSection, /Copy Address/);
  assert.doesNotMatch(customerSection, /email not saved|Not saved|Not collected|Not stored|JSON\.stringify|<pre|<code/);
  assert.doesNotMatch(shipToSection, /email not saved|Not saved|Not collected|Not stored|JSON\.stringify|<pre|<code/);
});

test("Admin Orders renders an operational shipping section without raw payment details", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontCancelRefundModal");
  const shippingSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-shipping-section">', "<section className=\"storefront-order-workspace-card\">");
  const storefrontSummary = sourceSlice(storefront, "export async function storefrontSummary", "async function returnOrderInventory");

  assert.match(app, /function formatShippingPackageWeight/);
  assert.match(app, /function formatShippingPackageProfile/);
  assert.match(app, /function formatShippingPackageDimensions/);
  assert.match(app, /function storefrontOrderShippingProfitLoss/);
  assert.match(app, /order\.shippingCharged - order\.shippingCost/);
  assert.match(app, /function storefrontOrderShippingReadiness/);

  assert.match(shippingSection, /<h3>Fulfillment<\/h3>/);
  assert.match(shippingSection, /Shipping method/);
  assert.match(shippingSection, /Shipping charged/);
  assert.match(shippingSection, /Package weight/);
  assert.match(shippingSection, /Package profile/);
  assert.match(shippingSection, /Actual shipping cost/);
  assert.match(shippingSection, /Carrier/);
  assert.match(shippingSection, /Tracking number/);
  assert.match(shippingSection, /Fulfillment status/);
  assert.match(shippingSection, /name="shippingCost"/);
  assert.match(shippingSection, /name="carrier"/);
  assert.match(shippingSection, /name="trackingNumber"/);
  assert.match(shippingSection, /Mark Shipped requires carrier and tracking number/);
  assert.match(shippingSection, /Save Fulfillment/);
  assert.match(orderModal, /const canFulfillOrder = storefrontOrderCanFulfill\(order\)/);
  assert.match(orderModal, /const canShipOrder = storefrontOrderCanShip\(order\)/);
  assert.match(orderModal, /const canPickupOrder = storefrontOrderCanPickup\(order\)/);
  assert.match(orderModal, /const shipmentDetailsSaved = storefrontOrderHasShipmentDetails\(order\)/);
  assert.match(orderModal, /Print\/View Packing Slip/);
  assert.match(orderModal, /Print\/View Pickup Slip/);
  assert.match(orderModal, /View Packing Slip Preview/);
  assert.match(orderModal, /<StorefrontPackingSlip order=\{order\} \/>/);
  assert.match(orderModal, /\{canPickupOrder \? \(/);
  assert.match(orderModal, /Only active paid orders can be marked packing, shipped, ready for pickup, or picked up/);
  assert.match(orderModal, /Enter carrier and tracking number before marking shipped\./);
  assert.doesNotMatch(shippingSection, /JSON\.stringify\(order|<pre|<code|payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);

  assert.match(css, /storefront-shipping-section/);
  assert.match(css, /storefront-shipping-form/);
  assert.match(css, /storefront-fulfillment-snapshot/);

  assert.match(storefrontSummary, /ordersToShipCount/);
  assert.match(storefrontSummary, /pickupOrderCount/);
  assert.match(storefrontSummary, /NOT: localPickupOrderWhere/);
  assert.match(storefrontSummary, /\.\.\.localPickupOrderWhere/);
  assert.doesNotMatch(storefrontSummary, /prisma\.storefrontOrder\.count\(\{ where: \{ [^}]*paymentStatus: \{ in: activeRevenuePaymentStatuses \}/);
});

test("Admin order detail uses separated item metadata and compact timeline layout", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");
  const itemsSection = sourceSlice(orderModal, "<h3>Items</h3>", '<section className="storefront-order-workspace-card storefront-shipping-section">');
  const timelineSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-order-timeline-card">', '<section className="storefront-order-workspace-card storefront-order-notes-section">');

  assert.match(itemsSection, /className="storefront-order-item-image"/);
  assert.match(itemsSection, /className="storefront-order-item-copy"/);
  assert.match(itemsSection, /className="storefront-order-item-title"/);
  assert.match(itemsSection, /className="storefront-order-item-metadata"/);
  assert.match(itemsSection, /<span>UPC\/SKU<\/span>/);
  assert.match(itemsSection, /<span>SKU\/TCIN\/DPCI<\/span>/);
  assert.match(itemsSection, /<span>Cost and profit<\/span>/);
  assert.match(itemsSection, /className="storefront-order-item-metrics"/);
  assert.doesNotMatch(itemsSection, /<strong>\{item\.publicTitle\}<\/strong>\s*<small>SKU\/UPC:/);
  assert.doesNotMatch(itemsSection, /SKU\/UPC:[\s\S]*SKU\/TCIN:[\s\S]*Cost basis/);

  assert.match(timelineSection, /className=\{entry\.at \? "complete" : "pending"\}/);
  assert.match(css, /\.storefront-order-timeline \{[\s\S]*display: grid;[\s\S]*gap: 0;/);
  assert.match(css, /\.storefront-order-timeline article \{[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\);[\s\S]*border-bottom: 1px solid #edf2f7;/);
  assert.match(css, /\.storefront-order-timeline article\.pending/);
  assert.doesNotMatch(css, /\.storefront-order-timeline \{[\s\S]{0,220}repeat\(auto-fit/);
  assert.match(css, /\.storefront-order-item-metadata small \{[\s\S]*grid-template-columns: minmax\(98px, auto\) minmax\(0, 1fr\);/);
  assert.match(css, /body \.inventory-details-modal\.storefront-order-workspace \{[\s\S]*width: 100vw;[\s\S]*height: 100svh;[\s\S]*border-radius: 0;/);
});

test("archived order detail is read-only while active fulfillment controls are preserved", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");
  const shippingSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-shipping-section">', "<section className=\"storefront-order-workspace-card\">");
  const fulfillmentSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-order-notes-section">', "<details className=\"storefront-order-advanced-details\">");
  const primaryWorkspace = sourceSlice(orderModal, '<div className="storefront-order-workspace-grid">', '<details className="storefront-order-advanced-details">');
  const advancedDetails = sourceSlice(orderModal, '<details className="storefront-order-advanced-details">', "</details>");
  const updateStorefrontOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");

  assert.match(app, /function storefrontOrderDetailIsReadOnly\(order: StorefrontOrderDTO\)/);
  assert.match(app, /const reviewLocked = order\.status === "inventory_review" \|\| order\.fulfillmentStatus === "review_required"/);
  assert.match(app, /storefrontOrderIsCanceledOrRefunded\(order\) \|\| \(reviewLocked && !storefrontOrderCanFulfill\(order\)\)/);
  assert.match(app, /function storefrontOrderReadOnlyDetailMessage/);
  assert.match(app, /This order is canceled\/refunded\/expired and is kept for history\./);
  assert.match(orderModal, /const orderDetailReadOnly = storefrontOrderDetailIsReadOnly\(order\)/);
  assert.match(orderModal, /const readOnlyDetailMessage = storefrontOrderReadOnlyDetailMessage\(order\)/);

  assert.match(orderModal, /const canFulfillOrder = storefrontOrderCanFulfill\(order\)/);
  assert.match(orderModal, /const canShowPackingSlip = order\.items\.length > 0 && \(canFulfillOrder \|\| orderDetailReadOnly \|\| order\.fulfillmentStatus === "shipped" \|\| order\.fulfillmentStatus === "picked_up"\)/);
  assert.match(orderModal, /storefront-order-workspace-backdrop/);
  assert.match(orderModal, /storefront-order-workspace-header/);
  assert.match(orderModal, /storefront-order-action-bar/);
  assert.match(orderModal, /storefront-order-workspace-grid/);
  assert.match(orderModal, /localPickupOrder[\s\S]*\? "Print\/View Pickup Slip"[\s\S]*: "Print\/View Packing Slip"/);
  assert.match(orderModal, /localPickupOrder[\s\S]*\? "View Pickup Slip Preview"[\s\S]*: "View Packing Slip Preview"/);
  assert.match(orderModal, /\{canPickupOrder \? \(/);
  assert.match(orderModal, /\) : canShipOrder \? \(/);
  assert.match(orderModal, /Mark Packing/);
  assert.match(orderModal, /Mark Shipped/);

  assert.match(orderModal, /className="storefront-archived-detail-card"/);
  assert.match(orderModal, /Archived order/);
  assert.match(orderModal, /Fulfillment not available/);
  assert.match(orderModal, /<p>\{readOnlyDetailMessage\}<\/p>/);
  assert.match(orderModal, /Shipping method/);
  assert.match(orderModal, /Shipping charged/);
  assert.match(orderModal, /Refunded amount/);
  assert.match(orderModal, /Net revenue/);

  assert.match(shippingSection, /\{orderDetailReadOnly \? \([\s\S]*className="storefront-shipping-readonly-summary"[\s\S]*Shipping and fulfillment are read-only for this historical order\.[\s\S]*\) : localPickupOrder \? \(/);
  assert.match(shippingSection, /This order is for local pickup\. No carrier or tracking is required\./);
  assert.match(shippingSection, /name="carrier"/);
  assert.match(shippingSection, /name="trackingNumber"/);
  assert.match(shippingSection, /name="shippingCost"/);
  assert.match(shippingSection, /Save Fulfillment/);
  assert.match(fulfillmentSection, /\{orderDetailReadOnly \? \([\s\S]*className="storefront-fulfillment-readonly-summary"[\s\S]*Order status[\s\S]*Fulfillment status[\s\S]*Order notes[\s\S]*\) : \([\s\S]*<form/);
  assert.match(fulfillmentSection, /name="status"/);
  assert.match(fulfillmentSection, /name="notes"/);
  assert.match(fulfillmentSection, /Save Fulfillment/);
  assert.match(primaryWorkspace, /Customer/);
  assert.match(primaryWorkspace, /Ship To/);
  assert.match(primaryWorkspace, /Items/);
  assert.match(primaryWorkspace, /Payment Summary/);
  assert.match(primaryWorkspace, /Profit Summary/);
  assert.match(primaryWorkspace, /Shipping Summary/);
  assert.match(primaryWorkspace, /Customer Notifications/);
  assert.match(primaryWorkspace, /Timeline/);
  assert.doesNotMatch(primaryWorkspace, /Stripe session|Payment intent|Payment Verification|Inventory Reservations/);
  assert.match(advancedDetails, /Advanced Details/);
  assert.match(advancedDetails, /Stripe session/);
  assert.match(advancedDetails, /Payment intent/);
  assert.match(advancedDetails, /Payment Verification/);
  assert.match(advancedDetails, /Inventory Reservations/);

  assert.match(updateStorefrontOrder, /Canceled, refunded, or expired orders cannot be marked packing, shipped, ready for pickup, or picked up\./);
  assert.match(updateStorefrontOrder, /Only paid orders can be marked packing, shipped, ready for pickup, or picked up\./);
  assert.match(updateStorefrontOrder, /Pickup statuses are only available for local pickup orders\./);
  assert.match(updateStorefrontOrder, /Local pickup orders do not require shipping\. Mark them ready for pickup or picked up instead\./);
  assert.match(updateStorefrontOrder, /Carrier and tracking number are required before marking an order shipped\./);
  assert.match(css, /storefront-archived-detail-card/);
  assert.match(css, /storefront-shipping-readonly-summary/);
  assert.match(css, /storefront-fulfillment-readonly-summary/);
  assert.match(css, /storefront-order-workspace/);
  assert.match(css, /storefront-order-workspace-grid/);
  assert.match(css, /storefront-order-advanced-details/);
  assert.doesNotMatch(orderModal, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
});

test("local pickup orders use pickup fulfillment queues instead of shipping queues", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const types = readProjectFile("src/types/radar.ts");
  const orderTabs = sourceSlice(app, "type StorefrontOrderTab", "function StorefrontOrdersPanel");
  const orderPanel = sourceSlice(app, "function StorefrontOrdersPanel", "function StorefrontSettingsCard");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");
  const shippingSection = sourceSlice(orderModal, '<section className="storefront-order-workspace-card storefront-shipping-section">', '<section className="storefront-order-workspace-card">');
  const storefrontSummary = sourceSlice(storefront, "export async function storefrontSummary", "async function returnOrderInventory");
  const updateStorefrontOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");

  assert.match(types, /isLocalPickup: boolean/);
  assert.match(types, /pickupOrderCount: number/);
  assert.match(storefront, /function orderIsLocalPickup/);
  assert.match(storefront, /orderIsLocalPickup\(order\) && \["unfulfilled", "pickup_ready"\]\.includes\(order\.fulfillmentStatus\)/);
  assert.match(storefront, /return "Ready for Pickup"/);
  assert.match(storefront, /return "Picked Up"/);

  assert.match(storefrontSummary, /const localPickupOrderWhere/);
  assert.match(storefrontSummary, /paymentStatus: "paid"[\s\S]*fulfillmentStatus: "unfulfilled"[\s\S]*NOT: localPickupOrderWhere/);
  assert.match(storefrontSummary, /ordersToShipCount/);
  assert.match(storefrontSummary, /pickupOrderCount/);
  assert.match(storefrontSummary, /NOT: localPickupOrderWhere/);
  assert.match(storefrontSummary, /fulfillmentStatus: \{ in: \["unfulfilled", "packing"\] \}/);
  assert.match(storefrontSummary, /fulfillmentStatus: \{ in: \["unfulfilled", "pickup_ready"\] \}/);
  assert.match(storefrontSummary, /\.\.\.localPickupOrderWhere/);

  assert.match(app, /function storefrontOrderIsLocalPickup/);
  assert.match(app, /function storefrontOrderCanShip/);
  assert.match(app, /function storefrontOrderCanPickup/);
  assert.match(app, /function storefrontOrderFulfillmentLabel/);
  assert.match(orderTabs, /"pickup"/);
  assert.match(orderTabs, /tab === "new"[\s\S]*!storefrontOrderIsLocalPickup\(order\)/);
  assert.match(orderTabs, /Pickup Orders/);
  assert.match(orderTabs, /Paid local pickup orders that do not need carrier shipment\./);
  assert.match(orderPanel, /label="Pickup Orders"/);
  assert.match(orderPanel, /detail="Paid local pickup"/);
  assert.match(orderPanel, /Ready for Pickup/);
  assert.match(orderPanel, /Picked Up/);
  assert.doesNotMatch(sourceSlice(orderPanel, "{canPickup ? (", ") : canShip ? ("), /Shipped|Mark Shipped|carrier and tracking/i);

  assert.match(orderModal, /Mark Ready for Pickup/);
  assert.match(orderModal, /Mark Picked Up/);
  assert.match(orderModal, /Local pickup order\. No carrier or tracking is required\./);
  assert.match(orderModal, /Print\/View Pickup Slip/);
  assert.match(orderModal, /View Pickup Slip Preview/);
  assert.match(shippingSection, /Fulfillment method/);
  assert.match(shippingSection, /Tracking/);
  assert.match(shippingSection, /Not required/);
  assert.match(shippingSection, /This order is for local pickup\. No carrier or tracking is required\./);
  assert.match(orderModal, /Pickup notification not sent/);

  assert.match(updateStorefrontOrder, /\["packing", "shipped", "pickup_ready", "picked_up"\]/);
  assert.match(updateStorefrontOrder, /requestsPickupStatus/);
  assert.match(updateStorefrontOrder, /Pickup statuses are only available for local pickup orders\./);
  assert.match(updateStorefrontOrder, /Local pickup orders do not require shipping\. Mark them ready for pickup or picked up instead\./);
  assert.match(updateStorefrontOrder, /nextFulfillmentStatus === "pickup_ready"/);
  assert.match(updateStorefrontOrder, /sendStorefrontLocalPickupEmail\(finalOrder\)/);
  assert.doesNotMatch([orderPanel, orderModal, storefront].join("\n"), /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw webhook/i);
});

test("packing slip renders safe order data and excludes payment details", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const types = readProjectFile("src/types/radar.ts");
  const packingSlip = sourceSlice(app, "function StorefrontPackingSlip", "function StorefrontCancelRefundModal");

  assert.match(types, /shippedAt: string \| null/);
  assert.match(packingSlip, /GameDayGrabs/);
  assert.match(packingSlip, /Packing Slip/);
  assert.match(packingSlip, /order\.orderNumber/);
  assert.match(packingSlip, /dateTime\(order\.createdAt\)/);
  assert.match(packingSlip, /Ship to/);
  assert.match(packingSlip, /order\.customerName/);
  assert.match(packingSlip, /formatStorefrontAddressLines\(order\.shippingAddress\)/);
  assert.match(packingSlip, /Items to pack/);
  assert.match(packingSlip, /item\.publicTitle/);
  assert.match(packingSlip, /SKU \$\{item\.sku\}/);
  assert.match(packingSlip, /UPC \$\{item\.upc\}/);
  assert.match(packingSlip, /Qty \{item\.quantity\}/);
  assert.match(packingSlip, /Packing checklist/);
  assert.match(packingSlip, /Package note area/);
  assert.match(packingSlip, /Thank you for supporting GameDayGrabs/);
  assert.match(packingSlip, /gamedaygrabs@outlook\.com/);
  assert.doesNotMatch(packingSlip, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|stripePaymentIntentId|stripeCheckoutSessionId/i);

  assert.match(css, /packing-slip-preview-shell/);
  assert.match(css, /packing-slip-print/);
  assert.match(css, /packing-slip-card/);
  assert.match(css, /body:has\(\.packing-slip-print\)[\s\S]*\.packing-slip-print/);
});

test("Admin Orders shows read-only workflow timers for every order state", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const types = readProjectFile("src/types/radar.ts");
  const timerHelpers = sourceSlice(app, "function formatOrderDuration", "function reservationLifecycleLabel");
  const orderPanel = sourceSlice(app, "function StorefrontOrdersPanel", "function StorefrontSettingsCard");
  const timerTick = sourceSlice(orderPanel, "useEffect(() => {", "  return (");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");

  assert.match(types, /paidAt: string \| null/);
  assert.match(types, /shippedAt: string \| null/);
  assert.match(types, /canceledAt: string \| null/);
  assert.match(types, /refundedAt: string \| null/);
  assert.match(storefront, /canceledAt: order\.canceledAt\?\.toISOString\(\) \?\? null/);
  assert.match(storefront, /refundedAt: order\.refundedAt\?\.toISOString\(\) \?\? null/);

  assert.match(app, /type OrderTimerState = \{/);
  assert.match(timerHelpers, /function formatOrderDuration/);
  assert.match(timerHelpers, /function getOrderTimerState\(order: StorefrontOrderDTO, nowMs = Date\.now\(\)\): OrderTimerState/);
  assert.match(timerHelpers, /ORDER_TIMER_MINUTE_MS/);
  assert.match(timerHelpers, /ORDER_TIMER_HOUR_MS/);
  assert.match(timerHelpers, /ORDER_TIMER_DAY_MS/);
  assert.match(timerHelpers, /return `\$\{totalMinutes\}m`/);
  assert.match(timerHelpers, /`\$\{hours\}h \$\{minutes\}m`/);
  assert.match(timerHelpers, /`\$\{days\}d \$\{hours\}h`/);
  assert.match(timerHelpers, /shortPrefix: "Pending"/);
  assert.match(timerHelpers, /detailPrefix: "Pending payment"/);
  assert.match(timerHelpers, /shortPrefix: "Open"/);
  assert.match(timerHelpers, /shortPrefix: "Packing"/);
  assert.match(timerHelpers, /shortPrefix: "Pickup pending"/);
  assert.match(timerHelpers, /shortPrefix: "Ready"/);
  assert.match(timerHelpers, /shortPrefix: "Picked up"/);
  assert.match(timerHelpers, /shortPrefix: "Shipped"/);
  assert.match(timerHelpers, /shortPrefix: "Requested"/);
  assert.match(timerHelpers, /shortPrefix: "Expired"/);
  assert.match(timerHelpers, /shortPrefix: "Canceled"/);
  assert.match(timerHelpers, /shortPrefix: "Partially refunded"/);
  assert.match(timerHelpers, /const refundLabel = .*"Refunded"/);
  assert.match(timerHelpers, /afterPayment: true/);
  assert.match(timerHelpers, /tone: "neutral"/);

  assert.match(orderPanel, /const \[orderTimerNow, setOrderTimerNow\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(timerTick, /window\.setInterval\(\(\) => setOrderTimerNow\(Date\.now\(\)\), ORDER_TIMER_MINUTE_MS\)/);
  assert.match(orderPanel, /window\.clearInterval\(orderTimerTick\)/);
  assert.doesNotMatch(timerTick, /requestJson|fetch|prisma|PATCH|POST|PUT|DELETE/i);
  assert.match(orderPanel, /const timerState = getOrderTimerState\(order, orderTimerNow\)/);
  assert.match(orderPanel, /storefront-order-timer-chip/);
  assert.match(orderPanel, /timerState\.shortLabel/);
  assert.match(orderPanel, /timerNow=\{orderTimerNow\}/);

  assert.match(orderModal, /timerNow: number/);
  assert.match(orderModal, /const timerState = getOrderTimerState\(order, timerNow\)/);
  assert.match(orderModal, /storefront-order-workflow-timer/);
  assert.match(orderModal, /timerState\.label/);
  assert.match(orderModal, /timerState\.shortLabel/);
  assert.match(css, /storefront-order-timer-chip/);
  assert.match(css, /storefront-order-workflow-timer/);
  assert.doesNotMatch(timerHelpers + timerTick + orderModal, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe|raw webhook/i);
});

test("checkout customer records never persist raw card or payment method details", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const schema = readProjectFile("prisma/schema.prisma");
  const types = readProjectFile("src/types/radar.ts");
  const safeStripeEventPayload = sourceSlice(storefront, "function safeStripeEventPayload", "function checkoutCustomerSnapshot");
  const storefrontModels = sourceSlice(schema, "model StorefrontCustomer", "model Fulfillment");
  const storefrontOrderTypes = sourceSlice(types, "export type StorefrontAddressDTO", "export type StorefrontSummaryDTO");

  for (const source of [storefront, safeStripeEventPayload, storefrontModels, storefrontOrderTypes]) {
    assert.doesNotMatch(source, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);
  }
  assert.match(safeStripeEventPayload, /provider: "stripe"/);
  assert.match(safeStripeEventPayload, /stripeCustomerId: stripeIdFromUnknown\(object\.customer\)/);
  assert.match(safeStripeEventPayload, /customerPhone: stringValue\(customerDetails\?\.phone\)/);
});

test("customer lifecycle emails are idempotent and visible without payment details", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const types = readProjectFile("src/types/radar.ts");
  const emailTemplates = readProjectFile("src/lib/storefront-email-templates.ts");
  const webhook = sourceSlice(storefront, "async function processStripeWebhookEvent", "export async function handleStripeWebhook");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const updateOrder = sourceSlice(storefront, "export async function updateStorefrontOrder");
  const emailHelpers = sourceSlice(storefront, "type CustomerEmailStatus", "function stripeImage");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");

  assert.match(types, /export type StorefrontEmailNotificationDTO/);
  assert.match(types, /customerEmailNotifications: StorefrontEmailNotificationDTO\[\]/);
  assert.match(types, /detail: string \| null/);
  assert.match(emailHelpers, /type CustomerEmailStatus = "sent" \| "not_configured" \| "missing_customer_email" \| "failed" \| "skipped"/);
  assert.match(emailHelpers, /function customerEmailEventId/);
  assert.match(emailHelpers, /function customerEmailProviderMetadata/);
  assert.match(emailHelpers, /"X-Entity-Ref-ID"/);
  assert.match(emailHelpers, /"X-GDD-Notification-Type"/);
  assert.match(emailHelpers, /"X-GDD-Order-Number"/);
  assert.match(emailHelpers, /\{ name: "orderNumber", value: order\.orderNumber \}/);
  assert.match(emailHelpers, /\{ name: "notificationType", value: kind \}/);
  assert.match(emailHelpers, /\{ name: "environment", value: customerEmailRuntimeEnvironment\(\) \}/);
  assert.match(emailHelpers, /sendCustomerEmailNotificationOnce/);
  assert.match(emailHelpers, /emailProviderConfigured\(\)/);
  assert.match(emailHelpers, /sendEmailViaProvider/);
  assert.match(emailHelpers, /idempotencyKey/);
  assert.match(emailHelpers, /html\?: string/);
  assert.match(emailHelpers, /Customer email template HTML missing\./);
  assert.match(emailHelpers, /Customer email HTML template was missing, so no customer email was sent\./);
  assert.match(emailHelpers, /prisma\.paymentEvent\.create/);
  assert.match(emailHelpers, /const existing = await prisma\.paymentEvent\.findUnique\(\{ where: \{ eventId: input\.eventId \} \}\)/);
  assert.match(emailHelpers, /Prisma\.PrismaClientKnownRequestError/);
  assert.match(emailHelpers, /Email provider send failed\./);
  assert.match(emailHelpers, /No customer email is saved for this order\./);
  assert.match(emailHelpers, /Email provider is not configured\. Set RESEND_API_KEY and EMAIL_FROM, or configure SMTP fallback\./);
  assert.match(emailHelpers, /Email delivery failed without blocking the order workflow\./);
  assert.match(storefront, /const receiptSnapshot = storefrontReceiptEmailSnapshot\(order, contactEmail, recipient\)/);
  assert.match(storefront, /const receiptHasRewardSummary = Boolean\(receiptSnapshot\.rewardSummary\)/);
  assert.match(storefront, /buildReceiptEmail\(receiptSnapshot\)/);
  assert.match(storefront, /accountFeatures\.customerAccountsEnabled && !receiptHasRewardSummary/);
  assert.match(storefront, /subject: receiptEmail\.subject/);
  assert.match(storefront, /buildCheckoutExpiredEmail/);
  assert.match(storefront, /buildRefundCancellationEmail/);
  assert.match(storefront, /buildShippingConfirmationEmail/);
  assert.match(storefront, /buildLocalPickupEmail/);
  assert.match(emailTemplates, /GameDayGrabs order confirmed: \$\{input\.orderNumber\}/);
  assert.match(emailTemplates, /STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER = "GDD_EMAIL_TEMPLATE=light-v3"/);
  assert.match(emailTemplates, /Thanks for your order!/);
  assert.match(emailTemplates, /We've received your payment and we're getting it ready for you\./);
  assert.match(emailTemplates, /We'll send tracking once your order ships\./);
  assert.match(emailTemplates, /function isLocalPickupMethod/);
  assert.match(emailTemplates, /function pickupStatusLabel/);
  assert.match(emailTemplates, /We'll send pickup instructions when your order is ready\./);
  assert.match(emailTemplates, /Fulfillment method/);
  assert.match(emailTemplates, /Shipping charged/);
  assert.match(emailTemplates, /Pickup status: \$\{pickupStatusLabel\(input\.pickupStatus\)\}/);
  assert.match(emailTemplates, /Your GameDayGrabs checkout expired/);
  assert.match(emailTemplates, /No payment was collected for this checkout/);
  assert.match(emailTemplates, /If you still want these items, start checkout again while inventory is available/);
  assert.match(emailTemplates, /GameDayGrabs order update: \$\{input\.orderNumber\}/);
  assert.match(emailTemplates, /Refunds typically appear in your account within 3-10 business days/);
  assert.match(emailTemplates, /Your GameDayGrabs order has shipped/);
  assert.match(emailTemplates, /Your GameDayGrabs order has shipped: \$\{input\.orderNumber\}/);
  assert.match(emailTemplates, /Tracking link:/);
  assert.match(emailTemplates, /Pickup ready!/);
  assert.match(emailTemplates, /GameDayGrabs pickup instructions: \$\{input\.orderNumber\}/);
  assert.match(storefront, /pickupInstructionLines\(settings\.localPickupInstructions\)/);
  assert.ok(webhook.indexOf("order = await loadFreshStorefrontOrder(order.id)") >= 0, "webhook must reload the paid order before confirmation email");
  assert.ok(
    webhook.indexOf("order = await loadFreshStorefrontOrder(order.id)") < webhook.indexOf("await completePaidCheckoutSideEffects(order)", webhook.indexOf("order = await loadFreshStorefrontOrder(order.id)")),
    "order confirmation email must run after the post-sale fresh order reload"
  );
  assert.match(storefront, /async function completePaidCheckoutSideEffects[\s\S]*?await awardRewardsForPaidOrder\(order\)[\s\S]*?await sendStorefrontOrderConfirmationEmail\(await loadFreshStorefrontOrder\(order\.id\)\)/);
  assert.match(cancelOrRefund, /customerEmailEventId\("refund_cancellation", updatedOrder\.id, input\.idempotencyKey\)/);
  assert.match(cancelOrRefund, /skippedDetail: "Admin chose not to send a cancellation email\."/);
  assert.match(storefront, /await sendStorefrontCheckoutExpiredEmail\(order, "Stripe Checkout expired before payment completed\."\)/);
  assert.match(updateOrder, /nextFulfillmentStatus === "shipped"/);
  assert.match(updateOrder, /await sendStorefrontShipmentEmail\(finalOrder\)/);
  assert.match(emailHelpers, /if \(orderIsLocalPickup\(order\)\) \{/);
  assert.match(emailHelpers, /Local Pickup orders use pickup instructions instead of shipping confirmation\./);
  assert.match(updateOrder, /nextFulfillmentStatus === "pickup_ready"/);
  assert.match(updateOrder, /await sendStorefrontLocalPickupEmail\(finalOrder\)/);
  assert.match(storefront, /recordExpiredCheckoutEmailSkipped/);
  assert.match(orderModal, /Email notifications/);
  assert.match(orderModal, /order\.customerEmailNotifications\.map/);
  assert.match(orderModal, /notification\.detail/);
  assert.match(orderModal, /notification\.failureReason/);
  assert.match(app, /function emailStatusLabel/);
  assert.match(app, /function emailStatusTone/);
  assert.match(css, /storefront-email-section/);
  assert.match(css, /storefront-email-log/);
  assert.doesNotMatch(emailHelpers + orderModal + emailTemplates, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
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
  assert.match(validation, /customer_return/);
  assert.match(validation, /damaged_in_transit/);
  assert.match(validation, /lost_shipment/);
  assert.match(validation, /wrong_item/);
  assert.match(validation, /support_adjustment/);
  assert.match(validation, /test_order_cleanup/);
  assert.match(validation, /refundType: z\.enum\(\["full", "partial", "none"\]\)/);
  assert.match(validation, /partialRefundAmount/);
  assert.match(route, /requireUser/);
  assert.match(route, /storefrontOrderCancelRefundSchema\.parse/);
  assert.match(route, /cancelOrRefundStorefrontOrder\(user, orderId, input\)/);
  assert.match(route, /processed refund workflow for storefront order/);
  assert.match(cancelOrRefund, /stripeClient\(\)\.refunds\.create/);
  assert.match(cancelOrRefund, /payment_intent: providerInput\.paymentIntentId/);
  assert.match(cancelOrRefund, /amount: providerInput\.amountCents/);
  assert.match(cancelOrRefund, /idempotencyKey: `storefront-cancel-refund:\$\{current\.id\}:\$\{input\.idempotencyKey\}`/);
  assert.match(cancelOrRefund, /if \(preflightRefundCents > remainingRefundableCents\) \{[\s\S]*?TaxRefundAmountError/);
  assert.match(cancelOrRefund, /if \(refundCents > currentRemainingRefundableCents\)/);
  assert.match(cancelOrRefund, /const isShippedRefundWorkflow = order\.fulfillmentStatus === "shipped"/);
  assert.match(cancelOrRefund, /Shipped orders cannot be canceled without a refund\. Use Refund \/ Return for shipped orders\./);
  assert.match(cancelOrRefund, /Add an admin note for shipped refund\/return handling\./);
  assert.match(cancelOrRefund, /if \(input\.refundType === "none" && isRefundableStripeOrder\)/);
  assert.match(cancelOrRefund, /if \(input\.refundType !== "none" && !isRefundableStripeOrder\)/);
  assert.doesNotMatch(cancelOrRefund, /payment_method_details|payment_method_data|card_number|cvc|cvv/i);
});

test("admin cancel refund flow is idempotent and returns inventory once", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const returnOrderInventory = sourceSlice(storefront, "async function returnOrderInventory", "export async function cancelOrRefundStorefrontOrder");
  const alertLifecycle = sourceSlice(storefront, "function canceledOrRefundedOrderAlertInput", "async function createStorefrontSale");

  assert.match(cancelOrRefund, /const requestEventId = `admin\.cancel_refund:\$\{orderId\}:\$\{input\.idempotencyKey\}`/);
  assert.match(cancelOrRefund, /prisma\.paymentEvent\.findFirst/);
  assert.match(cancelOrRefund, /runTaxRefundTransaction/);
  assert.match(cancelOrRefund, /const duplicate = await tx\.paymentEvent\.findFirst/);
  assert.match(cancelOrRefund, /currentIsShippedRefundWorkflow \? current\.fulfillmentStatus : "canceled"/);
  assert.match(cancelOrRefund, /currentIsShippedRefundWorkflow \? current\.canceledAt : current\.canceledAt \?\? new Date\(\)/);
  assert.match(cancelOrRefund, /Refund\/return reason/);
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
  assert.match(orderModal, /const canFulfillOrder = storefrontOrderCanFulfill\(order\)/);
  assert.match(orderModal, /Mark Packing/);
  assert.match(orderModal, /Mark Shipped/);
  assert.match(orderModal, /Packing Slip/);
  assert.match(orderModal, /\{canPickupOrder \? \(/);
  assert.match(orderModal, /\) : canShipOrder \? \(/);
  assert.match(orderModal, /Only active paid orders can be marked packing, shipped, ready for pickup, or picked up/);
  assert.match(orderModal, /storefrontOrderCanOpenRefundFlow\(order\)/);
  assert.match(orderModal, /refundActionLabel/);
  assert.match(app, /return storefrontOrderUsesReturnRefundFlow\(order\) \? "Refund \/ Return" : "Cancel \/ Refund"/);
  assert.match(cancelModal, /Cancellation reason/);
  assert.match(cancelModal, /Refund \/ return reason/);
  assert.match(cancelModal, /Out of stock/);
  assert.match(cancelModal, /Customer requested cancellation/);
  assert.match(cancelModal, /Fraud \/ suspicious order/);
  assert.match(cancelModal, /Customer return/);
  assert.match(cancelModal, /Damaged in transit/);
  assert.match(cancelModal, /Lost shipment/);
  assert.match(cancelModal, /Wrong item/);
  assert.match(cancelModal, /Customer support adjustment/);
  assert.match(cancelModal, /Test order cleanup/);
  assert.match(cancelModal, /Full refund/);
  assert.match(cancelModal, /Partial refund/);
  assert.match(cancelModal, /No refund/);
  assert.match(cancelModal, /Return item to stock/);
  assert.match(cancelModal, /Only return stock if the item has been physically returned and is sellable\./);
  assert.match(cancelModal, /defaultChecked=\{inventoryFinalized && !shippedRefundFlow\}/);
  assert.match(cancelModal, /Send cancellation email to customer/);
  assert.match(cancelModal, /Send refund\/return update to customer/);
  assert.match(cancelModal, /\/api\/radar\/storefront\/orders\/\$\{order\.id\}\/cancel-refund/);
  assert.match(cancelModal, /idempotencyKey/);
  assert.doesNotMatch(cancelModal, /payment_method_details|payment_method_data|card_number|cvv/i);
});

test("shipped paid orders expose refund return workflow while preserving shipped history", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const ordersPanel = sourceSlice(app, "function StorefrontOrdersPanel", "function StorefrontSettingsCard");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontPackingSlip");
  const cancelModal = sourceSlice(app, "function StorefrontCancelRefundModal", "function InventoryKpiCard");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const orderCanCancelOrRefund = sourceSlice(storefront, "function orderCanCancelOrRefund", "function orderIsClosedForFulfillment");
  const timeline = sourceSlice(storefront, "function orderTimeline", "function orderAddress");

  assert.match(app, /function storefrontOrderCanOpenRefundFlow/);
  assert.match(app, /function storefrontOrderUsesReturnRefundFlow/);
  assert.match(app, /order\.fulfillmentStatus === "shipped" && storefrontOrderCanOpenRefundFlow\(order\)/);
  assert.match(app, /function storefrontOrderRefundActionLabel/);
  assert.match(ordersPanel, /const \[refundOrderId, setRefundOrderId\] = useState\(""\)/);
  assert.match(ordersPanel, /openRefundOrder\(order\)/);
  assert.match(ordersPanel, /Refund \/ Return/);
  assert.match(orderModal, /canOpenRefundFlow/);
  assert.match(orderModal, /\{refundActionLabel\}/);
  assert.match(cancelModal, /Refund \/ Return Shipped Order/);
  assert.match(cancelModal, /Confirm Refund \/ Return/);
  assert.match(cancelModal, /Refund \/ return recorded/);
  assert.match(cancelModal, /required=\{shippedRefundFlow\}/);
  assert.match(cancelModal, /defaultChecked=\{inventoryFinalized && !shippedRefundFlow\}/);
  assert.match(cancelModal, /Refund\/return email sent/);
  assert.match(orderCanCancelOrRefund, /order\.fulfillmentStatus === "shipped" && orderRemainingRefundableCents\(order\) > 0/);
  assert.match(cancelOrRefund, /fulfillmentStatus: currentIsShippedRefundWorkflow \? current\.fulfillmentStatus : "canceled"/);
  assert.match(cancelOrRefund, /canceledAt: currentIsShippedRefundWorkflow \? current\.canceledAt : current\.canceledAt \?\? new Date\(\)/);
  assert.match(cancelOrRefund, /stockReturnStatus = input\.returnItemsToStock/);
  assert.match(cancelOrRefund, /eventType: "admin\.inventory\.returned"/);
  assert.match(timeline, /Cancel\/refund workflow/);
  assert.doesNotMatch(timeline, /Cancellation started/);
  assert.doesNotMatch(cancelModal + cancelOrRefund, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
});

test("Admin Orders treats canceled refunded and expired orders as a muted archive", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const css = readProjectFile("src/app/globals.css");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const ordersPanel = sourceSlice(app, "function StorefrontOrdersPanel", "function StorefrontSettingsCard");
  const orderTabs = sourceSlice(app, "function storefrontOrdersForTab", "function storefrontOrderTabs");
  const updateStorefrontOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");

  assert.match(app, /function storefrontOrderCanFulfill\(order: StorefrontOrderDTO\)/);
  assert.match(app, /function storefrontDefaultOrderTab/);
  assert.match(app, /function storefrontOrderEmptyState/);
  assert.match(orderTabs, /storefrontOrderIsCanceledOrRefunded\(order\)/);
  assert.match(orderTabs, /\["failed", "expired"\]\.includes\(order\.paymentStatus\)/);
  assert.match(orderTabs, /tab === "pending"[\s\S]*!storefrontOrderIsCanceledOrRefunded\(order\)/);
  assert.match(ordersPanel, /const \[activeOrderTab, setActiveOrderTab\] = useState<StorefrontOrderTab>\(\(\) => storefrontDefaultOrderTab\(dashboard\.storefrontOrders\)\)/);
  assert.doesNotMatch(ordersPanel, /visibleOrders\.length === 0[\s\S]*setActiveOrderTab\(defaultOrderTab\)/);
  assert.match(ordersPanel, /className=\{`\$\{activeOrderTab === tab\.id \? "active" : ""\} \$\{tab\.id === "canceled" \? "archive-tab" : ""\}`\.trim\(\)\}/);
  assert.match(ordersPanel, /const archived = storefrontOrderIsCanceledOrRefunded\(order\)/);
  assert.match(ordersPanel, /const canFulfill = storefrontOrderCanFulfill\(order\)/);
  assert.match(ordersPanel, /const canShip = storefrontOrderCanShip\(order\)/);
  assert.match(ordersPanel, /const canPickup = storefrontOrderCanPickup\(order\)/);
  assert.match(ordersPanel, /\{canPickup \? \(/);
  assert.match(ordersPanel, /\) : canShip \? \(/);
  assert.match(ordersPanel, /Historical order\. No fulfillment action needed\./);
  assert.match(app, /No paid orders to ship\./);
  assert.match(app, /No new orders\./);
  assert.match(app, /Canceled and expired orders are kept here for history\./);
  assert.match(app, /function storefrontOrderNetLabel[\s\S]*Original/);
  assert.match(ordersPanel, /storefrontOrderNetLabel\(order\)/);
  assert.match(ordersPanel, /Open Store Settings/);
  assert.match(ordersPanel, /storeSettingsOpen \? <StorefrontSettingsCard/);
  assert.doesNotMatch(sourceSlice(ordersPanel, '<section className="storefront-admin-grid fulfillment-focused">', "</section>"), /StorefrontSettingsCard/);

  assert.match(css, /storefront-admin-grid\.fulfillment-focused/);
  assert.match(css, /storefront-order-row\.archived/);
  assert.match(css, /storefront-settings-collapsible/);
  assert.match(css, /body \.storefront-admin-grid \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/);

  assert.match(storefront, /function orderIsClosedForFulfillment/);
  assert.match(updateStorefrontOrder, /requestsActiveFulfillment/);
  assert.match(updateStorefrontOrder, /Canceled, refunded, or expired orders cannot be marked packing, shipped, ready for pickup, or picked up\./);
  assert.match(updateStorefrontOrder, /Only paid orders can be marked packing, shipped, ready for pickup, or picked up\./);
  assert.match(updateStorefrontOrder, /requestsShippedStatus/);
  assert.match(updateStorefrontOrder, /nextCarrier/);
  assert.match(updateStorefrontOrder, /nextTrackingNumber/);
  assert.match(updateStorefrontOrder, /Carrier and tracking number are required before marking an order shipped\./);
  assert.match(updateStorefrontOrder, /nextFulfillmentStatus/);
  assert.match(updateStorefrontOrder, /nextOrderStatus/);
  assert.match(updateStorefrontOrder, /const refreshed = await prisma\.storefrontOrder\.findUnique/);
  assert.doesNotMatch(ordersPanel, /card_number|cardNumber|payment_method_details|payment_method_data|cvc|cvv/i);
});

test("admin cancel refund modal confirms success and prevents duplicate submissions", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const submitHelper = sourceSlice(app, "const submit: SubmitHandler", "const runAction: ActionHandler");
  const orderModal = sourceSlice(app, "function StorefrontOrderDetailsModal", "function StorefrontCancelRefundModal");
  const cancelModal = sourceSlice(app, "function StorefrontCancelRefundModal", "function InventoryKpiCard");

  assert.match(submitHelper, /await loadDashboard\(\);\s+await options\.onSuccess\?\.\(result\);/);
  assert.match(submitHelper, /options\.onError\?\.\(message\);/);
  assert.match(orderModal, /const canOpenRefundFlow = storefrontOrderCanOpenRefundFlow\(order\)/);
  assert.match(orderModal, /const refundActionLabel = storefrontOrderRefundActionLabel\(order\)/);
  assert.match(cancelModal, /const \[successOrder, setSuccessOrder\] = useState<StorefrontOrderDTO \| null>\(null\)/);
  assert.match(cancelModal, /const \[localError, setLocalError\] = useState<string \| null>\(null\)/);
  assert.match(cancelModal, /const submittedRef = useRef\(false\)/);
  assert.match(cancelModal, /const shippedRefundFlow = storefrontOrderUsesReturnRefundFlow\(order\)/);
  assert.match(cancelModal, /if \(submittedRef\.current\)/);
  assert.match(cancelModal, /submittedRef\.current = true/);
  assert.match(cancelModal, /disabled=\{busy \|\| processing \|\| submittedRef\.current \|\| !idempotencyKey\}/);
  assert.match(cancelModal, /Processing refund\.\.\./);
  assert.match(cancelModal, /Canceling order\.\.\./);
  assert.match(cancelModal, /Confirm Refund \/ Return/);
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
  assert.match(cancelModal, /Refund\/return email sent/);
  assert.match(cancelModal, /Email not configured/);
  assert.match(cancelModal, /No customer email on file/);
  assert.match(cancelModal, /Email failed/);
  assert.match(cancelModal, /Done - View Updated Order/);
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
  assert.match(storefrontSummary, /NOT: localPickupOrderWhere/);
  assert.match(storefrontSummary, /fulfillmentStatus: \{ in: \["unfulfilled", "pickup_ready"\] \}/);
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
  assert.match(saleDetails, /Original Sale/);
  assert.match(saleDetails, /Net Revenue/);
  assert.match(saleDetails, /Refund Status/i);
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
