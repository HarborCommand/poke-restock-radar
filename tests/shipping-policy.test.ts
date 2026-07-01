import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { calculateCartShipping, explainCartShippingCalculation, type ShippingCartItem } from "../src/lib/shipping";
import { applyMerchantShippingPolicyToCarrierQuote, getMerchantShippingFloor } from "../src/lib/shipping-policy";
import type { NormalizedShippingQuote } from "../src/lib/shipping-rate-provider";

function shippableItem(overrides: ShippingCartItem = {}): ShippingCartItem {
  return {
    id: "item-1",
    title: "Test Product",
    quantity: 1,
    shippingProfile: "sealed_pack_small",
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

function shippoQuote(amountCents: number): NormalizedShippingQuote {
  return {
    provider: "shippo",
    carrier: "USPS",
    service: "USPS Ground Advantage",
    amountCents,
    currency: "USD",
    estimatedDays: 3,
    rateProviderRef: "rate_test",
    shipmentProviderRef: "shipment_test",
    expiresAt: new Date("2026-07-01T12:00:00.000Z"),
    fallbackUsed: false,
    warning: null
  };
}

function adjustedAmountForCart(items: ShippingCartItem[], carrierAmountCents = 570) {
  const shippingCalculation = calculateCartShipping(items, { fulfillmentMethod: "shipping" });
  return applyMerchantShippingPolicyToCarrierQuote(shippoQuote(carrierAmountCents), shippingCalculation);
}

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

test("merchant shipping floor raises a one-item low carrier quote to the small floor", () => {
  const result = adjustedAmountForCart([shippableItem()], 570);

  assert.equal(result.minimumAmountCents, 799);
  assert.equal(result.policyApplied, true);
  assert.equal(result.quote.amountCents, 799);
});

test("merchant shipping floor raises a three-item cart to the normal floor", () => {
  const result = adjustedAmountForCart([shippableItem({ quantity: 3 })], 570);

  assert.equal(result.minimumAmountCents, 999);
  assert.equal(result.policyApplied, true);
  assert.equal(result.quote.amountCents, 999);
});

test("merchant shipping floor raises a nine-item cart to the large cart floor", () => {
  const result = adjustedAmountForCart([shippableItem({ quantity: 9 })], 570);

  assert.equal(result.minimumAmountCents, 1299);
  assert.equal(result.policyApplied, true);
  assert.equal(result.quote.amountCents, 1299);
});

test("merchant shipping floor raises a ten-item cart to the very large cart floor", () => {
  const result = adjustedAmountForCart([shippableItem({ quantity: 10 })], 570);

  assert.equal(result.minimumAmountCents, 1499);
  assert.equal(result.policyApplied, true);
  assert.equal(result.quote.amountCents, 1499);
});

test("merchant shipping policy keeps a higher real Shippo rate unchanged", () => {
  const result = adjustedAmountForCart([shippableItem({ quantity: 9 })], 1850);

  assert.equal(result.minimumAmountCents, 1299);
  assert.equal(result.policyApplied, false);
  assert.equal(result.quote.amountCents, 1850);
});

test("merchant shipping floor keeps local pickup free", () => {
  const shippingCalculation = calculateCartShipping([shippableItem({ quantity: 10 })], { fulfillmentMethod: "pickup" });

  assert.equal(shippingCalculation.defaultShippingOption?.id, "local_pickup");
  assert.equal(shippingCalculation.defaultShippingOption?.amount, 0);
  assert.equal(getMerchantShippingFloor(shippingCalculation, { fulfillmentMethod: "pickup" }), 0);
});

test("reported nine-item ZIP 33135 low Shippo quote is raised to the large cart floor", () => {
  const cart = Array.from({ length: 9 }, (_, index) =>
    shippableItem({
      id: `sealed-product-${index + 1}`,
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 4,
      packageLengthIn: 6,
      packageWidthIn: 4,
      packageHeightIn: 1
    })
  );
  const shippingCalculation = calculateCartShipping(cart, { subtotal: 355.97, fulfillmentMethod: "shipping" });
  const audit = explainCartShippingCalculation(cart);
  const result = applyMerchantShippingPolicyToCarrierQuote(shippoQuote(570), shippingCalculation);

  assert.equal(audit.totalUnits, 9);
  assert.equal(shippingCalculation.totalUnits, 9);
  assert.equal(result.baseAmountCents, 570);
  assert.equal(result.minimumAmountCents, 1299);
  assert.equal(result.quote.amountCents, 1299);
  assert.equal(result.quote.service, "USPS Ground Advantage");
});

test("checkout revalidates stored quotes with the tiered server policy", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const createCheckoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );
  const checkoutQuoteValidation = sourceSlice(
    createCheckoutSession,
    "calculatedQuote = await prisma.shippingQuote.findUnique",
    "selectedShipping = shippingOptionFromQuote(calculatedQuote);"
  );
  const quoteUseTransaction = sourceSlice(
    createCheckoutSession,
    "if (calculatedQuote) {",
    "return tx.storefrontOrder.update"
  );

  assert.match(storefront, /function applyMerchantShippingPolicyToStoredQuote/);
  assert.match(checkoutQuoteValidation, /calculatedQuote = applyMerchantShippingPolicyToStoredQuote\(calculatedQuote, shippingCalculation\)/);
  assert.match(createCheckoutSession, /selectedShipping = shippingOptionFromQuote\(calculatedQuote\)/);
  assert.match(createCheckoutSession, /shippingQuotedAmountCents: calculatedQuote\?\.amountCents \?\? null/);
  assert.match(quoteUseTransaction, /amountCents: calculatedQuote\.amountCents/);
});

test("browser-provided shipping amounts cannot bypass the tiered floor", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const validation = readProjectFile("src/lib/validation.ts");
  const createCheckoutSessionSignature = sourceSlice(
    storefront,
    "export async function createCheckoutSession(input: {",
    "}, options:"
  );
  const checkoutSchema = sourceSlice(validation, "export const storefrontCheckoutSchema", "export const storefrontShippingQuoteSchema");

  assert.match(createCheckoutSessionSignature, /shippingQuoteToken\?: string/);
  assert.doesNotMatch(createCheckoutSessionSignature, /shippingAmount|shippingCents|amountCents|shippingCharge|shippingCharged/);
  assert.doesNotMatch(checkoutSchema, /shippingAmount|shippingCents|amountCents|shippingCharge|shippingCharged/);
});
