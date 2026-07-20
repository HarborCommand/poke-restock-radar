import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  compareRelatedStorefrontProducts,
  compareStorefrontFeaturedProducts,
  isSellableStorefrontProduct,
  uniqueStorefrontProducts
} from "../src/lib/storefront-merchandising";
import type { PublicStoreProductDTO } from "../src/types/radar";

function product(overrides: Partial<PublicStoreProductDTO> & { id: string; title?: string }): PublicStoreProductDTO {
  return {
    id: overrides.id,
    slug: overrides.slug ?? overrides.id,
    title: overrides.title ?? `Product ${overrides.id}`,
    description: null,
    price: overrides.price ?? 29.99,
    compareAtPrice: null,
    imageUrl: overrides.imageUrl ?? `https://example.com/${overrides.id}.png`,
    primaryImageUrl: overrides.primaryImageUrl ?? overrides.imageUrl ?? `https://example.com/${overrides.id}.png`,
    images: overrides.images ?? [],
    category: overrides.category ?? "Pokemon Sealed",
    productType: overrides.productType ?? "Booster Bundle",
    tags: overrides.tags ?? [],
    condition: overrides.condition ?? "Sealed",
    setName: overrides.setName ?? "Mega Evolution",
    brand: overrides.brand ?? "Pokemon",
    manufacturer: overrides.manufacturer ?? "Pokemon",
    sku: overrides.sku ?? null,
    upc: overrides.upc ?? null,
    publicMaxQuantity: overrides.publicMaxQuantity ?? 4,
    availabilityLevel: overrides.availabilityLevel ?? "in_stock",
    maxQuantityPerOrder: overrides.maxQuantityPerOrder ?? 4,
    status: overrides.status ?? "active",
    localPickupAvailable: overrides.localPickupAvailable ?? true,
    localPickupEligible: overrides.localPickupEligible ?? true,
    shippingAvailable: overrides.shippingAvailable ?? true,
    shippingProfile: overrides.shippingProfile ?? "sealed_pack_small",
    packageWeightOz: overrides.packageWeightOz ?? 8,
    packageLengthIn: overrides.packageLengthIn ?? null,
    packageWidthIn: overrides.packageWidthIn ?? null,
    packageHeightIn: overrides.packageHeightIn ?? null,
    shippingMetadataSource: overrides.shippingMetadataSource ?? null,
    freeShippingEligible: overrides.freeShippingEligible ?? false,
    requiresBox: overrides.requiresBox ?? false,
    insuranceRecommended: overrides.insuranceRecommended ?? false,
    needsShippingProfile: overrides.needsShippingProfile ?? false,
    publishedAt: overrides.publishedAt ?? "2026-06-01T12:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-05-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T12:00:00.000Z"
  };
}

test("related product ranking prioritizes same set, category, type, price, and stable identifiers", () => {
  const source = product({ id: "source", setName: "Mega Evolution", category: "Booster Bundles", productType: "Booster Bundle", price: 29.99 });
  const candidates = [
    product({ id: "fallback-other", setName: "Other Set", category: "Tins", productType: "Tin", price: 19.99, publishedAt: "2026-07-20T12:00:00.000Z" }),
    product({ id: "same-category", setName: "Other Set", category: "Booster Bundles", productType: "Elite Trainer Box", price: 49.99 }),
    product({ id: "same-type", setName: "Other Set", category: "Premium Collections", productType: "Booster Bundle", price: 31.99 }),
    product({ id: "same-set-close-price-b", slug: "z-close", setName: "Mega Evolution", category: "Tins", productType: "Tin", price: 31.99 }),
    product({ id: "same-set-close-price-a", slug: "a-close", setName: "Mega Evolution", category: "Tins", productType: "Tin", price: 31.99 }),
    product({ id: "same-set-far-price", setName: "Mega Evolution", category: "Tins", productType: "Tin", price: 89.99 })
  ];

  const ranked = candidates.sort(compareRelatedStorefrontProducts(source)).map((entry) => entry.id);

  assert.deepEqual(ranked, [
    "same-set-close-price-a",
    "same-set-close-price-b",
    "same-set-far-price",
    "same-category",
    "same-type",
    "fallback-other"
  ]);
});

test("related product filtering excludes current, duplicates, hidden candidates, and sold-out candidates before rendering", () => {
  const source = product({ id: "source" });
  const visible = product({ id: "visible", slug: "visible" });
  const duplicate = product({ id: "visible", slug: "visible-copy" });
  const soldOut = product({ id: "sold", publicMaxQuantity: 0, status: "sold_out", availabilityLevel: "sold_out" });
  const filtered = uniqueStorefrontProducts([source, visible, duplicate, soldOut])
    .filter((entry) => entry.id !== source.id)
    .filter(isSellableStorefrontProduct);

  assert.deepEqual(filtered.map((entry) => entry.id), ["visible"]);

  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const relatedStart = storefront.indexOf("export async function getRelatedPublicStoreProducts");
  const relatedEnd = storefront.indexOf("export async function getCartProducts");
  const relatedSource = storefront.slice(relatedStart, relatedEnd);

  assert.match(relatedSource, /id: \{ not: product\.id \}/);
  assert.match(relatedSource, /publishToStore: true/);
  assert.match(relatedSource, /storeStatus: "active"/);
  assert.match(relatedSource, /publicPrice: \{ not: null \}/);
  assert.match(relatedSource, /publicSlug: \{ not: null \}/);
  assert.match(relatedSource, /take = Math\.min\(80, Math\.max\(limit \* 16, 24\)\)/);
  assert.match(relatedSource, /isPublicStorefrontListingSellable\(item\)/);
  assert.match(relatedSource, /uniqueStorefrontProducts\(sellableProducts\)/);
  assert.match(relatedSource, /compareRelatedStorefrontProducts\(product\)/);
  assert.doesNotMatch(relatedSource, /customer|reward|payment|refund|metadata|idempotencyKey/i);
});

test("Featured shop sorting is deterministic, stable for pagination, and promotes sellable products before sold-out products", () => {
  const soldOut = product({ id: "sold", slug: "sold", status: "sold_out", availabilityLevel: "sold_out", publicMaxQuantity: 0, publishedAt: "2026-07-20T12:00:00.000Z" });
  const newest = product({ id: "newest", slug: "newest", publishedAt: "2026-07-19T12:00:00.000Z" });
  const olderA = product({ id: "older-a", slug: "a-product", title: "Same", publishedAt: "2026-07-18T12:00:00.000Z" });
  const olderB = product({ id: "older-b", slug: "b-product", title: "Same", publishedAt: "2026-07-18T12:00:00.000Z" });

  const sorted = [soldOut, olderB, newest, olderA].sort(compareStorefrontFeaturedProducts).map((entry) => entry.id);

  assert.deepEqual(sorted, ["newest", "older-a", "older-b", "sold"]);
});

test("storefront merchandising source has no unsupported popularity or scarcity claims", () => {
  const home = fs.readFileSync(new URL("../src/lib/storefront-home.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const merchandisingStart = home.indexOf("export function homepageMerchandisingSections");
  const merchandisingEnd = home.indexOf("export function homepageAlmostGoneSection");
  const merchandisingSource = home.slice(merchandisingStart, merchandisingEnd);

  assert.match(home, /homepageMerchandisingSections/);
  assert.match(merchandisingSource, /product\.price < 25/);
  assert.match(merchandisingSource, /isNewArrival\(product, now, newArrivalDays\)/);
  assert.match(client, /homepageSections\.map/);
  assert.doesNotMatch(merchandisingSource, /best.?seller|most popular|trending|people also bought|exact stock|stock count/i);
});
