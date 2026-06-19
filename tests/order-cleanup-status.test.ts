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

test("test and smoke order marker migration is additive and reporting-only", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260619023000_test_smoke_orders/migration.sql");

  assert.match(schema, /isTestOrder\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /testOrderReason\s+String\?/);
  assert.match(schema, /testMarkedAt\s+DateTime\?/);
  assert.match(schema, /testMarkedBy\s+String\?/);
  assert.match(schema, /@@index\(\[isTestOrder\]\)/);
  assert.match(migration, /ADD COLUMN "isTestOrder" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ADD COLUMN "testOrderReason" TEXT/);
  assert.match(migration, /CREATE INDEX "StorefrontOrder_isTestOrder_idx"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE "StorefrontOrder"/i);
});

test("marking a test order requires a reason and avoids fulfillment side effects", () => {
  const validation = readProjectFile("src/lib/validation.ts");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const updateOrder = sourceSlice(storefront, "export async function updateStorefrontOrder");

  assert.match(validation, /isTestOrder: checkboxBoolean\.optional\(\)/);
  assert.match(validation, /testOrderReason: z\.enum\(\["stripe_test_mode", "live_checkout_smoke", "email_smoke_test", "shipping_smoke_test", "refund_smoke_test", "other"\]\)\.optional\(\)/);
  assert.match(validation, /Select a test\/smoke reason before marking this order\./);
  assert.match(updateOrder, /if \(input\.isTestOrder === true && !input\.testOrderReason\)/);
  assert.match(updateOrder, /testMarkedBy: currentUser\.email \?\? currentUser\.id/);
  assert.match(updateOrder, /requestsFulfillmentRecordUpdate/);
  assert.match(updateOrder, /if \(requestsFulfillmentRecordUpdate\) \{\s*await prisma\.fulfillment\.upsert/s);
  assert.match(updateOrder, /if \(requestsTestOrderChange && finalOrder\.customerId && finalOrder\.customerEmail\)/);
  assert.doesNotMatch(updateOrder, /inventoryItem\.update|inventoryStockLot\.update|stripe\.refunds\.create/);
});

test("default business metrics exclude marked test orders while history remains available", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const radarService = readProjectFile("src/lib/radar-service.ts");
  const app = readProjectFile("src/components/RadarApp.tsx");
  const summary = sourceSlice(storefront, "export async function storefrontSummary", "async function returnOrderInventory");
  const customerTotals = sourceSlice(storefront, "async function syncStorefrontCustomerTotals", "async function persistPaidCheckoutSession");
  const saleAdjustment = sourceSlice(radarService, "function storefrontOrderSaleStatus", "function recomputeInventoryItemSaleTotals");

  assert.match(customerTotals, /\.\.\.storefrontRealBusinessOrderWhere\(\)/);
  assert.match(summary, /const realBusinessOrderWhere = storefrontRealBusinessOrderWhere\(\)/);
  assert.match(summary, /testOrderCount/);
  assert.match(saleAdjustment, /if \(order\.isTestOrder\) return "test"/);
  assert.match(saleAdjustment, /saleStatus === "test"/);
  assert.match(app, /Include test orders/);
  assert.match(app, /Show only test orders/);
  assert.match(app, /Test \/ Smoke Orders/);
  assert.match(app, /This does not refund the order or change inventory\. It only changes reporting visibility\./);
  assert.match(app, /Remove Test Mark/);
  assert.match(app, /Mark as Test \/ Smoke/);
});

test("public order status lookup is read-only and omits private payment/admin data", () => {
  const route = readProjectFile("src/app/api/storefront/order-status/route.ts");
  const page = readProjectFile("src/app/order-status/page.tsx");
  const client = readProjectFile("src/components/OrderStatusLookupClient.tsx");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const lookup = sourceSlice(storefront, "export async function lookupPublicOrderStatus", "export async function storefrontSummary");

  assert.match(route, /publicOrderStatusLookupSchema\.parse/);
  assert.match(route, /lookupPublicOrderStatus\(input\)/);
  assert.match(page, /\/order-status/);
  assert.match(client, /We could not find an order with that order number and email|result\.message/);
  assert.match(client, /This page is read-only and cannot edit, cancel, or refund an order\./);
  assert.match(lookup, /where: \{ orderNumber \}/);
  assert.match(lookup, /normalizedCustomerEmail\(order\.customerEmail \?\? order\.customer\?\.email\) !== email/);
  assert.match(lookup, /trackingUrlFor\(order\.carrier, order\.trackingNumber\)/);
  assert.doesNotMatch(lookup, /billingLine|billingAddress|customerPhone|stripePaymentIntentId|stripeCheckoutSessionId|paymentEvents|notes|costBasis|netProfit|roiPercent/);
  assert.doesNotMatch(client, /billing|phone|payment intent|checkout session|admin note|cost basis|profit|raw Stripe|payment_method_details|card number|CVC/i);
});
