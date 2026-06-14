import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { calculateCartShipping } from "../src/lib/shipping";

function shippableItem(overrides: Parameters<typeof calculateCartShipping>[0][number] = {}) {
  return {
    id: "item-1",
    title: "Test Product",
    quantity: 1,
    shippingProfile: "single_card_or_light_item",
    packageWeightOz: 4,
    shippingAvailable: true,
    localPickupAvailable: true,
    freeShippingEligible: false,
    requiresBox: false,
    insuranceRecommended: false,
    ...overrides
  };
}

function defaultAmount(weightOz: number) {
  const result = calculateCartShipping([shippableItem({ packageWeightOz: weightOz })]);
  assert.ok(result.defaultShippingOption, "expected default shipping option");
  return result.defaultShippingOption.amount;
}

test("smart shipping calculator returns $4.99 for packages up to 8 oz", () => {
  assert.equal(defaultAmount(8), 4.99);
});

test("smart shipping calculator returns $5.99 for packages up to 16 oz", () => {
  assert.equal(defaultAmount(16), 5.99);
});

test("smart shipping calculator returns $7.99 for packages up to 32 oz", () => {
  assert.equal(defaultAmount(32), 7.99);
});

test("smart shipping calculator returns $9.99 for packages up to 80 oz", () => {
  assert.equal(defaultAmount(80), 9.99);
});

test("smart shipping calculator flags heavy package manual review", () => {
  const result = calculateCartShipping([shippableItem({ packageWeightOz: 81, shippingProfile: "heavy_box" })]);

  assert.equal(result.defaultShippingOption?.amount, 12.99);
  assert.equal(result.defaultShippingOption?.label, "Heavy Package Shipping");
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.warnings.some((warning) => warning.includes("manual review")), true);
});

test("smart shipping calculator supports local pickup at $0", () => {
  const result = calculateCartShipping([shippableItem()], { fulfillmentMethod: "pickup" });

  assert.equal(result.defaultShippingOption?.id, "local_pickup");
  assert.equal(result.defaultShippingOption?.label, "Local Pickup");
  assert.equal(result.defaultShippingOption?.amount, 0);
  assert.equal(result.localPickupEligible, true);
});

test("smart shipping calculator only offers local pickup when every cart item is eligible", () => {
  const result = calculateCartShipping([
    shippableItem({ id: "pickup-ok", localPickupAvailable: true }),
    shippableItem({ id: "ship-only", localPickupAvailable: false })
  ]);

  assert.equal(result.localPickupEligible, false);
  assert.equal(result.shippingOptions.some((option) => option.id === "local_pickup"), false);
  assert.equal(result.shippingOptions.some((option) => option.label === "Standard Shipping"), true);
});

test("missing package profile uses safe fallback and warning", () => {
  const result = calculateCartShipping([shippableItem({ shippingProfile: "standard", packageWeightOz: null })]);

  assert.equal(result.packageProfile, "small_box");
  assert.equal(result.packageProfileLabel, "Small Box");
  assert.equal(result.totalWeightOz, 16);
  assert.equal(result.defaultShippingOption?.amount, 5.99);
  assert.equal(result.needsShippingProfile, true);
  assert.equal(result.warnings.some((warning) => warning.includes("safe small-box fallback")), true);
});

test("shipping calculator does not depend on the old flat five dollar setting", () => {
  const source = fs.readFileSync(new URL("../src/lib/shipping.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /defaultShippingPrice/);
  assert.doesNotMatch(source, /settings\.defaultShippingPrice/);
  assert.doesNotMatch(source, /amount:\s*5(?:\.00)?(?:[,;\n])/);
  assert.doesNotMatch(source, /prisma|inventoryItem\.(update|updateMany|upsert)|inventorySale|stockReservation/i);
});

test("smart shipping schema and order snapshots are wired without raw payment details", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const calculator = fs.readFileSync(new URL("../src/lib/shipping.ts", import.meta.url), "utf8");
  const inventorySchema = schema.slice(schema.indexOf("model InventoryItem"), schema.indexOf("model InventoryProductImage"));
  const storefrontOrderSchema = schema.slice(schema.indexOf("model StorefrontOrder"), schema.indexOf("model Fulfillment"));
  const storefrontOrderTypes = types.slice(types.indexOf("export type StorefrontOrderDTO"), types.indexOf("export type StorefrontSummaryDTO"));

  for (const field of ["packageWeightOz", "packageLengthIn", "packageWidthIn", "packageHeightIn"]) {
    assert.match(schema, new RegExp(`${field}\\s+Float\\?`));
    assert.match(types, new RegExp(`${field}: number \\| null`));
  }

  for (const field of ["freeShippingEligible", "requiresBox", "insuranceRecommended"]) {
    assert.match(schema, new RegExp(`${field}\\s+Boolean\\s+@default\\(false\\)`));
    assert.match(types, new RegExp(`${field}: boolean`));
  }

  for (const field of ["shippingMethodLabel", "shippingRateSource", "shippingPackageWeightOz", "shippingPackageProfile", "shippingWarnings"]) {
    assert.match(schema, new RegExp(`${field}\\s+`));
    assert.match(storefront, new RegExp(`${field}:`));
  }

  assert.match(storefront, /calculateCartShipping/);
  assert.match(storefront, /shippingWarnings: stringifyList\(shippingCalculation\.warnings\)/);
  assert.match(types, /needsShippingProfile: boolean/);

  for (const source of [inventorySchema, storefrontOrderSchema, storefront, storefrontOrderTypes, calculator]) {
    assert.doesNotMatch(source, /cardNumber|card_number|cvc|cvv|payment_method_data/i);
  }
});

test("storefront checkout passes smart shipping options to Stripe instead of a flat shipping line item", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const createCheckoutSession = storefront.slice(
    storefront.indexOf("export async function createCheckoutSession"),
    storefront.indexOf("export async function createInvoiceRequest")
  );
  const sessionCreateParams = createCheckoutSession.slice(
    createCheckoutSession.indexOf("const session = await stripe.checkout.sessions.create({"),
    createCheckoutSession.indexOf("    });", createCheckoutSession.indexOf("const session = await stripe.checkout.sessions.create({"))
  );

  assert.match(storefront, /function stripeShippingOptions\(shippingCalculation: ShippingCalculation\)/);
  assert.match(createCheckoutSession, /const checkoutShippingOptions = stripeShippingOptions\(shippingCalculation\)/);
  assert.match(sessionCreateParams, /shipping_options: checkoutShippingOptions/);
  assert.match(sessionCreateParams, /shipping_address_collection: \{\s*allowed_countries: stripeShippingAllowedCountries\s*\}/);
  assert.doesNotMatch(sessionCreateParams, /product_data: \{ name: "Shipping" \}/);
  assert.doesNotMatch(createCheckoutSession, /\.\.\.\(shippingCharged > 0/);

  assert.match(client, /Shipping calculated at checkout/);
  assert.match(client, /Shipping is estimated from product weight and package size\./);
  assert.match(client, /Final shipping is shown before payment\./);
  assert.match(client, /Items are not reserved until checkout starts\./);
  assert.match(client, /Availability is confirmed before payment\./);
  assert.doesNotMatch(client, /<b>Shipping estimate<\/b>\s*\{money\(shipping\)\}/);
});

test("paid checkout webhook persists selected Stripe Checkout shipping result", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const persistPaidCheckoutSession = storefront.slice(
    storefront.indexOf("async function persistPaidCheckoutSession"),
    storefront.indexOf("export async function handleStripeWebhook")
  );

  assert.match(storefront, /async function checkoutShippingSnapshot\(session: Stripe\.Checkout\.Session, order: StorefrontOrderWithItems\)/);
  assert.match(storefront, /shippingCost\.amount_total/);
  assert.match(storefront, /total_details\?\.amount_shipping/);
  assert.match(storefront, /stripeClient\(\)\.shippingRates\.retrieve\(shippingRate\)/);
  assert.match(persistPaidCheckoutSession, /const shippingSnapshot = await checkoutShippingSnapshot\(session, order\)/);
  assert.match(persistPaidCheckoutSession, /shippingCharged,/);
  assert.match(persistPaidCheckoutSession, /shippingMethodLabel: shippingSnapshot\.shippingMethodLabel/);
  assert.match(persistPaidCheckoutSession, /shippingRateSource: shippingSnapshot\.shippingRateSource \?\? "stripe_checkout"/);
  assert.match(persistPaidCheckoutSession, /shippingPackageWeightOz: shippingSnapshot\.shippingPackageWeightOz/);
  assert.match(persistPaidCheckoutSession, /shippingPackageProfile: shippingSnapshot\.shippingPackageProfile/);
  assert.match(persistPaidCheckoutSession, /shippingWarnings: stringifyList\(shippingSnapshot\.shippingWarnings\)/);
  assert.match(persistPaidCheckoutSession, /total,/);
  assert.match(persistPaidCheckoutSession, /stripeFeeEstimate: estimateStripeFee\(total\)/);
});
