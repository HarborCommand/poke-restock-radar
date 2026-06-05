import assert from "node:assert/strict";
import test from "node:test";
import { compareTargetDiscordAlert, targetUrlFromTcin } from "../src/lib/target-discord-alert";
import type { AlertDTO, ProductDTO } from "../src/types/radar";

function targetProduct(overrides: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "target-95298172",
    name: "Pokemon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
    retailerId: "target",
    retailerName: "Target",
    releaseId: null,
    releaseName: null,
    setName: "Mega Evolution-Chaos Rising",
    productType: "Booster Bundles",
    imageUrl: "https://target.scene7.com/image.jpg",
    expectedTitleKeywords: "Pokemon, Chaos Rising, Booster Bundle",
    url: "https://www.target.com/p/-/A-95298172",
    sku: "95298172",
    upc: null,
    dpci: null,
    retailerProductId: "95298172",
    verificationStatus: "VERIFIED_EXACT",
    verifiedAt: null,
    verifiedFinalUrl: "https://www.target.com/p/-/A-95298172",
    verificationNotes: null,
    retailPrice: 29.99,
    liveTitle: "Pokemon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
    livePrice: 29.99,
    livePriceSource: "Retailer page",
    livePriceVerifiedAt: "2026-06-05T14:00:00.000Z",
    liveStockStatus: "ADD_TO_CART_AVAILABLE",
    liveStockVerifiedAt: "2026-06-05T14:00:00.000Z",
    liveImageUrl: "https://target.scene7.com/image.jpg",
    liveConfidenceScore: 96,
    liveBlockedType: null,
    sellerName: "Target",
    sellerType: "target",
    fulfillmentType: "target_ship",
    sellerVerified: true,
    priceStatus: "msrp",
    alertEligibility: "eligible",
    expectedRetailPrice: 29.99,
    maxAlertPrice: 34.99,
    allowOverMsrp: false,
    targetRetailMin: 24.99,
    targetRetailMax: 34.99,
    targetRetailReason: "Target retail/MSRP range.",
    isDemoData: false,
    stockStatus: "ADD_TO_CART_AVAILABLE",
    alertStatus: true,
    priority: "HIGH",
    rating: "WATCH",
    notes: null,
    lastCheckedAt: "2026-06-05T14:00:00.000Z",
    lastSuccessfulCheckedAt: "2026-06-05T14:00:00.000Z",
    monitorEnabled: true,
    checkFrequencyMinutes: 60,
    nextCheckAt: null,
    lastMonitorResult: "Target add-to-cart available.",
    lastMonitorError: null,
    lastAlertSentAt: null,
    requiredWords: null,
    ignoreWords: null,
    pendingAlertStatus: null,
    pendingAlertCount: 0,
    pendingAlertReason: null,
    pendingAlertConfidence: null,
    pendingAlertDetectedWords: null,
    pendingAlertAt: null,
    sealedResaleNotes: null,
    scarcityNotes: null,
    manualPriorityOverride: "WATCH",
    archivedAt: null,
    pokemonCenterExclusiveVersion: false,
    priorityScore: null,
    updatedAt: "2026-06-05T14:00:00.000Z",
    ...overrides
  };
}

function trackerAlert(productId = "target-95298172"): AlertDTO {
  return {
    id: "alert-1",
    title: "Tracker Live Drop: Target Pokemon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
    reason: "tracker_online_drop Target product is add to cart available.",
    priority: "HIGH",
    timestamp: "2026-06-05T14:01:00.000Z",
    entityType: "PRODUCT",
    entityId: productId,
    actionUrl: "https://www.target.com/p/-/A-95298172",
    read: false,
    score: 96,
    dedupeKey: `tracker_online_drop:${productId}:add_to_cart_available:29.99`,
    explanation: null,
    falsePositiveAt: null,
    suppressedAt: null,
    cooldownUntil: null
  };
}

test("Target retail buyable watched product remains visible when alert is deduped", () => {
  const product = targetProduct();
  const result = compareTargetDiscordAlert(
    { productName: product.name, skuOrTcin: "95298172", price: 29.99 },
    [product],
    [],
    {
      now: new Date("2026-06-05T14:05:00.000Z"),
      buyableProductIds: new Set([product.id]),
      retailEligibleProductIds: new Set([product.id])
    }
  );

  assert.equal(result.status, "deduped_currently_buyable");
  assert.equal(result.watched, true);
  assert.equal(result.currentlyBuyable, true);
  assert.equal(result.retailEligible, true);
  assert.match(result.reasons.join(" "), /Target Retail In Stock Now/i);
});

test("Target tracker_online_drop alert is detected when it already exists", () => {
  const product = targetProduct();
  const result = compareTargetDiscordAlert({ skuOrTcin: "95298172" }, [product], [trackerAlert(product.id)], {
    now: new Date("2026-06-05T14:05:00.000Z"),
    buyableProductIds: new Set([product.id]),
    retailEligibleProductIds: new Set([product.id])
  });

  assert.equal(result.status, "live_drop_created");
  assert.equal(result.alertCreated, true);
});

test("not watched Discord Target SKU returns Not Watched", () => {
  const result = compareTargetDiscordAlert(
    { productName: "Pokemon 2025 World Championships Deck", skuOrTcin: "1010423706", price: 19.99 },
    [targetProduct()],
    [],
    { now: new Date("2026-06-05T14:05:00.000Z") }
  );

  assert.equal(result.status, "not_watched");
  assert.equal(result.watched, false);
  assert.equal(result.exactUrl, targetUrlFromTcin("1010423706"));
});

test("Target SKU mismatch does not fall back to a similar title match", () => {
  const watchedWorldsDeck = targetProduct({
    id: "target-worlds-yuya-okita",
    name: "Pokemon TCG: 2025 World Championships Deck | Yuya Okita",
    url: "https://www.target.com/p/-/A-99999999",
    verifiedFinalUrl: "https://www.target.com/p/-/A-99999999",
    sku: "99999999",
    retailerProductId: "99999999",
    liveTitle: "Pokemon TCG: 2025 World Championships Deck | Yuya Okita",
    retailPrice: 35,
    livePrice: 35
  });
  const result = compareTargetDiscordAlert(
    { productName: "2025 World Championships Deck", skuOrTcin: "1010423706", price: 19.99 },
    [watchedWorldsDeck],
    [],
    { now: new Date("2026-06-05T14:05:00.000Z") }
  );

  assert.equal(result.status, "not_watched");
  assert.equal(result.watched, false);
  assert.equal(result.matchedBy, null);
});

test("over-MSRP Target product is suppressed from Live Drops", () => {
  const product = targetProduct({
    livePrice: 69.99,
    retailPrice: 69.99,
    priceStatus: "over_msrp",
    alertEligibility: "suppressed_over_msrp",
    targetRetailReason: "Price $69.99 exceeds Target MSRP guardrail."
  });
  const result = compareTargetDiscordAlert({ skuOrTcin: "95298172", price: 69.99 }, [product], [], {
    now: new Date("2026-06-05T14:05:00.000Z")
  });

  assert.equal(result.status, "suppressed_over_msrp");
  assert.equal(result.retailEligible, false);
});

test("sold-out Target product does not create a live drop", () => {
  const product = targetProduct({
    liveStockStatus: "SOLD_OUT",
    stockStatus: "SOLD_OUT",
    alertStatus: false,
    lastMonitorResult: "Target page says out of stock."
  });
  const result = compareTargetDiscordAlert({ skuOrTcin: "95298172", price: 29.99 }, [product], [], {
    now: new Date("2026-06-05T14:05:00.000Z")
  });

  assert.equal(result.status, "sold_out_at_latest_check");
  assert.equal(result.currentlyBuyable, false);
});
