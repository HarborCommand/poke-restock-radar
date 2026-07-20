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

const client = readProjectFile("src/components/StorefrontClient.tsx");
const css = readProjectFile("src/app/globals.css");
const cartClient = sourceSlice(client, "export function CartClient", "export function CheckoutSuccessClient");
const checkoutFunction = sourceSlice(cartClient, "async function checkout", "return (");

test("cart summary separates merchandise rewards shipping pickup and tax without browser-authoritative tax", () => {
  assert.match(cartClient, /const subtotal = products\.reduce\(\(sum, product\) => sum \+ product\.price \* product\.requestedQuantity, 0\)/);
  assert.match(cartClient, /const estimatedRewardPoints = settings\.customerAccounts\.enabled && settings\.customerAccounts\.rewardsEnabled \? Math\.floor\(Math\.max\(0, subtotal\)\) : 0/);
  assert.match(cartClient, /Merchandise subtotal/);
  assert.match(cartClient, /Estimated rewards/);
  assert.match(cartClient, /on merchandise only/);
  assert.match(cartClient, /const rewardProgramCopy = storefrontRewardsProgramCopy\(settings\)/);
  assert.match(cartClient, /on merchandise only\. \{rewardProgramCopy\}/);
  assert.match(cartClient, /Shipping calculated at checkout \/ pickup/);
  assert.match(cartClient, /STOREFRONT_TAX_PAYMENT_COPY/);
  assert.match(cartClient, /Shipping stays separate from any required taxes\./);
  assert.match(cartClient, /Cart estimate/);
  assert.doesNotMatch(cartClient, /taxEstimate|estimatedTax|browserTax|clientTax|Tax is not estimated from the browser cart/i);
});

test("cart rows expose compact fulfillment badges and preserve quantity controls", () => {
  assert.match(cartClient, /className="gdg-cart-line-badges" aria-label=\{`Fulfillment options for \$\{title\}`\}/);
  assert.match(cartClient, /product\.shippingAvailable \? <span>Ships<\/span> : null/);
  assert.match(cartClient, /product\.localPickupEligible \? <span>Local Pickup<\/span> : null/);
  assert.match(cartClient, /aria-label=\{`Decrease \$\{title\} quantity`\}/);
  assert.match(cartClient, /aria-label=\{`Increase \$\{title\} quantity`\}/);
  assert.match(cartClient, /aria-label=\{`Remove \$\{title\}`\}/);
  assert.match(css, /\.gdg-cart-line-badges\s*\{[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /\.gdg-cart-line-badges span\s*\{[\s\S]*?border-radius: 999px;/);
});

test("mobile checkout action stays reachable without adding a second checkout path", () => {
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-checkout-panel\s*\{[\s\S]*?position: static;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-checkout-panel \.gdg-checkout-button\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 8px;/);
  assert.equal((cartClient.match(/onClick=\{checkout\}/g) ?? []).length, 1);
  assert.match(cartClient, /Proceed to Secure Checkout/);
});

test("checkout payload remains server-authoritative and does not include browser totals rewards or tax", () => {
  assert.match(checkoutFunction, /items,\s*\r?\n\s*fulfillmentMethod/);
  assert.match(checkoutFunction, /shippingQuoteToken\?: string/);
  assert.match(checkoutFunction, /fetch\(isStripeCheckout \? "\/api\/storefront\/checkout\/session" : "\/api\/storefront\/invoice-request"/);
  assert.doesNotMatch(checkoutFunction, /subtotal|estimatedRewardPoints|reward|points|tax/i);
  assert.doesNotMatch(checkoutFunction, /requestPayload\.(?:total|shipping|subtotal)\b|\b(total|shipping|subtotal)\?:|\b(total|shipping|subtotal):\s*(?!CartItem\[\])/i);
  assert.doesNotMatch(checkoutFunction, /stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvv|metadata/i);
});
