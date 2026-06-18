import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { storefrontImageBadges } from "../src/lib/storefront-badges";
import {
  homepageAlmostGoneSection,
  homepageArrivalSection,
  homepageCollectorPicksSection,
  selectHomepageHeroProduct
} from "../src/lib/storefront-home";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "../src/types/radar";

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
    tags: overrides.tags ?? [],
    condition: overrides.condition ?? "Sealed",
    publicMaxQuantity: overrides.publicMaxQuantity ?? 4,
    availabilityLevel: overrides.availabilityLevel ?? "in_stock",
    maxQuantityPerOrder: 4,
    status: overrides.status ?? "active",
    localPickupAvailable: true,
    localPickupEligible: true,
    shippingAvailable: true,
    shippingProfile: overrides.shippingProfile ?? "sealed_pack_small",
    packageWeightOz: overrides.packageWeightOz ?? 8,
    packageLengthIn: overrides.packageLengthIn ?? null,
    packageWidthIn: overrides.packageWidthIn ?? null,
    packageHeightIn: overrides.packageHeightIn ?? null,
    freeShippingEligible: overrides.freeShippingEligible ?? false,
    requiresBox: overrides.requiresBox ?? false,
    insuranceRecommended: overrides.insuranceRecommended ?? false,
    needsShippingProfile: overrides.needsShippingProfile ?? false,
    publishedAt: overrides.publishedAt ?? "2026-06-01T12:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-05-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T12:00:00.000Z"
  };
}

function settings(overrides: Partial<StorefrontSettingsDTO> = {}): StorefrontSettingsDTO {
  return {
    storeName: "GameDayGrabs LLC",
    storeLogoUrl: null,
    sportsCardsExternalUrl: null,
    contactEmail: "gamedaygrabs@outlook.com",
    featuredHeroProductId: null,
    homepageHeroMode: "automatic_latest",
    newArrivalDays: 14,
    showSoldOutInHero: true,
    returnPolicyText: null,
    shippingPolicyText: null,
    localPickupInstructions: null,
    announcementBanner: null,
    defaultShippingPrice: 5,
    freeShippingThreshold: null,
    socialLinks: [],
    checkoutConfigured: false,
    ...overrides
  };
}

test("product published today gets New Arrival badge", () => {
  const current = product({ id: "today", publishedAt: new Date().toISOString() });
  const labels = storefrontImageBadges(current, 14).map((badge) => badge.label);

  assert.equal(labels.includes("NEW ARRIVAL"), true);
});

test("product older than configured new arrival duration does not get New Arrival badge", () => {
  const old = product({ id: "old", publishedAt: "2026-01-01T12:00:00.000Z" });
  const labels = storefrontImageBadges(old, 14).map((badge) => badge.label);

  assert.equal(labels.includes("NEW ARRIVAL"), false);
});

test("admin setting changes New Arrival duration", () => {
  const now = new Date();
  const twentyDaysOld = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const item = product({ id: "twenty-days", publishedAt: twentyDaysOld });

  assert.equal(storefrontImageBadges(item, 14).some((badge) => badge.label === "NEW ARRIVAL"), false);
  assert.equal(storefrontImageBadges(item, 30).some((badge) => badge.label === "NEW ARRIVAL"), true);
});

test("homepage hero uses manual featured product first", () => {
  const manual = product({ id: "manual", publishedAt: "2026-01-01T12:00:00.000Z" });
  const newest = product({ id: "newest", publishedAt: "2026-06-01T12:00:00.000Z" });

  const selected = selectHomepageHeroProduct([newest, manual], settings({ homepageHeroMode: "manual_product", featuredHeroProductId: "manual" }));

  assert.equal(selected?.id, "manual");
});

test("homepage hero falls back to newest published active product with image", () => {
  const older = product({ id: "older", publishedAt: "2026-01-01T12:00:00.000Z" });
  const newest = product({ id: "newest", publishedAt: "2026-06-01T12:00:00.000Z" });

  const selected = selectHomepageHeroProduct([older, newest], settings());

  assert.equal(selected?.id, "newest");
});

test("sold-out featured product can be selected and shows Sold Out badge", () => {
  const soldOut = product({ id: "sold", publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" });

  const selected = selectHomepageHeroProduct([soldOut], settings({ homepageHeroMode: "manual_product", featuredHeroProductId: "sold" }));
  const labels = selected ? storefrontImageBadges(selected, 14).map((badge) => badge.label) : [];

  assert.equal(selected?.id, "sold");
  assert.equal(labels[0], "SOLD OUT");
});

test("New Arrivals section limits to four products", () => {
  const now = new Date().toISOString();
  const products = ["a", "b", "c", "d", "e"].map((id) => product({ id, publishedAt: now }));

  const section = homepageArrivalSection(products, 14);

  assert.equal(section.title, "New Arrivals");
  assert.equal(section.products.length, 4);
});

test("New Arrivals section excludes sold-out products from active homepage shopping", () => {
  const now = new Date().toISOString();
  const active = product({ id: "active", publishedAt: now });
  const soldOut = product({ id: "sold-out", publishedAt: now, publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" });

  const section = homepageArrivalSection([soldOut, active], 14);

  assert.deepEqual(section.products.map((entry) => entry.id), ["active"]);
});

test("Almost Gone uses low stock active products without sold-out products or exact-count copy", () => {
  const products = [
    product({ id: "sold-out", publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" }),
    product({ id: "low-two", availabilityLevel: "almost_gone" }),
    product({ id: "low-one", availabilityLevel: "almost_gone" }),
    product({ id: "regular", availabilityLevel: "in_stock" })
  ];

  const section = homepageAlmostGoneSection(products);

  assert.equal(section.title, "Almost Gone");
  assert.deepEqual(section.products.map((entry) => entry.id), ["low-one", "low-two"]);
  assert.doesNotMatch(`${section.title} ${section.detail}`, /\b1\b|\b2\b|\bavailableQuantity\b|stock count/i);
});

test("Collector Picks uses active product categories without fake best-seller claims", () => {
  const section = homepageCollectorPicksSection([
    product({ id: "sold-out-premium", category: "Premium Collections", publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" }),
    product({ id: "premium", category: "Premium Collections" }),
    product({ id: "tin", category: "Tins" }),
    product({ id: "generic", category: "Other" })
  ]);

  assert.equal(section.title, "Collector Picks");
  assert.deepEqual(section.products.map((entry) => entry.id), ["premium", "tin"]);
  assert.doesNotMatch(`${section.title} ${section.detail}`, /best.?seller|most popular|top rated/i);
});

test("homepage merchandising UI renders category links and safe product-card links", () => {
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(client, /HomepageProductSection/);
  assert.match(client, /homepageAlmostGoneSection\(products\)/);
  assert.match(client, /homepageCollectorPicksSection\(products\)/);
  assert.match(client, /sealed Pokemon TCG products, booster bundles, tins, blisters, premium collections/);
  assert.match(client, /GameDayGrabs is not affiliated with The Pokemon Company International/);
  for (const category of ["Pokemon Sealed", "Booster Bundles", "Tins", "Premium Collections", "Blisters", "Accessories"]) {
    assert.match(client, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(client, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.match(client, /storefrontCollectionPathForCategory/);
  assert.doesNotMatch(client, /availableQuantity\}.*gdg-product-card|exact stock|stock count/i);
  assert.match(client, /availabilitySortScore/);
  assert.doesNotMatch(client, /card_number|cardNumber|cvv|payment_method_details|payment_method_data|raw Stripe object/i);
  assert.match(css, /gdg-home-product-row/);
  assert.match(css, /gdg-support-strip/);
});
