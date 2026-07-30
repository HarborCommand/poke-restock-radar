import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { storefrontImageBadges } from "../src/lib/storefront-badges";
import {
  homepageAlmostGoneSection,
  homepageArrivalSection,
  homepageCollectorPicksSection,
  homepageFeaturedDropsSection,
  homepageMerchandisingSections,
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
    productType: overrides.productType ?? null,
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
    tax: {
      storeCountry: "US",
      storeState: "FL",
      storeCounty: null,
      stateRateBasisPoints: 600,
      countyRateBasisPoints: 0,
      combinedRateBasisPoints: 600,
      effectiveAt: null,
      sourceNote: null,
      posTaxEnabled: false,
      taxExemptSalesEnabled: false,
      defaultTaxCategory: "general_tangible_goods",
      defaultStripeTaxCode: "txcd_99999999",
      features: {
        onlineStripeTaxEnabled: false,
        posSalesTaxEnabled: false,
        taxExemptSalesEnabled: false,
        taxReportingEnabled: false
      }
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

test("homepage merchandising sections use real timestamps, categories, prices, and minimize duplicates", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const products = [
    product({ id: "new-bundle", category: "Booster Bundles", productType: "Booster Bundle", publishedAt: "2026-07-19T12:00:00.000Z", price: 29.99 }),
    product({ id: "new-tin", category: "Tins", productType: "Tin", publishedAt: "2026-07-18T12:00:00.000Z", price: 24.99 }),
    product({ id: "older-premium", category: "Premium Collections", productType: "Premium Collection", publishedAt: "2026-06-01T12:00:00.000Z", price: 39.99 }),
    product({ id: "sleeves", category: "Accessories", productType: "Accessory", publishedAt: "2026-06-02T12:00:00.000Z", price: 9.99 }),
    product({ id: "cheap-blister", category: "Blisters", productType: "Blister", publishedAt: "2026-06-03T12:00:00.000Z", price: 14.99 }),
    product({ id: "sold-cheap", category: "Blisters", price: 7.99, publicMaxQuantity: 0, availabilityLevel: "sold_out", status: "sold_out" })
  ];

  const sections = homepageMerchandisingSections(products, 14, now);
  const byTitle = new Map(sections.map((section) => [section.title, section]));
  const allIds = sections.flatMap((section) => section.products.map((entry) => entry.id));

  assert.deepEqual(byTitle.get("New Arrivals")?.products.map((entry) => entry.id), ["new-bundle", "new-tin"]);
  assert.deepEqual(byTitle.get("Shop Pokémon Cards")?.products.map((entry) => entry.id), ["cheap-blister", "older-premium"]);
  assert.deepEqual(byTitle.get("Accessories")?.products.map((entry) => entry.id), ["sleeves"]);
  assert.equal(byTitle.has("Products Under $25"), false);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(allIds.includes("sold-cheap"), false);
  assert.doesNotMatch(sections.map((section) => `${section.title} ${section.detail}`).join(" "), /best.?seller|most popular|trending|almost gone|exact stock|stock count/i);
});

test("homepage under-$25 section uses authoritative current price and hides when empty", () => {
  const sections = homepageMerchandisingSections(
    [
      product({ id: "premium-a", category: "Premium Collections", price: 39.99, publishedAt: "2026-06-04T12:00:00.000Z" }),
      product({ id: "premium-b", category: "Premium Collections", price: 34.99, publishedAt: "2026-06-03T12:00:00.000Z" }),
      product({ id: "bundle", category: "Booster Bundles", price: 29.99, publishedAt: "2026-06-02T12:00:00.000Z" }),
      product({ id: "tin", category: "Tins", price: 27.99, publishedAt: "2026-06-01T12:00:00.000Z" }),
      product({ id: "blister", category: "Blisters", price: 14.99, publishedAt: "2026-05-02T12:00:00.000Z" })
    ],
    1,
    new Date("2026-07-20T12:00:00.000Z")
  );

  assert.deepEqual(sections.find((section) => section.title === "Products Under $25")?.products.map((entry) => entry.id), ["blister"]);
  assert.equal(sections.some((section) => section.products.length === 0), false);
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
  assert.match(client, /homepageMerchandisingSections\(products, settings\.newArrivalDays\)/);
  assert.match(fs.readFileSync(new URL("../src/components/StorefrontServerViews.tsx", import.meta.url), "utf8"), /listPublicStoreProducts\(\{ limit: 96 \}\)/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{almostGoneSection\}/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{collectorPicksSection\}/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{premiumCollectionsSection\}/);
  assert.doesNotMatch(client, /<section className="gdg-trust-bar"/);
  assert.match(home, /Shop Pokémon Cards/);
  assert.doesNotMatch(home, /Shop Pokemon Cards/);
  assert.doesNotMatch(home, /Shop PokÃ©mon Cards/);
  assert.match(home, /Products Under \$25/);
  assert.match(client, /Shop Pokémon/);
  assert.doesNotMatch(client, /Shop Pokemon/);
  assert.match(client, /View New Arrivals/);
  assert.match(client, /Why buy from GameDayGrabs\?/);
  assert.match(client, /Create an account to track orders and rewards/);
  assert.match(client, /function HomepageGrabbyTip/);
  assert.match(client, /Start with New Arrivals, or jump into Shop to see every active product/);
  assert.match(client, /Shop all products/);
  assert.match(client, /Guest checkout stays available\. Sign in anytime to view orders, saved addresses, and points/);
  assert.match(client, /Sign In \/ Create Account/);
  assert.match(client, /Shop as Guest/);
  assert.match(client, /Your account is ready/);
  assert.match(client, /Track orders, saved addresses, and rewards from your dashboard/);
  assert.match(client, /Shop New Arrivals/);
  assert.match(client, /Reward earning is currently paused\. Redemption coming soon/);
  assert.match(client, /primaryHref = signedIn \? "\/account" : accountsEnabled \? "\/account\/login" : "\/order-status"/);
  assert.match(client, /gdg-home-account-badge-shell/);
  assert.match(client, /gdg-home-account-badge-mark/);
  assert.match(client, /<span className="gdg-home-account-badge-mark">G<\/span>/);
  assert.doesNotMatch(client, /gdg-home-account-icon/);
  assert.doesNotMatch(client, /gdg-home-account-[\s\S]{0,160}<User/);
  assert.match(client, /sealed Pokémon TCG products, booster bundles, tins, blisters, premium collections/);
  assert.match(client, /GAMEDAYGRABS_FOOTER_RETAILER_DISCLOSURE/);
  assert.match(client, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  for (const category of ["Booster Bundles", "Tins", "Premium Collections", "Blisters", "New Arrivals"]) {
    assert.match(client, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(client, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.match(client, /storefrontCollectionPathForCategory/);
  assert.doesNotMatch(client, /availableQuantity\}.*gdg-product-card|exact stock|stock count/i);
  assert.doesNotMatch(client, /aggregateRating|ratingValue|reviewCount|Redeem points|Apply points|coupon/i);
  assert.match(client, /availabilitySortScore/);
  assert.doesNotMatch(client, /card_number|cardNumber|cvv|payment_method_details|payment_method_data|raw Stripe object/i);
  const heroRenderIndex = client.indexOf('<section className="gdg-hero">');
  const featuredRenderIndex = client.indexOf("homepageSections.map");
  const accountCtaIndex = client.indexOf("<HomepageAccountCta settings={settings} signedIn={accountSignedIn} />");
  const grabbyTipIndex = client.indexOf("<HomepageGrabbyTip />");
  const categoryIndex = client.indexOf("<h2>Shop By Category</h2>");
  const trustIndex = client.indexOf("<HomepageSupportStrip />");
  const feedbackIndex = client.indexOf("<MarketplaceFeedbackSection />");
  assert.ok(heroRenderIndex >= 0);
  assert.ok(featuredRenderIndex >= 0);
  assert.ok(accountCtaIndex > heroRenderIndex);
  assert.ok(accountCtaIndex < featuredRenderIndex);
  assert.ok(grabbyTipIndex > featuredRenderIndex);
  assert.ok(grabbyTipIndex < categoryIndex);
  assert.ok(categoryIndex > featuredRenderIndex);
  assert.ok(trustIndex > categoryIndex);
  assert.ok(feedbackIndex > trustIndex);
  assert.match(css, /gdg-home-product-row/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /gdg-support-strip/);
  assert.match(css, /gdg-home-account-cta/);
  assert.match(css, /gdg-home-account-badge-shell/);
  assert.match(css, /linear-gradient\(145deg, #111827 0%, #0b1220 66%, #2a2107 100%\)/);
  assert.match(css, /linear-gradient\(135deg, #ffffff 0%, #fffdf5 52%, #f2fbf4 100%\)/);
  assert.match(css, /border: 1px solid #d7e7d9/);
});
