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
const summaryMarkup = sourceSlice(cartClient, '<dl className="gdg-summary-rows"', '<div className="gdg-summary-support-copy">');
const summaryCss = sourceSlice(css, ".gdg-summary-rows {", ".gdg-shipping-quote-card {");

test("cart order summary renders concise semantic rows", () => {
  assert.match(summaryMarkup, /<dt>Merchandise subtotal<\/dt>\s*<dd>\{money\(subtotal\)\}<\/dd>/);
  assert.match(summaryMarkup, /<dt>Estimated rewards<\/dt>\s*<dd>\{estimatedRewardPoints\.toLocaleString\(\)\} point/);
  assert.match(summaryMarkup, /<dt>Shipping<\/dt>\s*<dd>\{summaryShippingValue\}<\/dd>/);
  assert.match(summaryMarkup, /<dt>Estimated tax<\/dt>\s*<dd>Calculated at checkout<\/dd>/);
  assert.match(summaryMarkup, /<dt>Estimated total before tax<\/dt>\s*<dd>\{money\(total\)\}<\/dd>/);
  assert.doesNotMatch(summaryMarkup, /Cart estimate|Shipping calculated at checkout \/ pickup|on merchandise only/);
});

test("cart order summary keeps explanations below rows", () => {
  assert.match(cartClient, /Taxes are shown before payment\. Local pickup is free\./);
  assert.match(cartClient, /customerRewardsEnabled \? <p>Rewards apply to eligible merchandise\. Redemption coming soon\.<\/p> : null/);
  assert.doesNotMatch(summaryMarkup, /Rewards apply to eligible merchandise|Taxes are shown before payment|Local pickup is free/);
});

test("shipping display states are concise and do not repeat service in the summary", () => {
  assert.match(cartClient, /const summaryShippingValue =[\s\S]*"Free"[\s\S]*"Calculating…"[\s\S]*money\(shippingQuote\.amount\)[\s\S]*"Recalculate below"[\s\S]*"Enter ZIP below"/);
  assert.match(cartClient, /<strong>\{shippingQuote\.fallbackUsed \? "Standard Shipping Estimate" : shippingQuote\.service\}<\/strong>/);
  assert.doesNotMatch(sourceSlice(cartClient, "const summaryShippingValue =", "const grabbyShippingTipMessage ="), /shippingQuote\.service/);
});

test("Grabby shipping guidance covers pre quote loading success pickup error and stale states", () => {
  assert.match(cartClient, /const grabbyShippingTipMessage =[\s\S]*"Local pickup selected\. No shipping charge\."/);
  assert.match(cartClient, /"Calculating USPS shipping…"/);
  assert.match(cartClient, /"Shipping calculated! You’re ready to continue to checkout\."/);
  assert.match(cartClient, /"Check your ZIP and try calculating shipping again\."/);
  assert.match(cartClient, /"Enter your ZIP to see USPS shipping\."/);
  assert.match(cartClient, /updateDestinationZip\(value: string\)[\s\S]*setShippingQuote\(null\)[\s\S]*setShippingQuoteMessage\(""\)/);
  assert.match(cartClient, /const quoteResetKey = JSON\.stringify\(\{ items, fulfillmentMethod \}\)/);
  assert.match(cartClient, /setShippingQuote\(null\);\s*setShippingQuoteMessage\(hadQuote && fulfillmentMethod === "shipping" \? "Cart changed\. Recalculate shipping\." : ""\)/);
  assert.ok(
    cartClient.indexOf('className="gdg-cart-grabby-tip"') > cartClient.indexOf('onlineTaxEnabled && fulfillmentMethod === "pickup"'),
    "Grabby shipping tip must stay outside the shipping-only form so pickup can show its state"
  );
});

test("summary CSS preserves readable two column rows on mobile", () => {
  assert.match(summaryCss, /grid-template-columns: minmax\(0, 1fr\) max-content/);
  assert.match(summaryCss, /text-align: right/);
  assert.match(summaryCss, /word-break: normal/);
  assert.match(summaryCss, /overflow-wrap: normal/);
  assert.doesNotMatch(summaryCss, /break-all|line-clamp|text-overflow|ellipsis|overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /\.gdg-summary-rows (?:span|strong)[\s\S]*overflow-wrap: anywhere/);
});
