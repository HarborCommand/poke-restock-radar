import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  googleMerchantProductId,
  googleMerchantProductType,
  storefrontProductFeedItems,
  storefrontProductFeedXml
} from "../src/lib/storefront-product-feed";
import { productCanonicalUrl } from "../src/lib/storefront-seo";
import type { PublicStoreProductDTO } from "../src/types/radar";

function product(overrides: Partial<PublicStoreProductDTO> = {}): PublicStoreProductDTO {
  return {
    id: "private-db-id",
    slug: "pokemon-feed-product",
    title: "Pokemon Feed Product",
    description: "Factory sealed Pokemon product for collectors.",
    price: 24.99,
    compareAtPrice: null,
    imageUrl: "https://cdn.example.com/feed-product.jpg",
    primaryImageUrl: "https://cdn.example.com/feed-product.jpg",
    images: ["https://cdn.example.com/feed-product.jpg"],
    category: "Booster Bundles",
    tags: ["Pokemon"],
    condition: "New sealed",
    brand: "Pokemon",
    manufacturer: "The Pokemon Company",
    sku: "GDG-FEED-1",
    upc: "123456789012",
    publicMaxQuantity: 4,
    availabilityLevel: "low_stock",
    maxQuantityPerOrder: null,
    status: "active",
    localPickupAvailable: true,
    localPickupEligible: true,
    shippingAvailable: true,
    shippingProfile: "small_box",
    packageWeightOz: 12,
    packageLengthIn: 8,
    packageWidthIn: 5,
    packageHeightIn: 3,
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

function feedIds(xml: string) {
  return [...xml.matchAll(/<g:id>([^<]+)<\/g:id>/g)].map((match) => match[1]);
}

test("Google Merchant product feed renders public active storefront products", () => {
  const xml = storefrontProductFeedXml([product()]);

  assert.match(xml, /<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">/);
  assert.match(xml, /<g:id>pokemon-feed-product<\/g:id>/);
  assert.match(xml, /<title>Pok.mon Feed Product<\/title>/);
  assert.match(xml, /<description>Factory sealed Pokemon product for collectors\.<\/description>/);
  assert.match(xml, new RegExp(`<link>${productCanonicalUrl("pokemon-feed-product").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</link>`));
  assert.match(xml, /<g:image_link>https:\/\/cdn\.example\.com\/feed-product\.jpg<\/g:image_link>/);
  assert.match(xml, /<g:availability>in stock<\/g:availability>/);
  assert.match(xml, /<g:price>24\.99 USD<\/g:price>/);
  assert.match(xml, /<g:condition>new<\/g:condition>/);
  assert.match(xml, /<g:brand>Pokemon<\/g:brand>/);
  assert.match(xml, /<g:product_type>Pokemon TCG &gt; Booster Bundles<\/g:product_type>/);
  assert.match(xml, /<g:gtin>123456789012<\/g:gtin>/);
  assert.match(xml, /<g:shipping_weight>12 oz<\/g:shipping_weight>/);
});

test("Google Merchant product feed preserves short safe slug IDs", () => {
  const products = [
    product({ slug: "poke-ball-tin-q4-2025" }),
    product({ slug: "perfect-order-premium-checklane-blister-meganium" }),
    product({ slug: "mega-evolution-perfect-order-booster-bundle" })
  ];

  assert.equal(googleMerchantProductId(products[0]), "poke-ball-tin-q4-2025");
  assert.equal(googleMerchantProductId(products[1]), "perfect-order-premium-checklane-blister-meganium");
  assert.equal(googleMerchantProductId(products[2]), "mega-evolution-perfect-order-booster-bundle");

  const ids = storefrontProductFeedItems(products).map((item) => item.id);
  assert.deepEqual(ids, [
    "poke-ball-tin-q4-2025",
    "perfect-order-premium-checklane-blister-meganium",
    "mega-evolution-perfect-order-booster-bundle"
  ]);
});

test("Google Merchant product feed IDs are short stable unique and safe", () => {
  const longSlug = "pokemon-trading-card-game-mega-evolution-perfect-order-3-booster-blister-with-very-long-name";
  const similarLongSlug = "pokemon-trading-card-game-mega-evolution-perfect-order-3-booster-blister-with-very-long-name-alt";
  const longProduct = product({
    id: "stable-private-product-key-1",
    slug: longSlug,
    title: "Mega Evolution Perfect Order Booster Bundle"
  });
  const similarProduct = product({
    id: "stable-private-product-key-2",
    slug: similarLongSlug,
    title: "Mega Evolution Perfect Order Booster Bundle"
  });

  const firstId = googleMerchantProductId(longProduct);
  const repeatedId = googleMerchantProductId(longProduct);
  const secondId = googleMerchantProductId(similarProduct);
  assert.equal(firstId, repeatedId);
  assert.notEqual(firstId, secondId);

  for (const id of [firstId, secondId]) {
    assert.ok(id.length <= 50, `${id} exceeded Google Merchant id length`);
    assert.match(id, /^gdd-[a-z0-9-]+-[a-f0-9]{8}$/);
    assert.doesNotMatch(id, /\s|[^a-z0-9_-]/);
  }

  const [item] = storefrontProductFeedItems([longProduct]);
  assert.equal(item.id, firstId);
  assert.equal(item.title, "Mega Evolution Perfect Order Booster Bundle");
  assert.equal(item.link, productCanonicalUrl(longSlug));
});

test("Google Merchant product feed XML keeps every g:id under 50 characters", () => {
  const xml = storefrontProductFeedXml([
    product({
      id: "safe-key-1",
      slug: "pokemon-trading-card-game-mega-evolution-perfect-order-3-booster-blister-with-very-long-name"
    }),
    product({
      id: "safe-key-2",
      slug: "pokemon-trading-card-game-mega-evolution-perfect-order-premium-checklane-blister-with-very-long-name"
    }),
    product({
      id: "safe-key-3",
      slug: "Pokemon TCG: Special & Rare Product / Collector Box"
    })
  ]);
  const ids = feedIds(xml);

  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(id.length <= 50, `${id} exceeded Google Merchant id length`);
    assert.doesNotMatch(id, /\s|[^a-z0-9_-]/);
  }
});

test("Google Merchant product feed uses safe brand and product type fallbacks without fake identifiers", () => {
  const xml = storefrontProductFeedXml([
    product({
      title: "Pokemon Premium Collection",
      category: "Premium Collections",
      tags: ["Pokemon Sealed"],
      brand: null,
      manufacturer: null,
      upc: ""
    })
  ]);

  assert.match(xml, /<g:brand>Pokemon<\/g:brand>/);
  assert.match(xml, /<g:product_type>Pokemon TCG &gt; Premium Collections<\/g:product_type>/);
  assert.doesNotMatch(xml, /<g:gtin>/);
  assert.doesNotMatch(xml, /aggregateRating|review|ratingValue/i);
});

test("Google Merchant product feed honors admin-entered brand while computing category from collection type", () => {
  const xml = storefrontProductFeedXml([
    product({
      title: "Pokemon Checklane Blister",
      category: "",
      tags: ["Blisters"],
      brand: "Admin Brand",
      manufacturer: "Pokemon"
    })
  ]);

  assert.match(xml, /<g:brand>Admin Brand<\/g:brand>/);
  assert.match(xml, /<g:product_type>Pokemon TCG &gt; Blisters<\/g:product_type>/);
  assert.doesNotMatch(xml, /<g:brand>Pokemon<\/g:brand>/);
});

test("Google Merchant product type follows resolved storefront category over stale tags", () => {
  const blister = product({
    title: "Chaos Rising Premium Checklane Blister",
    category: "Blisters",
    tags: ["Premium Collections"]
  });
  const premium = product({
    title: "Pokemon Mega Zygarde ex Premium Collection",
    category: "Premium Collections",
    tags: ["Blisters"]
  });

  assert.equal(googleMerchantProductType(blister), "Pokemon TCG > Blisters");
  assert.equal(googleMerchantProductType(premium), "Pokemon TCG > Premium Collections");

  const xml = storefrontProductFeedXml([blister, premium]);
  assert.match(xml, /Chaos Rising Premium Checklane Blister[\s\S]*<g:product_type>Pokemon TCG &gt; Blisters<\/g:product_type>/);
  assert.match(xml, /Pok.mon Mega Zygarde ex Premium Collection[\s\S]*<g:product_type>Pokemon TCG &gt; Premium Collections<\/g:product_type>/);
});

test("Google Merchant product feed uses selected shipping profile defaults when product overrides are blank", () => {
  const xml = storefrontProductFeedXml(
    [
      product({
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

  assert.match(xml, /<g:shipping_weight>6 oz<\/g:shipping_weight>/);
  assert.match(xml, /<g:shipping_length>9 in<\/g:shipping_length>/);
  assert.match(xml, /<g:shipping_width>7 in<\/g:shipping_width>/);
  assert.match(xml, /<g:shipping_height>1 in<\/g:shipping_height>/);
});

test("Google Merchant product feed excludes unavailable and image-missing products by default", () => {
  const active = product({ slug: "active-product" });
  const soldOut = product({ slug: "sold-out-product", status: "sold_out", publicMaxQuantity: 0, availabilityLevel: "sold_out" });
  const noImage = product({ slug: "missing-image-product", imageUrl: null, primaryImageUrl: null, images: [] });

  const items = storefrontProductFeedItems([active, soldOut, noImage]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "active-product");
  assert.equal(items[0].link, productCanonicalUrl("active-product"));

  const xml = storefrontProductFeedXml([active, soldOut, noImage]);
  assert.match(xml, /active-product/);
  assert.doesNotMatch(xml, /sold-out-product/);
  assert.doesNotMatch(xml, /missing-image-product/);
});

test("Google Merchant product feed can render sold-out availability only when explicitly allowed", () => {
  const xml = storefrontProductFeedXml(
    [product({ slug: "sold-out-product", status: "sold_out", publicMaxQuantity: 0, availabilityLevel: "sold_out" })],
    { includeUnavailable: true }
  );

  assert.match(xml, /<g:id>sold-out-product<\/g:id>/);
  assert.match(xml, /<g:availability>out of stock<\/g:availability>/);
  assert.doesNotMatch(xml, /<g:availability>in stock<\/g:availability>/);
});

test("Google Merchant product feed avoids private inventory, payment, and admin fields", () => {
  const xml = storefrontProductFeedXml([product()]);
  assert.doesNotMatch(xml, /private-db-id/);
  assert.doesNotMatch(xml, /costBasis|supplier|receipt|stockLots|quantityOwned|admin|targetSellPrice/i);
  assert.doesNotMatch(xml, /card_number|cardNumber|cvc|cvv|payment_method_details|payment_method_data|raw Stripe/i);
});

test("Google Merchant feed endpoint and robots are wired for crawler access", () => {
  const route = fs.readFileSync(new URL("../src/app/product-feed.xml/route.ts", import.meta.url), "utf8");
  const robots = fs.readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8");
  const sitemap = fs.readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");

  assert.match(route, /listPublicStoreProducts/);
  assert.match(route, /storefrontProductFeedXml/);
  assert.match(route, /application\/xml/);
  assert.doesNotMatch(route, /listDashboard|requireUser|InventoryItem|costBasis|stockLots/);

  assert.match(robots, /"\/product-feed\.xml"/);
  assert.match(robots, /sitemap/);
  assert.doesNotMatch(robots, /disallow:[\s\S]*"\/product-feed\.xml"/i);

  assert.match(sitemap, /listPublicStoreProducts/);
  assert.match(sitemap, /productCanonicalUrl\(product\.slug\)/);
  assert.doesNotMatch(sitemap, /\/admin|\/app|\/dashboard|\/api\//);
});
