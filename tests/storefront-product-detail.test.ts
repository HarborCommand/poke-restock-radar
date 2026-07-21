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
  assert.match(productDetail, /className="gdg-product-description-panel"/);
  assert.match(productDetail, /className="gdg-product-details-panel"/);
  assert.match(productDetail, /className="gdg-product-detail-list"/);
  assert.match(productDetail, /Set or series/);
  assert.match(productDetail, /Product type/);
  assert.match(productDetail, /Purchase limit/);
  assert.match(productDetail, /Shipping &amp; Local Pickup/);
  assert.match(productDetail, /Shipping is calculated from package details before payment\./);
  assert.match(productDetail, /Seller &amp; sourcing information/);
  assert.match(productDetail, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  assert.match(productDetail, /GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE/);
  assert.match(productDetail, /GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE/);
  assert.match(productDetail, /product\.localPickupEligible \? <p>Local Pickup appears at checkout when available for this item\.<\/p>/);
  assert.match(productDetail, /variant="product-helper"/);
  assert.match(productDetail, /className="grabby-helper-strip gdg-product-grabby-card"/);
  assert.match(productDetail, /Returns &amp; product support/);
  assert.match(productDetail, /Items are reserved for 15 minutes after checkout begins\./);
  assert.doesNotMatch(productDetail, /What&apos;s included|Product condition|Shipping summary|Checkout hold|Product issue support/);
});

test("product detail keeps purchase controls clear and safe", () => {
  assert.match(productDetail, /const purchaseLimitLabel = storefrontPurchaseLimitLabel\(product\)/);
  assert.match(productDetail, /const rewardEstimateLabel = storefrontRewardEstimateLabel\(product, settings\)/);
  assert.match(client, /if \(isSoldOutProduct\(product\)\) return null;/);
  assert.match(productDetail, /\{purchaseLimitLabel \? <span>\{purchaseLimitLabel\}\.<\/span> : null\}/);
  assert.match(productDetail, /className="gdg-detail-benefits" aria-label="Buying details"/);
  assert.match(productDetail, /STOREFRONT_TAX_PAYMENT_COPY/);
  assert.match(productDetail, /Shipping and any required taxes appear before payment\./);
  assert.match(productDetail, /Estimated from merchandise subtotal only; excludes shipping and tax\./);
  assert.match(productDetail, /Pickup appears as an option in cart when this item is eligible\./);
  assert.match(client, /settings\.checkoutConfigured \? "Add to Cart" : "Request Invoice"/);
  assert.match(productDetail, /Buy Now/);
  assert.match(productDetail, /disabled=\{isSoldOut\}/);
  assert.match(productDetail, /disabled=\{isSoldOut \|\| effectiveMaxQuantity <= 1\}/);
  assert.match(productDetail, /aria-describedby=\{purchaseLimitLabel \? quantityLimitHelpId : undefined\}/);
  assert.doesNotMatch(productDetail, /Limit reached for this item\./);
  assert.doesNotMatch(productDetail, /Stock visible now|per customer/i);
  assert.doesNotMatch(productDetail, /\{product\.availableQuantity\}\s*(?:available|left|in stock)/i);
});

test("product detail trust cards and privacy guardrails stay customer-facing", () => {
  for (const label of ["Sealed products", "Carefully packaged", "Secure checkout", "Order support"]) {
    assert.match(productDetail, new RegExp(label));
  }

  assert.doesNotMatch(productDetail, /Genuine products|guaranteed genuine|certified authentic|100% authentic/i);
  assert.doesNotMatch(productDetail, /card number|cardNumber|CVC|cvv|payment_method_details|raw Stripe object|payment method details/i);
});

test("product detail media and mobile purchase UI stay accessible and contained", () => {
  assert.match(productDetail, /sizes="\(max-width: 768px\) 92vw, 48vw"/);
  assert.match(productDetail, /className="gdg-gallery-thumbs" aria-label="Product images"/);
  assert.match(productDetail, /aria-label=\{`View \$\{productTitle\} image \$\{index \+ 1\}`\}/);
  assert.match(productDetail, /aria-pressed=\{image === visibleSelectedImage\}/);
  assert.match(productDetail, /className="gdg-detail-mobile-quick-action" aria-label="Mobile purchase shortcut"/);
  assert.match(css, /\.gdg-detail-benefits\s*\{[\s\S]*?border-block: 1px solid #e8edf3;/);
  assert.match(css, /\.gdg-detail-benefits span\s*\{[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\);[\s\S]*?min-width: 0;/);
  assert.match(css, /\.gdg-product-detail-list\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-product-detail-list\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /\.gdg-detail-mobile-quick-action\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-detail-mobile-quick-action\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 8px;[\s\S]*?grid-template-columns: minmax\(0, 0\.72fr\) minmax\(0, 1fr\);/);
});

test("product detail disclosures use native accessible accordion semantics", () => {
  assert.match(productDetail, /<details open>/);
  assert.match(productDetail, /<summary>Shipping &amp; Local Pickup<\/summary>/);
  assert.match(productDetail, /<details>\s*\r?\n\s*<summary>Seller &amp; sourcing information<\/summary>/);
  assert.match(productDetail, /<details>\s*\r?\n\s*<summary>Returns &amp; product support<\/summary>/);
  assert.match(css, /\.gdg-product-disclosures summary:focus-visible/);
  assert.doesNotMatch(productDetail, /role="dialog"|aria-modal|focusTrap|tabIndex=\{-1\}/);
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
