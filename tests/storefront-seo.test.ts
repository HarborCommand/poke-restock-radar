import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  productCanonicalUrl,
  storefrontProductJsonLd,
  storefrontProductMetadata,
  storefrontProductSchemaAvailability
} from "../src/lib/storefront-seo";
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
    availableQuantity: 3,
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

test("product SEO metadata uses real product data and canonical URLs", () => {
  const metadata = storefrontProductMetadata(product());
  assert.equal(metadata.title, "Pokémon SEO Product | GameDayGrabs LLC");
  assert.match(String(metadata.description), /Shop Pokémon SEO Product from GameDayGrabs/);
  assert.match(String(metadata.description), /Premium Collections/);
  assert.match(String(metadata.description), /\$49\.99/);
  assert.match(String(metadata.description), /In stock/);
  assert.equal(metadata.alternates?.canonical, productCanonicalUrl("pokemon-seo-product"));

  const openGraph = metadata.openGraph as { url?: string; images?: string[] };
  assert.equal(openGraph.url, productCanonicalUrl("pokemon-seo-product"));
  assert.deepEqual(openGraph.images, ["https://cdn.example.com/product.jpg"]);

  const twitter = metadata.twitter as { card?: string; images?: string[] };
  assert.equal(twitter.card, "summary_large_image");
  assert.deepEqual(twitter.images, ["https://cdn.example.com/product.jpg"]);
});

test("product structured data renders safe Product and Offer fields only", () => {
  const jsonLd = storefrontProductJsonLd(product()) as Record<string, any>;
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "Product");
  assert.equal(jsonLd.name, "Pokémon SEO Product");
  assert.equal(jsonLd.category, "Premium Collections");
  assert.equal(jsonLd.url, productCanonicalUrl("pokemon-seo-product"));
  assert.equal(jsonLd.brand.name, "Pokemon");
  assert.equal(jsonLd.manufacturer.name, "The Pokemon Company");
  assert.equal(jsonLd.sku, "PKM-SEO-1");
  assert.equal(jsonLd.gtin12, "123456789012");
  assert.equal(jsonLd.offers["@type"], "Offer");
  assert.equal(jsonLd.offers.price, "49.99");
  assert.equal(jsonLd.offers.priceCurrency, "USD");
  assert.equal(jsonLd.offers.availability, "https://schema.org/InStock");
  assert.equal(jsonLd.offers.seller.name, "GameDayGrabs");

  const serialized = JSON.stringify(jsonLd);
  assert.doesNotMatch(serialized, /aggregateRating|review|ratingValue|ratingCount/i);
  assert.doesNotMatch(serialized, /availableQuantity|quantityOwned|costBasis|supplier|admin/i);
  assert.doesNotMatch(serialized, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe/i);
});

test("sold-out structured data does not claim in-stock availability", () => {
  const soldOut = product({ availableQuantity: 0, status: "sold_out" });
  assert.equal(storefrontProductSchemaAvailability(soldOut), "https://schema.org/OutOfStock");
  const jsonLd = storefrontProductJsonLd(soldOut) as Record<string, any>;
  assert.equal(jsonLd.offers.availability, "https://schema.org/OutOfStock");
  assert.notEqual(jsonLd.offers.availability, "https://schema.org/InStock");
});

test("product pages, sitemap, and robots are wired for Google-ready discovery", () => {
  const productRoute = fs.readFileSync(new URL("../src/app/product/[slug]/page.tsx", import.meta.url), "utf8");
  const shopProductRoute = fs.readFileSync(new URL("../src/app/shop/product/[slug]/page.tsx", import.meta.url), "utf8");
  const productView = fs.readFileSync(new URL("../src/components/StorefrontServerViews.tsx", import.meta.url), "utf8");
  const sitemap = fs.readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  const robots = fs.readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8");

  assert.match(productRoute, /storefrontProductMetadata\(product\)/);
  assert.match(productRoute, /productCanonicalUrl\(slug\)/);
  assert.match(shopProductRoute, /storefrontProductMetadata\(product\)/);
  assert.match(shopProductRoute, /productCanonicalUrl\(slug\)/);
  assert.match(productView, /type="application\/ld\+json"/);
  assert.match(productView, /storefrontProductJsonLd\(product\)/);

  assert.match(sitemap, /listPublicStoreProducts/);
  assert.match(sitemap, /productCanonicalUrl\(product\.slug\)/);
  for (const publicPath of ['"/"', '"/shop"', '"/about"', '"/policies"', '"/contact"']) {
    assert.match(sitemap, new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(sitemap, /\/admin|\/app|\/dashboard|\/api\//);

  assert.match(robots, /sitemap: `\$\{GAMEDAYGRABS_CANONICAL_ORIGIN\}\/sitemap\.xml`/);
  for (const privatePath of ['"/admin"', '"/app"', '"/dashboard"', '"/api/"']) {
    assert.match(robots, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
