import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { storefrontImageBadges } from "../src/lib/storefront-badges";
import {
  homepageAlmostGoneSection,
  homepageArrivalSection,
  homepageCollectorPicksSection,
  homepageFeaturedDropsSection,
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
    customerAccounts: {
      enabled: false,
      rewardsEnabled: false,
      redemptionEnabled: false
    },
    calculatedUspsShipping: {
      enabled: false,
      provider: "none",
      shippoConfigured: false,
      fallbackEnabled: true
    },
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

test("Featured Drops section limits homepage products and mixes categories", () => {
  const now = new Date().toISOString();
  const products = [
    product({ id: "sold-out", category: "Premium Collections", publishedAt: now, publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" }),
    product({ id: "premium-one", category: "Premium Collections", publishedAt: now }),
    product({ id: "premium-two", category: "Premium Collections", publishedAt: now }),
    product({ id: "bundle", category: "Booster Bundles", publishedAt: now }),
    product({ id: "tin", category: "Tins", publishedAt: now }),
    product({ id: "blister", category: "Blisters", publishedAt: now }),
    product({ id: "accessory", category: "Accessories", publishedAt: now })
  ];

  const section = homepageFeaturedDropsSection(products, 14);

  assert.equal(section.title, "Featured Drops");
  assert.equal(section.products.length, 4);
  assert.equal(section.products.some((entry) => entry.id === "sold-out"), false);
  assert.deepEqual(new Set(section.products.map((entry) => entry.category)).size, 4);
  assert.doesNotMatch(`${section.title} ${section.detail}`, /best.?seller|top rated|exact stock|stock count/i);
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
  const home = fs.readFileSync(new URL("../src/lib/storefront-home.ts", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(client, /HomepageProductSection/);
  assert.match(client, /homepageFeaturedDropsSection\(products, settings\.newArrivalDays\)/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{almostGoneSection\}/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{collectorPicksSection\}/);
  assert.match(home, /Featured Drops/);
  assert.match(client, /Shop Pokemon/);
  assert.match(client, /View New Arrivals/);
  assert.match(client, /Why buy from GameDayGrabs\?/);
  assert.match(client, /Create an account to track orders and rewards/);
  assert.match(client, /Guest checkout stays available\. Sign in anytime to view orders, saved addresses, and points/);
  assert.match(client, /Sign In \/ Create Account/);
  assert.match(client, /Shop as Guest/);
  assert.match(client, /Your account is ready/);
  assert.match(client, /Track orders, saved addresses, and rewards from your dashboard/);
  assert.match(client, /Shop New Arrivals/);
  assert.match(client, /Rewards redemption coming soon/);
  assert.match(client, /primaryHref = signedIn \? "\/account" : accountsEnabled \? "\/account\/login" : "\/order-status"/);
  assert.match(client, /sealed Pokemon TCG products, booster bundles, tins, blisters, premium collections/);
  assert.match(client, /GameDayGrabs is not affiliated with The Pokemon Company International/);
  for (const category of ["Booster Bundles", "Tins", "Premium Collections", "Blisters", "New Arrivals"]) {
    assert.match(client, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(client, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.match(client, /storefrontCollectionPathForCategory/);
  assert.doesNotMatch(client, /availableQuantity\}.*gdg-product-card|exact stock|stock count/i);
  assert.doesNotMatch(client, /aggregateRating|ratingValue|reviewCount|Redeem points|Apply points|coupon/i);
  assert.match(client, /availabilitySortScore/);
  assert.doesNotMatch(client, /card_number|cardNumber|cvv|payment_method_details|payment_method_data|raw Stripe object/i);
  const featuredRenderIndex = client.indexOf("section={featuredSection}");
  const accountCtaIndex = client.indexOf("<HomepageAccountCta settings={settings} signedIn={accountSignedIn} />");
  const categoryIndex = client.indexOf("<h2>Shop By Category</h2>");
  assert.ok(featuredRenderIndex >= 0);
  assert.ok(accountCtaIndex > featuredRenderIndex);
  assert.ok(categoryIndex > accountCtaIndex);
  assert.match(css, /gdg-home-product-row/);
  assert.match(css, /gdg-support-strip/);
  assert.match(css, /gdg-home-account-cta/);
  assert.match(css, /linear-gradient\(135deg, #ffffff 0%, #fffdf5 52%, #f2fbf4 100%\)/);
  assert.match(css, /border: 1px solid #d7e7d9/);
});
