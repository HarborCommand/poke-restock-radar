import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GAMEDAYGRABS_RETURNS_POLICY_URL,
  productCanonicalUrl,
  storefrontOfferShippingDetails,
  storefrontProductJsonLd,
  storefrontProductMetadata,
  storefrontProductSchemaAvailability
} from "../src/lib/storefront-seo";
import {
  isPublicStorefrontListingIndexable,
  isPublicStorefrontListingSellable,
  isPublicStorefrontListingVisible,
  PUBLIC_STOREFRONT_VISIBLE_STATUSES
} from "../src/lib/storefront";
import {
  getStorefrontCollection,
  storefrontCollectionBreadcrumbJsonLd,
  storefrontCollectionItemListJsonLd,
  storefrontCollectionMetadata,
  storefrontCollectionProducts,
  storefrontCollectionUrl
} from "../src/lib/storefront-collections";
import type { PublicStoreProductDTO } from "../src/types/radar";

function product(overrides: Partial<PublicStoreProductDTO> = {}): PublicStoreProductDTO {
  return {
    id: "seo-product",
    slug: "pokemon-seo-product",
    title: "Pokemon SEO Product",
    description: "A sealed Pokemon product packed carefully for collectors.",
    price: 49.99,
    compareAtPrice: null,
    imageUrl: "https://cdn.example.com/product.jpg",
    primaryImageUrl: "https://cdn.example.com/product.jpg",
    images: ["https://cdn.example.com/product.jpg"],
    category: "Premium Collections",
    tags: ["Pokemon", "Premium Collections"],
    condition: "New sealed",
    brand: "Pokemon",
    manufacturer: "The Pokemon Company",
    sku: "PKM-SEO-1",
    upc: "123456789012",
    publicMaxQuantity: 4,
    availabilityLevel: "low_stock",
    maxQuantityPerOrder: null,
    status: "active",
    localPickupAvailable: true,
    localPickupEligible: true,
    shippingAvailable: true,
    shippingProfile: "small_box",
    packageWeightOz: 16,
    packageLengthIn: 9,
    packageWidthIn: 6,
    packageHeightIn: 4,
    shippingMetadataSource: null,
    freeShippingEligible: false,
    requiresBox: true,
    insuranceRecommended: false,
    needsShippingProfile: false,
    publishedAt: "2026-06-15T00:00:00.000Z",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    ...overrides
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("product SEO metadata uses real product data and canonical URLs", () => {
  const metadata = storefrontProductMetadata(product());
  assert.equal(metadata.title, "Pokémon SEO Product | GameDayGrabs");
  assert.match(String(metadata.description), /Shop Pokémon SEO Product from GameDayGrabs/);
  assert.match(String(metadata.description), /Premium Collections/);
  assert.match(String(metadata.description), /\$49\.99/);
  assert.match(String(metadata.description), /In stock/);
  assert.equal(metadata.alternates?.canonical, productCanonicalUrl("pokemon-seo-product"));
  assert.equal(metadata.robots, undefined);

  const openGraph = metadata.openGraph as { url?: string; images?: string[] };
  assert.equal(openGraph.url, productCanonicalUrl("pokemon-seo-product"));
  assert.deepEqual(openGraph.images, ["https://cdn.example.com/product.jpg"]);

  const twitter = metadata.twitter as { card?: string; images?: string[] };
  assert.equal(twitter.card, "summary_large_image");
  assert.deepEqual(twitter.images, ["https://cdn.example.com/product.jpg"]);
});

test("product SEO descriptions use cleaned public copy without admin labels or raw HTML", () => {
  const dirty = product({
    description: "Product Details Card Text: <script>alert('x')</script><p>Factory sealed display item with clean customer-facing product details.</p>"
  });
  const metadata = storefrontProductMetadata(dirty);
  const jsonLd = jsonObject(storefrontProductJsonLd(dirty));

  assert.match(String(metadata.description), /Factory sealed display item/);
  assert.match(String(jsonLd.description), /Factory sealed display item/);
  assert.doesNotMatch(String(metadata.description), /Product Details Card Text|script|alert|<p>|admin/i);
  assert.doesNotMatch(String(jsonLd.description), /Product Details Card Text|script|alert|<p>|admin/i);
});

test("active sold-out product metadata remains public and indexable", () => {
  const metadata = storefrontProductMetadata(product({ publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" }));

  assert.equal(metadata.alternates?.canonical, productCanonicalUrl("pokemon-seo-product"));
  assert.equal(metadata.robots, undefined);
  assert.match(String(metadata.description), /Out of stock/);
});

test("product structured data renders safe Product and Offer fields only", () => {
  const jsonLd = jsonObject(storefrontProductJsonLd(product()));
  const brand = jsonObject(jsonLd.brand);
  const manufacturer = jsonObject(jsonLd.manufacturer);
  const offers = jsonObject(jsonLd.offers);
  const shippingDetails = jsonObject(offers.shippingDetails);
  const shippingDestination = jsonObject(shippingDetails.shippingDestination);
  const shippingRate = jsonObject(shippingDetails.shippingRate);
  const deliveryTime = jsonObject(shippingDetails.deliveryTime);
  const businessDays = jsonObject(deliveryTime.businessDays);
  const handlingTime = jsonObject(deliveryTime.handlingTime);
  const transitTime = jsonObject(deliveryTime.transitTime);
  const returnPolicy = jsonObject(offers.hasMerchantReturnPolicy);
  const seller = jsonObject(offers.seller);
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "Product");
  assert.equal(jsonLd.name, "Pokémon SEO Product");
  assert.equal(jsonLd.category, "Premium Collections");
  assert.equal(jsonLd.url, productCanonicalUrl("pokemon-seo-product"));
  assert.equal(brand.name, "Pokemon");
  assert.equal(manufacturer.name, "The Pokemon Company");
  assert.equal(jsonLd.sku, "PKM-SEO-1");
  assert.equal(jsonLd.gtin12, "123456789012");
  assert.equal(offers["@type"], "Offer");
  assert.equal(offers.price, "49.99");
  assert.equal(offers.priceCurrency, "USD");
  assert.equal(offers.availability, "https://schema.org/InStock");
  assert.equal(shippingDetails["@type"], "OfferShippingDetails");
  assert.equal(shippingDestination.addressCountry, "US");
  assert.equal(shippingRate.currency, "USD");
  assert.equal(shippingRate.value, "7.99");
  assert.notEqual(shippingRate.value, "4.99");
  assert.notEqual(shippingRate.value, "0.00");
  assert.deepEqual(businessDays.dayOfWeek, [
    "https://schema.org/Monday",
    "https://schema.org/Tuesday",
    "https://schema.org/Wednesday",
    "https://schema.org/Thursday",
    "https://schema.org/Friday"
  ]);
  assert.equal(handlingTime.minValue, 1);
  assert.equal(handlingTime.maxValue, 2);
  assert.equal(handlingTime.unitCode, "d");
  assert.equal(transitTime.minValue, 2);
  assert.equal(transitTime.maxValue, 5);
  assert.equal(transitTime.unitCode, "d");
  assert.equal(returnPolicy["@type"], "MerchantReturnPolicy");
  assert.equal(returnPolicy.applicableCountry, "US");
  assert.equal(returnPolicy.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted");
  assert.equal(returnPolicy.merchantReturnLink, GAMEDAYGRABS_RETURNS_POLICY_URL);
  assert.equal(seller.name, "GameDayGrabs");
  assert.equal(seller.legalName, "GameDayGrabs LLC");
  assert.equal(seller.url, "https://www.gamedaygrabs.com");

  const serialized = JSON.stringify(jsonLd);
  // Real first-party product reviews are not visible on product pages yet, so review and aggregateRating markup stay intentionally absent.
  assert.doesNotMatch(serialized, /aggregateRating|review|ratingValue|ratingCount/i);
  assert.doesNotMatch(serialized, /availableQuantity|quantityOwned|costBasis|supplier|admin/i);
  assert.doesNotMatch(serialized, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
});

test("product structured data never advertises shipping below the public small-cart floor", () => {
  const jsonLd = jsonObject(storefrontProductJsonLd(
    product({
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 4,
      packageLengthIn: 8,
      packageWidthIn: 5,
      packageHeightIn: 1,
      requiresBox: false
    })
  ));
  const offers = jsonObject(jsonLd.offers);
  const shippingDetails = jsonObject(offers.shippingDetails);
  const shippingRate = jsonObject(shippingDetails.shippingRate);

  assert.equal(shippingRate.currency, "USD");
  assert.equal(shippingRate.value, "7.99");
  assert.notEqual(shippingRate.value, "4.99");
});

test("product structured data omits shipping details when carrier shipping is unavailable", () => {
  const pickupOnly = product({ shippingAvailable: false, localPickupAvailable: true, localPickupEligible: true, shippingProfile: "local_pickup", packageWeightOz: 0 });
  assert.equal(storefrontOfferShippingDetails(pickupOnly), null);

  const jsonLd = jsonObject(storefrontProductJsonLd(pickupOnly));
  const offers = jsonObject(jsonLd.offers);
  const returnPolicy = jsonObject(offers.hasMerchantReturnPolicy);
  assert.equal(offers.shippingDetails, undefined);
  assert.equal(returnPolicy.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted");
});

test("sold-out structured data does not claim in-stock availability", () => {
  const soldOut = product({ publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" });
  assert.equal(storefrontProductSchemaAvailability(soldOut), "https://schema.org/OutOfStock");
  const jsonLd = jsonObject(storefrontProductJsonLd(soldOut));
  const offers = jsonObject(jsonLd.offers);
  assert.equal(offers.availability, "https://schema.org/OutOfStock");
  assert.notEqual(offers.availability, "https://schema.org/InStock");
  assert.equal(offers.price, "49.99");
  assert.equal(offers.url, productCanonicalUrl("pokemon-seo-product"));
});

test("product pages, sitemap, and robots are wired for Google-ready discovery", () => {
  const productRoute = fs.readFileSync(new URL("../src/app/product/[slug]/page.tsx", import.meta.url), "utf8");
  const shopProductRoute = fs.readFileSync(new URL("../src/app/shop/product/[slug]/page.tsx", import.meta.url), "utf8");
  const collectionRoute = fs.readFileSync(new URL("../src/app/collections/[slug]/page.tsx", import.meta.url), "utf8");
  const homePage = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const shopPage = fs.readFileSync(new URL("../src/app/shop/page.tsx", import.meta.url), "utf8");
  const aboutPage = fs.readFileSync(new URL("../src/app/about/page.tsx", import.meta.url), "utf8");
  const policiesPage = fs.readFileSync(new URL("../src/app/policies/page.tsx", import.meta.url), "utf8");
  const shippingPolicyPage = fs.readFileSync(new URL("../src/app/policies/shipping/page.tsx", import.meta.url), "utf8");
  const returnsPolicyPage = fs.readFileSync(new URL("../src/app/policies/returns/page.tsx", import.meta.url), "utf8");
  const privacyPage = fs.readFileSync(new URL("../src/app/privacy/page.tsx", import.meta.url), "utf8");
  const termsPage = fs.readFileSync(new URL("../src/app/terms/page.tsx", import.meta.url), "utf8");
  const contactPage = fs.readFileSync(new URL("../src/app/contact/page.tsx", import.meta.url), "utf8");
  const productView = fs.readFileSync(new URL("../src/components/StorefrontServerViews.tsx", import.meta.url), "utf8");
  const storefrontClient = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const sitemap = fs.readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  const robots = fs.readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8");

  assert.match(productRoute, /storefrontProductMetadata\(product\)/);
  assert.match(productRoute, /productCanonicalUrl\(slug\)/);
  assert.match(productRoute, /robots:\s*\{\s*\r?\n\s*index:\s*false,\s*\r?\n\s*follow:\s*false/);
  assert.match(shopProductRoute, /storefrontProductMetadata\(product\)/);
  assert.match(shopProductRoute, /productCanonicalUrl\(slug\)/);
  assert.match(shopProductRoute, /robots:\s*\{\s*\r?\n\s*index:\s*false,\s*\r?\n\s*follow:\s*false/);
  assert.match(productView, /type="application\/ld\+json"/);
  assert.match(productView, /storefrontProductJsonLd\(product\)/);
  assert.match(productView, /permanentRedirect\(productCanonicalPath\(product\.slug\)\)/);
  assert.match(collectionRoute, /storefrontCollectionMetadata\(collection\)/);
  assert.match(productView, /StorefrontCollectionLanding/);
  assert.match(productView, /storefrontCollectionJsonLdScripts/);
  assert.match(homePage, /canonical: GAMEDAYGRABS_CANONICAL_ORIGIN/);
  assert.match(shopPage, /canonical: shopUrl/);
  assert.match(aboutPage, /canonical: aboutUrl/);
  assert.match(policiesPage, /canonical: policiesUrl/);
  assert.match(shippingPolicyPage, /canonical: GAMEDAYGRABS_SHIPPING_POLICY_URL/);
  assert.match(returnsPolicyPage, /canonical: GAMEDAYGRABS_RETURNS_POLICY_URL/);
  assert.match(privacyPage, /canonical: GAMEDAYGRABS_PRIVACY_POLICY_URL/);
  assert.match(termsPage, /canonical: GAMEDAYGRABS_TERMS_URL/);
  assert.match(contactPage, /canonical: contactUrl/);
  assert.match(storefrontClient, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.doesNotMatch(storefrontClient, /href=\{`\/shop\/product\/\$\{product\.slug\}`\}/);

  assert.match(sitemap, /listPublicStoreProducts\(\)/);
  assert.match(sitemap, /productCanonicalUrl\(product\.slug\)/);
  assert.match(sitemap, /storefrontCollections/);
  assert.match(sitemap, /storefrontCollectionUrl\(collection\.slug\)/);
  assert.match(sitemap, /feedSitemapPaths/);
  assert.match(sitemap, /"\/product-feed\.xml"/);
  for (const publicPath of ['"/"', '"/shop"', '"/about"', '"/policies"', '"/policies/shipping"', '"/policies/returns"', '"/privacy"', '"/terms"', '"/contact"']) {
    assert.match(sitemap, new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(sitemap, /\/admin|\/app|\/dashboard|\/api\//);

  assert.match(robots, /sitemap: `\$\{GAMEDAYGRABS_CANONICAL_ORIGIN\}\/sitemap\.xml`/);
  assert.match(robots, /"\/collections\/"/);
  assert.match(robots, /"\/product\/"/);
  assert.match(robots, /"\/product-feed\.xml"/);
  for (const publicPath of ['"/policies/shipping"', '"/policies/returns"', '"/privacy"', '"/terms"']) {
    assert.match(robots, new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const privatePath of ['"/admin"', '"/app"', '"/account"', '"/auth"', '"/dashboard"', '"/login"', '"/api/"']) {
    assert.match(robots, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("storefront listing lifecycle keeps active sold-out URLs indexable while hidden states stay non-public", () => {
  const base = {
    publishToStore: true,
    publicSlug: "visible-product",
    publicPrice: 49.99,
    storeStatus: "active",
    quantity: 5,
    availableForSale: null,
    stockLots: [],
    sales: [],
    stockReservations: []
  };
  const activeInStock = { ...base };
  const activeSoldOut = { ...base, quantity: 0 };
  const explicitSoldOut = { ...base, storeStatus: "sold_out", quantity: 5 };
  const hidden = { ...base, storeStatus: "draft" };
  const unpublished = { ...base, publishToStore: false };
  const unpriced = { ...base, publicPrice: null };

  assert.deepEqual([...PUBLIC_STOREFRONT_VISIBLE_STATUSES], ["active", "sold_out"]);
  assert.equal(isPublicStorefrontListingVisible(activeInStock), true);
  assert.equal(isPublicStorefrontListingSellable(activeInStock), true);
  assert.equal(isPublicStorefrontListingIndexable(activeInStock), true);

  assert.equal(isPublicStorefrontListingVisible(activeSoldOut), true);
  assert.equal(isPublicStorefrontListingSellable(activeSoldOut), false);
  assert.equal(isPublicStorefrontListingIndexable(activeSoldOut), true);

  assert.equal(isPublicStorefrontListingVisible(explicitSoldOut), true);
  assert.equal(isPublicStorefrontListingSellable(explicitSoldOut), false);
  assert.equal(isPublicStorefrontListingIndexable(explicitSoldOut), true);

  for (const entry of [hidden, unpublished, unpriced]) {
    assert.equal(isPublicStorefrontListingVisible(entry), false);
    assert.equal(isPublicStorefrontListingSellable(entry), false);
    assert.equal(isPublicStorefrontListingIndexable(entry), false);
  }
});

test("collection pages have metadata, canonical URLs, and natural intro copy", () => {
  const collection = getStorefrontCollection("booster-bundles");
  assert.ok(collection);
  const metadata = storefrontCollectionMetadata(collection);

  assert.match(String(metadata.title), /Booster Bundles/);
  assert.match(String(metadata.description), /Browse Pokemon booster bundles/);
  assert.equal(metadata.alternates?.canonical, storefrontCollectionUrl("booster-bundles"));
  assert.match(collection.intro, /booster bundles/i);
  assert.doesNotMatch(collection.intro + collection.detail, /keyword keyword|guaranteed ranking|fake/i);
});

test("collection filtering supports category, new arrivals, almost gone, and local pickup without exact public counts", () => {
  const booster = product({ id: "booster", slug: "booster", title: "Pokemon Booster Bundle", category: "Booster Bundles", availabilityLevel: "low_stock", localPickupEligible: false });
  const blisterLow = product({ id: "blister", slug: "blister", title: "Pokemon Checklane Blister", category: "Blisters", availabilityLevel: "almost_gone", localPickupEligible: false });
  const soldOut = product({ id: "sold-out", slug: "sold-out", title: "Sold Out Booster Bundle", category: "Booster Bundles", publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out", localPickupEligible: false });
  const pickup = product({ id: "pickup", slug: "pickup", title: "Pickup Premium Collection", category: "Premium Collections", availabilityLevel: "almost_gone", localPickupEligible: true });
  const old = product({ id: "old", slug: "old", title: "Old Tin", category: "Tins", availabilityLevel: "low_stock", localPickupEligible: false, publishedAt: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z" });
  const products = [booster, blisterLow, soldOut, pickup, old];

  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("booster-bundles")!, products).map((entry) => entry.id), ["booster", "sold-out"]);
  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("almost-gone")!, products).map((entry) => entry.id), ["blister", "pickup"]);
  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("local-pickup-eligible")!, products).map((entry) => entry.id), ["pickup"]);
  assert.deepEqual(
    storefrontCollectionProducts(getStorefrontCollection("new-arrivals")!, products, { now: new Date("2026-06-20T00:00:00.000Z"), newArrivalDays: 14 }).map((entry) => entry.id),
    ["booster", "blister", "pickup"]
  );
});

test("collection pages use resolved storefront category instead of stale product tags", () => {
  const stalePremiumTaggedBlister = product({
    id: "checklane-blister",
    slug: "checklane-blister",
    title: "Chaos Rising Premium Checklane Blister",
    category: "Blisters",
    tags: ["Pokemon", "Premium Collections"],
    availabilityLevel: "low_stock"
  });
  const premiumCollection = product({
    id: "zygarde-premium",
    slug: "zygarde-premium",
    title: "Pokemon Mega Zygarde ex Premium Collection",
    category: "Premium Collections",
    tags: ["Pokemon", "Blisters"],
    availabilityLevel: "low_stock"
  });
  const boosterBundle = product({
    id: "booster-bundle",
    slug: "booster-bundle",
    title: "Mega Evolution Perfect Order Booster Bundle",
    category: "Booster Bundles",
    tags: ["Pokemon", "Premium Collections"],
    availabilityLevel: "low_stock"
  });
  const products = [stalePremiumTaggedBlister, premiumCollection, boosterBundle];

  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("premium-collections")!, products).map((entry) => entry.id), ["zygarde-premium"]);
  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("blisters")!, products).map((entry) => entry.id), ["checklane-blister"]);
  assert.deepEqual(storefrontCollectionProducts(getStorefrontCollection("booster-bundles")!, products).map((entry) => entry.id), ["booster-bundle"]);
});

test("collection structured data renders BreadcrumbList and ItemList without private or payment data", () => {
  const collection = getStorefrontCollection("premium-collections")!;
  const breadcrumb = jsonObject(storefrontCollectionBreadcrumbJsonLd(collection));
  const itemList = jsonObject(storefrontCollectionItemListJsonLd(collection, [product({ slug: "premium-product", title: "Premium Product" })]));
  const breadcrumbItems = breadcrumb.itemListElement as Array<Record<string, unknown>>;

  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumbItems[2].name, "Premium Collections");
  assert.equal(breadcrumbItems[2].item, storefrontCollectionUrl("premium-collections"));
  assert.equal(itemList["@type"], "ItemList");
  const itemListEntries = itemList.itemListElement as Array<Record<string, unknown>>;
  assert.equal(itemListEntries[0].url, productCanonicalUrl("premium-product"));

  const serialized = JSON.stringify([breadcrumb, itemList]);
  assert.doesNotMatch(serialized, /aggregateRating|review|availableQuantity|costBasis|supplier|admin/i);
  assert.doesNotMatch(serialized, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
});
