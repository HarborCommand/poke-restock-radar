import assert from "node:assert/strict";
import test from "node:test";

import {
  NEW_ARRIVAL_DAYS,
  isSoldOutProduct,
  storefrontImageBadges,
  storefrontMatchesAvailability,
  storefrontPrimaryActionDisabled
} from "../src/lib/storefront-badges";

test("sold out products are detectable for filters and actions", () => {
  const soldOutPublished = {
    status: "sold_out" as const,
    availabilityLevel: "sold_out" as const,
    publishedAt: "2026-06-01T10:00:00.000Z",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z"
  };

  assert.equal(storefrontMatchesAvailability(soldOutPublished, "all"), true);
  assert.equal(storefrontMatchesAvailability(soldOutPublished, "sold-out"), true);
  assert.equal(storefrontMatchesAvailability(soldOutPublished, "in-stock"), false);
  assert.equal(storefrontPrimaryActionDisabled(soldOutPublished), true);
  assert.equal(isSoldOutProduct(soldOutPublished), true);
  const soldOutBadges = storefrontImageBadges(soldOutPublished).map((badge) => badge.label);
  assert.equal(soldOutBadges[0], "SOLD OUT");
  assert.equal(soldOutBadges.includes("SOLD OUT"), true);
});

test("sold-out public product disables add-to-cart and request invoice actions", () => {
  const soldOut = {
    status: "sold_out" as const,
    availabilityLevel: "sold_out" as const,
    publishedAt: "2026-06-01T10:00:00.000Z",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z"
  };

  assert.equal(storefrontPrimaryActionDisabled(soldOut), true);
  assert.equal(storefrontMatchesAvailability(soldOut, "all"), true);
  assert.equal(storefrontMatchesAvailability(soldOut, "sold-out"), true);
  assert.equal(storefrontMatchesAvailability(soldOut, "in-stock"), false);
});

test("in-stock availability excludes sold-out products", () => {
  const activeProduct = {
    status: "active" as const,
    availabilityLevel: "low_stock" as const,
    publishedAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z"
  };

  const soldOut = {
    status: "sold_out" as const,
    availabilityLevel: "sold_out" as const,
    publishedAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z"
  };

  assert.equal(storefrontMatchesAvailability(activeProduct, "in-stock"), true);
  assert.equal(storefrontMatchesAvailability(soldOut, "in-stock"), false);
});

test("active in-stock products stay in-stock and are not disabled", () => {
  const activeProduct = {
    status: "active" as const,
    availabilityLevel: "in_stock" as const,
    publishedAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z"
  };

  assert.equal(storefrontPrimaryActionDisabled(activeProduct), false);
  assert.equal(storefrontMatchesAvailability(activeProduct, "in-stock"), true);
  assert.equal(storefrontMatchesAvailability(activeProduct, "sold-out"), false);
  assert.equal(storefrontImageBadges(activeProduct).length, 0);
});

test("new arrival badges appear for recently published public products", () => {
  const now = new Date();
  const publishedAt = new Date(now.getTime() - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();

  const newArrivalProduct = {
    status: "active" as const,
    availabilityLevel: "in_stock" as const,
    publishedAt,
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-06-05T10:00:00.000Z"
  };

  const badges = storefrontImageBadges(newArrivalProduct, NEW_ARRIVAL_DAYS);
  const labels = badges.map((badge) => badge.label);
  assert.equal(labels.includes("NEW ARRIVAL"), true);
  assert.equal(labels.includes("LOW STOCK"), false);
});

test("low quantity active products show LOW STOCK badge", () => {
  const lowQuantityProduct = {
    status: "active" as const,
    availabilityLevel: "almost_gone" as const,
    publishedAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z"
  };

  assert.deepEqual(storefrontImageBadges(lowQuantityProduct).map((badge) => badge.label), ["LOW STOCK"]);
});

test("limited quantity active products show LIMITED STOCK badge", () => {
  const limitedQuantityProduct = {
    status: "active" as const,
    availabilityLevel: "low_stock" as const,
    publishedAt: "2026-01-02T10:00:00.000Z",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z"
  };

  assert.deepEqual(storefrontImageBadges(limitedQuantityProduct).map((badge) => badge.label), ["LIMITED STOCK"]);
});

test("sold out with recent creation keeps SOLD OUT as priority and may include NEW ARRIVAL", () => {
  const now = new Date();
  const recentSoldOut = {
    status: "sold_out" as const,
    availabilityLevel: "sold_out" as const,
    publishedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  const labels = storefrontImageBadges(recentSoldOut).map((badge) => badge.label);
  assert.equal(labels[0], "SOLD OUT");
});
