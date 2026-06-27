import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { calculateCartShipping } from "../src/lib/shipping";
import { shippingLabelWorkflowConfig } from "../src/lib/shipping-labels";
import { normalizeShippoUspsQuote, shippingRateProviderConfig } from "../src/lib/shipping-rate-provider";

function shippableItem(overrides: Parameters<typeof calculateCartShipping>[0][number] = {}) {
  return {
    id: "item-1",
    title: "Test Product",
    quantity: 1,
    shippingProfile: "single_card_or_light_item",
    packageWeightOz: 4,
    packageLengthIn: 6,
    packageWidthIn: 4,
    packageHeightIn: 1,
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

test("smart shipping packs every product in a multi-item cart for carrier quotes", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "three-booster-blister",
      title: "Perfect Order 3-Booster Blister",
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 6,
      packageLengthIn: 9,
      packageWidthIn: 7,
      packageHeightIn: 1.2
    }),
    shippableItem({
      id: "premium-collection",
      title: "Mega Zygarde ex Premium Collection",
      shippingProfile: "large_box",
      packageWeightOz: 36,
      packageLengthIn: 13,
      packageWidthIn: 10,
      packageHeightIn: 3.5
    }),
    shippableItem({
      id: "booster-bundle",
      title: "Mega Evolution Perfect Order Booster Bundle",
      shippingProfile: "small_box",
      packageWeightOz: 24,
      packageLengthIn: 7,
      packageWidthIn: 5,
      packageHeightIn: 4
    })
  ]);

  assert.equal(result.totalWeightOz, 69);
  assert.equal(result.packageProfile, "large_box");
  assert.equal(result.packageLengthIn, 13.5);
  assert.equal(result.packageWidthIn, 10.5);
  assert.equal(result.packageHeightIn, 9.2);
  assert.equal(result.defaultShippingOption?.amount, 9.99);
});

test("smart shipping quantity greater than one uses the full packed cart weight and height", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "seven-blisters",
      quantity: 7,
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 6,
      packageLengthIn: 9,
      packageWidthIn: 7,
      packageHeightIn: 1
    })
  ]);

  assert.equal(result.totalWeightOz, 47);
  assert.equal(result.packageProfile, "large_box");
  assert.equal(result.packageLengthIn, 9.5);
  assert.equal(result.packageWidthIn, 7.5);
  assert.equal(result.packageHeightIn, 7.5);
  assert.equal(result.defaultShippingOption?.amount, 9.99);
});

test("smart shipping does not fake complete carrier dimensions when any cart item is missing package size", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "ready-box",
      shippingProfile: "small_box",
      packageWeightOz: 16,
      packageLengthIn: 8,
      packageWidthIn: 6,
      packageHeightIn: 4
    }),
    shippableItem({
      id: "missing-dimensions",
      shippingProfile: "medium_box",
      packageWeightOz: 18,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.totalWeightOz, 36.5);
  assert.equal(result.packageLengthIn, null);
  assert.equal(result.packageWidthIn, null);
  assert.equal(result.packageHeightIn, null);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), true);
});

test("missing package profile uses safe fallback and warning", () => {
  const result = calculateCartShipping([shippableItem({ shippingProfile: "standard", packageWeightOz: null })]);

  assert.equal(result.packageProfile, "small_box");
  assert.equal(result.packageProfileLabel, "Small Box");
  assert.equal(result.totalWeightOz, 16);
  assert.equal(result.defaultShippingOption?.amount, 5.99);
  assert.equal(result.needsShippingProfile, true);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), true);
});

test("missing package profile uses category-aware fallback for larger sealed products", () => {
  const result = calculateCartShipping([
    shippableItem({
      shippingProfile: "standard",
      category: "Premium Collections",
      title: "Mega Zygarde ex Premium Collection",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.packageProfile, "large_box");
  assert.equal(result.totalWeightOz, 80);
  assert.equal(result.defaultShippingOption?.amount, 9.99);
  assert.equal(result.needsShippingProfile, true);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), true);
});

test("missing package dimensions are surfaced for calculated shipping fallback", () => {
  const result = calculateCartShipping([
    shippableItem({
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.packageLengthIn, null);
  assert.equal(result.packageWidthIn, null);
  assert.equal(result.packageHeightIn, null);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), true);
});

test("selected shipping profile defaults complete blank product package data", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "three_booster_blister",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 6);
  assert.equal(result.packageProfile, "three_booster_blister");
  assert.equal(result.packageLengthIn, 9);
  assert.equal(result.packageWidthIn, 7);
  assert.equal(result.packageHeightIn, 1);
  assert.equal(result.needsShippingProfile, false);
  assert.equal(result.defaultShippingOption?.amount, 4.99);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), false);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), false);
});

test("product-level package data overrides selected profile defaults", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "three_booster_blister",
        packageWeightOz: 12,
        packageLengthIn: 10,
        packageWidthIn: 8,
        packageHeightIn: 2
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 12);
  assert.equal(result.packageLengthIn, 10);
  assert.equal(result.packageWidthIn, 8);
  assert.equal(result.packageHeightIn, 2);
  assert.equal(result.defaultShippingOption?.amount, 5.99);
});

test("selected profile without dimension defaults still flags missing dimensions", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "dimensionless_profile",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        dimensionless_profile: {
          label: "Dimensionless Profile",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: null,
          packageWidthIn: null,
          packageHeightIn: null
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 6);
  assert.equal(result.needsShippingProfile, false);
  assert.equal(result.packageLengthIn, null);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), true);
});

test("Shippo USPS quote normalizer prefers Ground Advantage without exposing raw provider payloads", () => {
  const quote = normalizeShippoUspsQuote(
    {
      object_id: "shippo_shipment_safe_ref",
      rates: [
        {
          object_id: "priority_rate",
          provider: "USPS",
          servicelevel: { name: "USPS Priority Mail" },
          amount: "9.99",
          currency: "USD",
          estimated_days: 3
        },
        {
          object_id: "ground_rate",
          provider: "USPS",
          servicelevel: { name: "USPS Ground Advantage" },
          amount: "6.45",
          currency: "USD",
          estimated_days: 5
        },
        {
          object_id: "ups_rate",
          provider: "UPS",
          servicelevel: { name: "UPS Ground" },
          amount: "4.00",
          currency: "USD"
        }
      ]
    },
    {
      now: new Date("2026-06-18T12:00:00.000Z"),
      env: { SHIPPING_QUOTE_TTL_MINUTES: "30" }
    }
  );

  assert.ok(quote);
  assert.equal(quote.provider, "shippo");
  assert.equal(quote.carrier, "USPS");
  assert.equal(quote.service, "USPS Ground Advantage");
  assert.equal(quote.amountCents, 645);
  assert.equal(quote.rateProviderRef, "ground_rate");
  assert.equal(quote.shipmentProviderRef, "shippo_shipment_safe_ref");
  assert.equal(quote.expiresAt.toISOString(), "2026-06-18T12:30:00.000Z");
  assert.equal("rates" in quote, false);
});

test("shipping rate provider config is feature flagged and reports configured booleans only", () => {
  const disabled = shippingRateProviderConfig({});
  assert.equal(disabled.calculatedUspsEnabled, false);
  assert.equal(disabled.provider, "shippo");
  assert.equal(disabled.shippoConfigured, false);
  assert.equal(disabled.fallbackEnabled, true);

  const configured = shippingRateProviderConfig({
    CALCULATED_USPS_SHIPPING_ENABLED: "true",
    SHIPPING_RATE_PROVIDER: "shippo",
    SHIPPO_API_TOKEN: "secret_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US",
    SHIPPING_FALLBACK_ENABLED: "false",
    SHIPPING_QUOTE_TTL_MINUTES: "999"
  });

  assert.equal(configured.calculatedUspsEnabled, true);
  assert.equal(configured.provider, "shippo");
  assert.equal(configured.shippoConfigured, true);
  assert.equal(configured.shipFromZipConfigured, true);
  assert.equal(configured.fallbackEnabled, false);
  assert.equal(configured.quoteTtlMinutes, 120);
  assert.deepEqual(
    configured.envVars.includes("SHIPPO_API_TOKEN"),
    true,
    "env var names may be reported but values must not be returned"
  );
  assert.doesNotMatch(JSON.stringify(configured), /secret_token_not_returned/);
});

test("Shippo label purchase workflow is disabled by default and reports booleans only", () => {
  const disabled = shippingLabelWorkflowConfig({});
  assert.equal(disabled.shippingLabelsEnabled, false);
  assert.equal(disabled.shippoLabelPurchaseEnabled, false);
  assert.equal(disabled.provider, "shippo");
  assert.equal(disabled.labelProviderConfigured, false);
  assert.equal(disabled.purchaseReady, false);

  const providerConfiguredButDisabled = shippingLabelWorkflowConfig({
    SHIPPO_API_TOKEN: "secret_shippo_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US"
  });
  assert.equal(providerConfiguredButDisabled.labelProviderConfigured, true);
  assert.equal(providerConfiguredButDisabled.shippoLabelPurchaseEnabled, false);
  assert.equal(providerConfiguredButDisabled.purchaseReady, false);

  const enabled = shippingLabelWorkflowConfig({
    SHIPPO_LABEL_PURCHASE_ENABLED: "true",
    SHIPPO_API_TOKEN: "secret_shippo_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US"
  });
  assert.equal(enabled.shippoLabelPurchaseEnabled, true);
  assert.equal(enabled.labelProviderConfigured, true);
  assert.equal(enabled.purchaseReady, true);
  assert.deepEqual(enabled.envVars.includes("SHIPPO_LABEL_PURCHASE_ENABLED"), true);
  assert.doesNotMatch(JSON.stringify(enabled), /secret_shippo_token_not_returned/);
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

  for (const field of [
    "shippingQuoteId",
    "shippingQuoteProvider",
    "shippingCarrier",
    "shippingService",
    "shippingQuotedAmountCents",
    "shippingQuotedZip",
    "shippingQuoteFallbackUsed",
    "shippingZipMismatchReview"
  ]) {
    assert.match(schema, new RegExp(`${field}\\s+`));
    assert.match(types, new RegExp(`${field}:`));
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
  assert.match(createCheckoutSession, /const checkoutShippingOptions = stripeShippingOptionsForCheckout\(shippingCalculation, calculatedQuote\)/);
  assert.match(sessionCreateParams, /shipping_options: checkoutShippingOptions/);
  assert.match(sessionCreateParams, /shipping_address_collection: \{\s*allowed_countries: stripeShippingAllowedCountries\s*\}/);
  assert.doesNotMatch(sessionCreateParams, /product_data: \{ name: "Shipping" \}/);
  assert.doesNotMatch(createCheckoutSession, /\.\.\.\(shippingCharged > 0/);

  assert.match(client, /Shipping calculated at checkout/);
  assert.match(client, /Checkout notes/);
  assert.match(client, /Shipping is calculated by ZIP before payment\./);
  assert.match(client, /Items are reserved when checkout starts\./);
  assert.match(client, /Secure checkout by Stripe\. Guest checkout available\./);
  assert.match(client, /Enter ZIP code to calculate USPS shipping\./);
  assert.match(client, /\/api\/storefront\/shipping\/quote/);
  assert.match(client, /shippingQuoteToken/);
  assert.doesNotMatch(client, /<b>Shipping estimate<\/b>\s*\{money\(shipping\)\}/);
});

test("calculated USPS quote API and checkout enforce server-side quote safety", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8");
  const route = fs.readFileSync(new URL("../src/app/api/storefront/shipping/quote/route.ts", import.meta.url), "utf8");
  const provider = fs.readFileSync(new URL("../src/lib/shipping-rate-provider.ts", import.meta.url), "utf8");
  const createQuote = storefront.slice(storefront.indexOf("export async function createStorefrontShippingQuote"), storefront.indexOf("function shippingOptionFromQuote"));
  const quoteHelper = storefront.slice(storefront.indexOf("async function quoteForCalculatedShipping"), storefront.indexOf("export async function createStorefrontShippingQuote"));
  const createCheckoutSession = storefront.slice(
    storefront.indexOf("export async function createCheckoutSession"),
    storefront.indexOf("export async function createInvoiceRequest")
  );

  assert.match(validation, /storefrontShippingQuoteSchema/);
  assert.match(validation, /destinationZip: z\.string\(\)\.trim\(\)\.regex\(\/\^\\d\{5\}\$\//);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /createStorefrontShippingQuote\(input\)/);
  assert.match(createQuote, /const cart = await getCartProducts\(input\.items, \{ profileDefinitions \}\)/);
  assert.match(createQuote, /calculateCartShipping/);
  assert.doesNotMatch(createQuote, /packageWeightOz: input|packageLengthIn: input|amountCents: input/);
  assert.match(quoteHelper, /fetchShippoUspsQuote/);
  assert.match(quoteHelper, /fallbackShippingQuote/);
  assert.match(createQuote, /fallbackShippingQuote/);
  assert.match(createQuote, /cartHash: shippingCartHash\(cart\)/);
  assert.match(createCheckoutSession, /if \(input\.fulfillmentMethod === "shipping" && shippingRates\.calculatedUspsEnabled\)/);
  assert.match(createCheckoutSession, /if \(!input\.shippingQuoteToken\)/);
  assert.match(createCheckoutSession, /calculatedQuote\.expiresAt\.getTime\(\) <= checkoutStartedAt\.getTime\(\)/);
  assert.match(createCheckoutSession, /calculatedQuote\.usedAt/);
  assert.match(createCheckoutSession, /calculatedQuote\.cartHash !== shippingCartHash\(cart\)/);
  assert.match(createCheckoutSession, /shippingQuote\.update/);
  assert.match(provider, /authorization: `ShippoToken/);
  assert.doesNotMatch(provider, /console\.(log|warn|error).*SHIPPO_API_TOKEN/);
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
  assert.match(persistPaidCheckoutSession, /shippingPackageLengthIn: shippingSnapshot\.shippingPackageLengthIn/);
  assert.match(persistPaidCheckoutSession, /shippingQuotedZip: shippingSnapshot\.shippingQuotedZip/);
  assert.match(persistPaidCheckoutSession, /shippingZipMismatchReview/);
  assert.match(persistPaidCheckoutSession, /shippingPackageProfile: shippingSnapshot\.shippingPackageProfile/);
  assert.match(persistPaidCheckoutSession, /shippingWarnings: stringifyList\(shippingSnapshot\.shippingWarnings\)/);
  assert.match(persistPaidCheckoutSession, /total,/);
  assert.match(persistPaidCheckoutSession, /stripeFeeEstimate: estimateStripeFee\(total\)/);
});
