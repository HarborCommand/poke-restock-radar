import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
const productDetailStart = client.indexOf("export function ProductDetail");
const productDetailEnd = client.indexOf("function cartStockState");

assert.notEqual(productDetailStart, -1, "ProductDetail component should exist");
assert.notEqual(productDetailEnd, -1, "cartStockState should follow ProductDetail");

const productDetail = client.slice(productDetailStart, productDetailEnd);

test("product detail renders retailer-style buyer clarity sections", () => {
  assert.match(productDetail, /className="gdg-detail-info gdg-purchase-panel"/);
  assert.match(productDetail, /Product Description/);
  assert.match(productDetail, /What&apos;s included/);
  assert.match(productDetail, /Product condition/);
  assert.match(productDetail, /Condition details are based on the listing information\./);
  assert.match(productDetail, /Shipping summary/);
  assert.match(productDetail, /Shipping is calculated from product weight and package size\./);
  assert.match(productDetail, /Final shipping is shown before payment\./);
  assert.match(productDetail, /product\.localPickupEligible \? <li>Local pickup may be available for this item\.<\/li>/);
  assert.match(productDetail, /Checkout hold/);
  assert.match(productDetail, /Items are held for 15 minutes once checkout starts\./);
});

test("product detail keeps purchase controls clear and safe", () => {
  assert.match(productDetail, /const purchaseLimitLabel = storefrontPurchaseLimitLabel\(product\)/);
  assert.match(productDetail, /\{purchaseLimitLabel \? <span>\{purchaseLimitLabel\}\.<\/span> : null\}/);
  assert.match(client, /settings\.checkoutConfigured \? "Add to Cart" : "Request Invoice"/);
  assert.match(productDetail, /Buy Now/);
  assert.match(productDetail, /disabled=\{isSoldOut\}/);
  assert.match(productDetail, /disabled=\{isSoldOut \|\| quantity >= effectiveMaxQuantity\}/);
  assert.doesNotMatch(productDetail, /Stock visible now|per customer/i);
  assert.doesNotMatch(productDetail, /\{product\.availableQuantity\}\s*(?:available|left|in stock)/i);
});

test("product detail trust cards and privacy guardrails stay customer-facing", () => {
  for (const label of ["Authentic", "Carefully packaged", "Secure checkout", "Order support"]) {
    assert.match(productDetail, new RegExp(label));
  }

  assert.doesNotMatch(productDetail, /card number|cardNumber|CVC|cvv|payment_method_details|raw Stripe object|payment method details/i);
});
