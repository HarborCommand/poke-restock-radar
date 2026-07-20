import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
const serverViews = fs.readFileSync(new URL("../src/components/StorefrontServerViews.tsx", import.meta.url), "utf8");
const productDetailStart = client.indexOf("export function ProductDetail");
const productDetailEnd = client.indexOf("function cartStockState");
const relatedProductsStart = storefront.indexOf("export async function getRelatedPublicStoreProducts");
const relatedProductsEnd = storefront.indexOf("export async function getCartProducts");

assert.notEqual(productDetailStart, -1, "ProductDetail component should exist");
assert.notEqual(productDetailEnd, -1, "cartStockState should follow ProductDetail");
assert.notEqual(relatedProductsStart, -1, "related products helper should exist");
assert.notEqual(relatedProductsEnd, -1, "cart products helper should follow related products helper");

const productDetail = client.slice(productDetailStart, productDetailEnd);
const relatedProducts = storefront.slice(relatedProductsStart, relatedProductsEnd);

test("product detail renders retailer-style buyer clarity sections", () => {
  assert.match(productDetail, /className="gdg-detail-info gdg-purchase-panel"/);
  assert.match(productDetail, /Product Description/);
  assert.match(productDetail, /What&apos;s included/);
  assert.match(productDetail, /productIncludedBullets\(product, displayCategory, conditionLabel\)/);
  assert.match(client, /Product type: \$\{displayCategory\}\./);
  assert.match(client, /Condition shown by listing: \$\{conditionLabel\}\./);
  assert.match(productDetail, /Product condition/);
  assert.match(productDetail, /Condition details are based on the listing information\./);
  assert.match(productDetail, /Shipping summary/);
  assert.match(productDetail, /Shipping is calculated from product weight and package size\./);
  assert.match(productDetail, /Final shipping is shown before payment\./);
  assert.match(productDetail, /Seller and authenticity/);
  assert.match(productDetail, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  assert.match(productDetail, /GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE/);
  assert.match(productDetail, /GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE/);
  assert.match(productDetail, /product\.localPickupEligible \? <li>Local pickup may be available for this item\.<\/li>/);
  assert.match(productDetail, /Local pickup appears at checkout when available for this item\./);
  assert.match(productDetail, /variant="product-helper"/);
  assert.match(productDetail, /className="grabby-helper-strip gdg-product-grabby-card"/);
  assert.match(productDetail, /Checkout hold/);
  assert.match(productDetail, /Items are held for 15 minutes once checkout starts\./);
});

test("product detail keeps purchase controls clear and safe", () => {
  assert.match(productDetail, /const purchaseLimitLabel = storefrontPurchaseLimitLabel\(product\)/);
  assert.match(productDetail, /const rewardEstimateLabel = storefrontRewardEstimateLabel\(product, settings\)/);
  assert.match(client, /if \(isSoldOutProduct\(product\)\) return null;/);
  assert.match(productDetail, /\{purchaseLimitLabel \? <span>\{purchaseLimitLabel\}\.<\/span> : null\}/);
  assert.match(productDetail, /className="gdg-detail-purchase-facts" aria-label="Buying details"/);
  assert.match(productDetail, /STOREFRONT_TAX_PAYMENT_COPY/);
  assert.match(productDetail, /Shipping and any required taxes appear before payment\./);
  assert.match(productDetail, /Estimated from merchandise subtotal only; excludes shipping and tax\./);
  assert.match(productDetail, /Pickup appears as an option in cart when this item is eligible\./);
  assert.match(client, /settings\.checkoutConfigured \? "Add to Cart" : "Request Invoice"/);
  assert.match(productDetail, /Buy Now/);
  assert.match(productDetail, /disabled=\{isSoldOut\}/);
  assert.match(productDetail, /disabled=\{isSoldOut \|\| quantity >= effectiveMaxQuantity\}/);
  assert.doesNotMatch(productDetail, /Stock visible now|per customer/i);
  assert.doesNotMatch(productDetail, /\{product\.availableQuantity\}\s*(?:available|left|in stock)/i);
});

test("product detail trust cards and privacy guardrails stay customer-facing", () => {
  for (const label of ["Genuine products", "Carefully packaged", "Secure checkout", "Order support"]) {
    assert.match(productDetail, new RegExp(label));
  }

  assert.doesNotMatch(productDetail, /card number|cardNumber|CVC|cvv|payment_method_details|raw Stripe object|payment method details/i);
});

test("product detail media and mobile purchase UI stay accessible and contained", () => {
  assert.match(productDetail, /sizes="\(max-width: 768px\) 92vw, 48vw"/);
  assert.match(productDetail, /className="gdg-gallery-thumbs" aria-label="Product images"/);
  assert.match(productDetail, /aria-label=\{`View \$\{productTitle\} image \$\{index \+ 1\}`\}/);
  assert.match(productDetail, /aria-pressed=\{image === visibleSelectedImage\}/);
  assert.match(productDetail, /className="gdg-detail-mobile-quick-action" aria-label="Mobile purchase shortcut"/);
  assert.match(css, /\.gdg-detail-purchase-facts\s*\{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 180px\), 1fr\)\);/);
  assert.match(css, /\.gdg-detail-purchase-facts span\s*\{[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\);[\s\S]*?min-width: 0;/);
  assert.match(css, /\.gdg-detail-mobile-quick-action\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-detail-mobile-quick-action\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 8px;[\s\S]*?grid-template-columns: minmax\(0, 0\.72fr\) minmax\(0, 1fr\);/);
});

test("related products are selected with a bounded public-only query", () => {
  assert.match(serverViews, /getRelatedPublicStoreProducts\(product, 4\)/);
  assert.match(relatedProducts, /id: \{ not: product\.id \}/);
  assert.match(relatedProducts, /publishToStore: true/);
  assert.match(relatedProducts, /storeStatus: "active"/);
  assert.match(relatedProducts, /isPublicStorefrontListingSellable\(item\)/);
  assert.match(relatedProducts, /publicPrice: \{ not: null \}/);
  assert.match(relatedProducts, /publicSlug: \{ not: null \}/);
  assert.match(relatedProducts, /take/);
  assert.match(relatedProducts, /compareRelatedStorefrontProducts\(product\)/);
  assert.match(relatedProducts, /uniqueStorefrontProducts\(sellableProducts\)/);
  assert.match(relatedProducts, /\.slice\(0, limit\)/);
  assert.doesNotMatch(relatedProducts, /customer|reward|payment|refund|metadata|idempotencyKey/i);
});
