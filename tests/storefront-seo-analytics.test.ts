import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  sanitizeStorefrontAnalyticsPayload,
  STOREFRONT_ANALYTICS_EVENTS,
  trackStorefrontEvent
} from "../src/lib/storefront-analytics";
import { storefrontOrganizationJsonLd } from "../src/lib/storefront-seo";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const client = readProjectFile("src/components/StorefrontClient.tsx");
const serverViews = readProjectFile("src/components/StorefrontServerViews.tsx");
const accountPage = readProjectFile("src/app/account/page.tsx");
const accountOrdersPage = readProjectFile("src/app/account/orders/page.tsx");
const orderStatusPage = readProjectFile("src/app/order-status/page.tsx");
const cartPage = readProjectFile("src/app/cart/page.tsx");
const checkoutSuccessPage = readProjectFile("src/app/checkout/success/page.tsx");
const checkoutCancelPage = readProjectFile("src/app/checkout/cancel/page.tsx");
const sitemap = readProjectFile("src/app/sitemap.ts");
const robots = readProjectFile("src/app/robots.ts");
const analyticsCalls = [...client.matchAll(/trackStorefrontEvent\([\s\S]*?\);/g)].map((match) => match[0]).join("\n");

test("storefront analytics has a strict event allowlist and no-op failure path", () => {
  assert.deepEqual([...STOREFRONT_ANALYTICS_EVENTS], [
    "product_viewed",
    "shop_searched",
    "shop_filter_used",
    "product_added_to_cart",
    "product_removed_from_cart",
    "checkout_started",
    "local_pickup_selected",
    "purchase_completed",
    "account_login_requested"
  ]);
  assert.doesNotThrow(() => trackStorefrontEvent("product_viewed", { productSlug: "safe-product", productCategory: "Pokemon Sealed" }));
  assert.doesNotThrow(() => trackStorefrontEvent("checkout_started", { itemCount: 2, fulfillmentMethod: "shipping", checkoutMode: "stripe" }));
});

test("storefront analytics payload sanitizer redacts PII and provider identifiers", () => {
  const payload = sanitizeStorefrontAnalyticsPayload({
    productSlug: "safe-product<script>",
    productCategory: "Pokemon Sealed",
    productStatus: "active",
    quantity: 2,
    itemCount: 3,
    fulfillmentMethod: "pickup",
    checkoutMode: "stripe",
    hasQuery: true,
    filterCount: 2,
    resultCount: 12,
    source: "cart",
    customerEmail: "buyer@example.test",
    phone: "555-111-2222",
    addressLine1: "1 Private St",
    customerNote: "leave at door",
    stripeCheckoutSessionId: "cs_test_secret",
    paymentReference: "pi_test_secret",
    orderNumber: "PR-PRIVATE",
    customerAccountId: "acct_private"
  } as never);

  assert.equal(payload.productSlug, "safe-productscript");
  assert.equal(payload.productCategory, "Pokemon Sealed");
  assert.equal(payload.fulfillmentMethod, "pickup");
  assert.equal(payload.checkoutMode, "stripe");
  assert.equal(payload.hasQuery, true);
  assert.equal(payload.itemCount, 3);
  assert.doesNotMatch(JSON.stringify(payload), /buyer@example|555|Private St|leave at door|cs_test|pi_test|PR-PRIVATE|acct_private|customerEmail|phone|address|note|stripeCheckoutSessionId|paymentReference|orderNumber|customerAccountId/i);
});

test("storefront client wires only privacy-safe analytics events", () => {
  for (const event of ["product_viewed", "product_added_to_cart", "product_removed_from_cart", "checkout_started", "local_pickup_selected", "purchase_completed", "account_login_requested"]) {
    assert.match(client, new RegExp(`trackStorefrontEvent\\("${event}"`));
  }
  assert.match(client, /"shop_searched"/);
  assert.match(client, /"shop_filter_used"/);
  assert.match(client, /filters\.q \? "shop_searched" : "shop_filter_used"/);
  assert.match(client, /hasQuery: Boolean\(filters\.q\)/);
  assert.match(client, /filterCount:/);
  assert.match(client, /resultCount: payload\.total/);
  assert.match(client, /productSlug: product\.slug/);
  assert.match(client, /productCategory: displayStorefrontCategory\(product\)/);
  assert.match(client, /fulfillmentMethod,\s*\r?\n\s*checkoutMode: isStripeCheckout \? "stripe" : "invoice"/);
  assert.match(client, /trackStorefrontEvent\("purchase_completed", \{\s*\r?\n\s*source: "checkout_success",\s*\r?\n\s*checkoutMode: "stripe",\s*\r?\n\s*hasQuery: Boolean\(orderReference\)/);
  assert.doesNotMatch(analyticsCalls, /customerEmail|customerPhone|customerName|customerNotes|destinationZip|shippingQuoteToken|checkoutUrl|stripeCheckoutSessionId|stripePaymentIntentId|payment_method|cardNumber|cvc|auth|token|secret/i);
  assert.doesNotMatch(analyticsCalls, /orderReference\s*[,}]/);
});

test("private storefront routes are noindexed and excluded from sitemap or robots allowlist", () => {
  for (const page of [accountPage, accountOrdersPage, orderStatusPage, cartPage, checkoutSuccessPage, checkoutCancelPage]) {
    assert.match(page, /robots:\s*\{\s*\r?\n\s*index:\s*false,\s*\r?\n\s*follow:\s*false/);
  }
  assert.doesNotMatch(sitemap, /\/account|\/cart|\/shop\/cart|\/checkout\//);
  for (const privatePath of ["/admin", "/app", "/account", "/dashboard", "/api/", "/cart", "/shop/cart", "/checkout/"]) {
    assert.match(robots, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("organization structured data uses verified store facts only", () => {
  const organization = storefrontOrganizationJsonLd() as Record<string, unknown>;
  assert.equal(organization["@type"], "Organization");
  assert.equal(organization.name, "GameDayGrabs");
  assert.equal(organization.legalName, "GameDayGrabs LLC");
  assert.match(String(organization.url), /^https:\/\//);
  assert.match(String(organization.logo), /^https:\/\//);
  assert.match(String(organization.email), /@/);
  assert.match(serverViews, /storefrontOrganizationJsonLd\(\)/);
  assert.match(serverViews, /type="application\/ld\+json"/);
  assert.doesNotMatch(JSON.stringify(organization) + serverViews, /official Pok[eé]mon|authorized distributor|certified|sameAs|streetAddress|postalCode|addressLocality|telephone/i);
});
