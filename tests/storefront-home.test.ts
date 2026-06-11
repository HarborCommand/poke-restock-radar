import assert from "node:assert/strict";
import test from "node:test";

import { storefrontImageBadges } from "../src/lib/storefront-badges";
import { homepageArrivalSection, selectHomepageHeroProduct } from "../src/lib/storefront-home";
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
    images: overrides.images ?? [],
    category: overrides.category ?? "Pokemon Sealed",
    tags: overrides.tags ?? [],
    availableQuantity: overrides.availableQuantity ?? 8,
    maxQuantityPerOrder: 4,
    status: overrides.status ?? "active",
    localPickupAvailable: true,
    shippingAvailable: true,
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
  const soldOut = product({ id: "sold", availableQuantity: 0, status: "sold_out" });

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
