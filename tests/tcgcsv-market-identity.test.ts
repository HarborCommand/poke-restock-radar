import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  evaluateTcgcsvIdentityMatch,
  selectTcgcsvPriceRow,
  tcgcsvMarketPriceFromCachedProduct
} from "../src/lib/tcgcsv-market";
import {
  canCalculatePotentialMarketFinancials,
  currentMarketPriceReason,
  effectiveMarketIdentityStatus,
  hasDisplayableExactMarketPrice,
  inventoryMarketFreshness,
  marketPriceDisplayReason,
  potentialMarketProjectionReason
} from "../src/lib/market-trust";
import { summarizeInventory } from "../src/lib/radar-service";
import type { InventoryItemDTO } from "../src/types/radar";

const benchmarkItem = {
  itemName: "Poké Ball Tin (Q4 2025)",
  setName: null,
  category: "Sealed Packs",
  upc: "196214130456",
  sku: null,
  dpci: null,
  asin: null,
  marketProviderMatchStatus: "UNMATCHED"
} satisfies Pick<InventoryItemDTO, "itemName" | "setName" | "category" | "upc" | "sku" | "dpci" | "asin" | "marketProviderMatchStatus">;

function product(overrides: Partial<Parameters<typeof evaluateTcgcsvIdentityMatch>[1]> = {}): Parameters<typeof evaluateTcgcsvIdentityMatch>[1] {
  return {
    tcgcsvProductId: "668964",
    productName: "Pokemon - Poke Ball Tin - Poke Ball (Q4 2025)",
    cleanProductName: null,
    normalizedName: "pokemon poke ball tin poke ball q4 2025 miscellaneous cards products",
    groupName: "Miscellaneous Cards & Products",
    imageUrl: "https://example.test/poke-ball-tin.png",
    productUrl: "https://www.tcgplayer.com/product/668964",
    extendedData: JSON.stringify({ upc: "196214130456" }),
    marketPrice: 29.55,
    lowPrice: 25.99,
    midPrice: 28,
    highPrice: 35,
    directLowPrice: null,
    subTypeName: "Unopened",
    lastSyncedAt: new Date("2026-07-25T00:00:00.000Z"),
    ...overrides
  };
}

test("TCGCSV identity benchmark selects exact Q4 2025 Poke Ball Tin Unopened product", () => {
  const exact = product();
  const evaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, exact);

  assert.equal(exact.tcgcsvProductId, "668964");
  assert.equal(exact.groupName, "Miscellaneous Cards & Products");
  assert.equal(exact.subTypeName, "Unopened");
  assert.equal(evaluation.statusLabel, "Exact Match");
  assert.equal(evaluation.hardRejected, false);
  assert.equal(evaluation.variant, "poke ball");
  assert.equal(evaluation.releasePeriod, "Q4 2025");
  assert.equal(tcgcsvMarketPriceFromCachedProduct(exact), 29.55);
  assert.equal(exact.lowPrice, 25.99);
});

test("TCGCSV identity benchmark rejects display, wrong release period, and wrong ball variants", () => {
  const rejected = [
    product({
      tcgcsvProductId: "display-q4-2025",
      productName: "Pokemon - Poke Ball Tin Display - Poke Ball (Q4 2025)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "poke-ball-q4-2024",
      productName: "Pokemon - Poke Ball Tin - Poke Ball (Q4 2024)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "repeat-ball-q4-2025",
      productName: "Pokemon - Poke Ball Tin - Repeat Ball (Q4 2025)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "great-ball-q4-2025",
      productName: "Pokemon - Poke Ball Tin - Great Ball (Q4 2025)",
      marketPrice: 129.13
    })
  ];

  for (const candidate of rejected) {
    const evaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, candidate);
    assert.equal(evaluation.statusLabel, "No Match", candidate.productName);
    assert.equal(evaluation.hardRejected, true, candidate.productName);
  }
});

test("TCGCSV market price remains separate from low listing, mid price, and display price", () => {
  const selected = selectTcgcsvPriceRow([
    {
      productId: "668964",
      subTypeName: "Normal",
      marketPrice: 129.13,
      lowPrice: 120,
      midPrice: 125,
      highPrice: 150
    },
    {
      productId: "668964",
      subTypeName: "Unopened",
      marketPrice: 29.55,
      lowPrice: 25.99,
      midPrice: 28,
      highPrice: 35
    }
  ]);

  assert.equal(selected.subTypeName, "Unopened");
  assert.equal(selected.marketPrice, 29.55);
  assert.equal(selected.lowPrice, 25.99);
  assert.notEqual(selected.marketPrice, 129.13);

  assert.equal(
    tcgcsvMarketPriceFromCachedProduct({ marketPrice: null, lowPrice: 25.99, midPrice: 28 }),
    null,
    "low/mid prices must not become the product market estimate"
  );
});

test("strict Unopened price selection never falls back to another subtype", () => {
  const normalOnly = selectTcgcsvPriceRow([
    {
      productId: "668964",
      subTypeName: "Normal",
      marketPrice: 129.13,
      lowPrice: 120,
      midPrice: 125,
      highPrice: 150,
      directLowPrice: 118
    }
  ]);

  assert.equal(normalOnly.marketPrice, null);
  assert.equal(normalOnly.lowPrice, null);
  assert.equal(normalOnly.midPrice, null);
  assert.equal(normalOnly.highPrice, null);
  assert.equal(normalOnly.directLowPrice, null);
  assert.match(String(normalOnly.subTypeName), /diagnostic:Normal/);

  const unopenedWithoutMarket = selectTcgcsvPriceRow([
    {
      productId: "668964",
      subTypeName: "Unopened",
      marketPrice: null,
      lowPrice: 25.99,
      midPrice: 28,
      highPrice: 35
    }
  ]);
  assert.equal(unopenedWithoutMarket.subTypeName, "Unopened");
  assert.equal(unopenedWithoutMarket.marketPrice, null);
  assert.equal(unopenedWithoutMarket.lowPrice, 25.99);

  const unopenedWithMarket = selectTcgcsvPriceRow([
    {
      productId: "668964",
      subTypeName: "Unopened",
      marketPrice: 29.55,
      lowPrice: 25.99
    }
  ]);
  assert.equal(unopenedWithMarket.marketPrice, 29.55);
});

function marketItem(overrides: Partial<InventoryItemDTO>): InventoryItemDTO {
  return {
    id: overrides.id ?? "item",
    itemType: "product",
    itemName: overrides.itemName ?? "PokÃ© Ball Tin (Q4 2025)",
    category: "Sealed Packs",
    setName: null,
    productId: null,
    linkedProductName: null,
    linkedProductRetailer: null,
    linkedProductLivePrice: null,
    linkedProductLiveStockStatus: null,
    cardId: null,
    cost: 14.99,
    quantity: 1,
    quantityOwned: overrides.quantityOwned ?? 1,
    quantitySold: 0,
    averageCost: overrides.averageCost ?? 14.99,
    totalCost: overrides.totalCost ?? 14.99,
    purchaseExtraCost: null,
    source: "Test",
    retailer: null,
    brand: null,
    description: null,
    manufacturer: null,
    model: null,
    msrp: null,
    purchasedAt: "2026-07-01T00:00:00.000Z",
    receiptNumber: null,
    receiptImageUrl: null,
    orderNumber: null,
    transactionId: null,
    sourceStore: null,
    paymentMethod: null,
    exactProductUrl: null,
    upc: "196214130456",
    sku: null,
    taxCategory: null,
    stripeTaxCode: null,
    taxableOverride: null,
    dpci: null,
    asin: null,
    imageUrl: null,
    condition: null,
    itemStatus: "sealed",
    targetSellPrice: null,
    minimumAcceptablePrice: null,
    listingPlatform: null,
    listingStatus: "not_listed",
    soldPrice: null,
    soldAt: null,
    buyerPlatform: null,
    currentMarketEstimate: overrides.currentMarketEstimate ?? null,
    marketAverageSalePrice: overrides.currentMarketEstimate ?? null,
    marketLowestRecentComp: overrides.currentMarketEstimate ?? null,
    marketHighestRecentComp: overrides.currentMarketEstimate ?? null,
    marketAverageLast3: overrides.currentMarketEstimate ?? null,
    marketMedianLast3: overrides.currentMarketEstimate ?? null,
    marketCompCount: overrides.marketCompCount ?? 0,
    marketLastRefreshedAt: overrides.marketLastRefreshedAt ?? "2026-07-25T00:00:00.000Z",
    marketConfidence: "HIGH",
    marketProvider: "TCGCSV",
    marketProviderProductId: overrides.marketProviderProductId ?? "668964",
    marketProviderProductName: overrides.marketProviderProductName ?? "Pokemon - Poke Ball Tin - Poke Ball (Q4 2025)",
    marketProviderMatchStatus: overrides.marketProviderMatchStatus ?? "MATCHED",
    marketProviderStoredMatchStatus: overrides.marketProviderStoredMatchStatus,
    marketProviderIdentityStatus: overrides.marketProviderIdentityStatus ?? "Exact Match",
    marketProviderIdentityValid: overrides.marketProviderIdentityValid ?? true,
    marketProviderIdentityWarnings: overrides.marketProviderIdentityWarnings ?? [],
    marketProviderComputedConfidence: overrides.marketProviderComputedConfidence ?? 100,
    marketProviderConfidenceScore: 100,
    marketProviderMatchReason: null,
    marketProviderMatchedAt: null,
    marketProviderLastPricedAt: overrides.marketProviderLastPricedAt === undefined ? "2026-07-25T00:00:00.000Z" : overrides.marketProviderLastPricedAt,
    marketProviderLowPrice: overrides.marketProviderLowPrice ?? null,
    marketProviderMidPrice: null,
    marketProviderHighPrice: null,
    marketProviderPriceSubtype: overrides.marketProviderPriceSubtype ?? "Unopened",
    marketProviderProductUrl: null,
    marketProviderPriceSyncedAt: overrides.marketProviderPriceSyncedAt === undefined ? "2026-07-25T00:00:00.000Z" : overrides.marketProviderPriceSyncedAt,
    grossMarketValue: overrides.grossMarketValue ?? null,
    netMarketValue: overrides.netMarketValue ?? null,
    marketProfitLoss: overrides.marketProfitLoss ?? null,
    marketRoiPercent: overrides.marketRoiPercent ?? null,
    estimatedEbayFee: null,
    estimatedShippingCost: null,
    estimatedNetProfit: null,
    roiPercent: null,
    recommendedAction: "HOLD",
    recommendationReason: null,
    netProfitAfterFees: null,
    publishToStore: false,
    publicSlug: null,
    publicTitle: null,
    publicDescription: null,
    publicPrice: null,
    compareAtPrice: null,
    publicImages: [],
    availableForSale: null,
    maxQuantityPerOrder: 1,
    purchaseLimitEnabled: false,
    shippingProfile: "standard",
    packageWeightOz: null,
    packageLengthIn: null,
    packageWidthIn: null,
    packageHeightIn: null,
    shippingMetadataSource: null,
    freeShippingEligible: false,
    localPickupEligible: true,
    requiresBox: false,
    insuranceRecommended: false,
    needsShippingProfile: false,
    storeStatus: "draft",
    localPickupAvailable: true,
    shippingAvailable: true,
    storefrontCategory: null,
    storefrontTags: [],
    publishedAt: null,
    authenticityProofStatus: "missing",
    authenticityReceiptStatus: "missing",
    authenticityPhotoStatus: "missing",
    authenticityUpcVerified: false,
    authenticityNotes: null,
    totalSalesGross: 0,
    totalSalesNet: 0,
    realizedProfitLoss: 0,
    realizedRoiPercent: null,
    businessProfitLoss: overrides.businessProfitLoss ?? null,
    lastThreeComps: [],
    productImages: [],
    stockLots: [],
    stockAdjustments: [],
    sales: [],
    expectedPlan: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

test("stored MATCHED display match computes unsafe and is excluded from trusted totals", () => {
  const invalidDisplay = product({
    tcgcsvProductId: "654590",
    productName: "Poke Ball Tin Display (Q4 2025)",
    marketPrice: 129.13
  });
  const invalidEvaluation = evaluateTcgcsvIdentityMatch({ ...benchmarkItem, marketProviderMatchStatus: "MATCHED" }, invalidDisplay);
  assert.equal(invalidEvaluation.statusLabel, "No Match");
  assert.equal(invalidEvaluation.hardRejected, true);
  assert.match(invalidEvaluation.warnings.join(" "), /Package form is display/);

  const validItem = marketItem({
    id: "valid",
    currentMarketEstimate: 29.55,
    marketCompCount: 1,
    grossMarketValue: 29.55,
    netMarketValue: 24.55,
    marketProfitLoss: 9.56,
    marketRoiPercent: 63.8
  });
  const invalidItem = marketItem({
    id: "invalid",
    marketProviderProductId: "654590",
    marketProviderProductName: "Poke Ball Tin Display (Q4 2025)",
    currentMarketEstimate: 129.13,
    marketCompCount: 1,
    grossMarketValue: 129.13,
    netMarketValue: 107.02,
    marketProfitLoss: 92.03,
    marketRoiPercent: 613.9,
    marketProviderIdentityStatus: "No Match",
    marketProviderIdentityValid: false,
    marketProviderIdentityWarnings: invalidEvaluation.warnings
  });

  assert.equal(hasDisplayableExactMarketPrice(validItem), true);
  assert.equal(canCalculatePotentialMarketFinancials(validItem, new Date("2026-07-26T00:00:00.000Z")), true);
  assert.equal(hasDisplayableExactMarketPrice(invalidItem), false);
  assert.equal(potentialMarketProjectionReason(invalidItem, new Date("2026-07-26T00:00:00.000Z")), "Product identity mismatch");

  const summary = summarizeInventory([validItem, invalidItem], new Date("2026-07-26T00:00:00.000Z"));
  assert.equal(summary.marketItemsWithDataCount, 1);
  assert.equal(summary.marketValue, 29.55);
  assert.notEqual(summary.marketValue, 158.68);
  assert.equal(summary.unrealizedProfitLoss, 9.56);
  assert.equal(summary.inventoryCostBasis, 29.98, "FIFO inventory cost value remains separate and unchanged");
});

test("market eligibility levels separate displayable, current, and projection validity", () => {
  const now = new Date("2026-07-26T00:00:00.000Z");
  const missingCost = marketItem({
    currentMarketEstimate: 29.55,
    marketCompCount: 1,
    grossMarketValue: 29.55,
    netMarketValue: 24.55,
    marketProfitLoss: null,
    marketRoiPercent: null,
    averageCost: 0
  });
  assert.equal(hasDisplayableExactMarketPrice(missingCost), true);
  assert.equal(currentMarketPriceReason(missingCost, now), "current");
  assert.equal(potentialMarketProjectionReason(missingCost, now), "Cost basis unavailable");
  assert.equal(canCalculatePotentialMarketFinancials(missingCost, now), false);

  const staleWithCost = marketItem({
    currentMarketEstimate: 29.55,
    marketCompCount: 1,
    grossMarketValue: 29.55,
    netMarketValue: 24.55,
    marketProfitLoss: 9.56,
    marketRoiPercent: 63.8,
    marketProviderPriceSyncedAt: "2026-07-20T00:00:00.000Z"
  });
  assert.equal(hasDisplayableExactMarketPrice(staleWithCost), true);
  assert.equal(currentMarketPriceReason(staleWithCost, now), "Market data stale");
  assert.equal(potentialMarketProjectionReason(staleWithCost, now), "Market data stale");

  const freshProjection = marketItem({
    currentMarketEstimate: 29.55,
    marketCompCount: 1,
    grossMarketValue: 59.1,
    netMarketValue: 49.1,
    marketProfitLoss: 19.12,
    marketRoiPercent: 63.8,
    quantityOwned: 2
  });
  assert.equal(hasDisplayableExactMarketPrice(freshProjection), true);
  assert.equal(currentMarketPriceReason(freshProjection, now), "current");
  assert.equal(potentialMarketProjectionReason(freshProjection, now), "trusted");
  assert.equal(canCalculatePotentialMarketFinancials(freshProjection, now), true);

  assert.equal(potentialMarketProjectionReason(marketItem({ marketProviderIdentityStatus: "Needs Review", marketProviderIdentityValid: false }), now), "Match needs review");
  assert.equal(marketPriceDisplayReason(marketItem({ currentMarketEstimate: null, marketCompCount: 0, grossMarketValue: null })), "Unopened price unavailable");
  assert.equal(marketPriceDisplayReason(marketItem({ marketProviderPriceSubtype: "Normal" })), "Unopened price unavailable");
});

test("stored versus computed status mapping does not trust stored MATCHED alone", () => {
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderIdentityStatus: "No Match" })), "No Match");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderIdentityStatus: "Needs Review" })), "Needs Review");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderIdentityStatus: "Exact Match" })), "Exact Match");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderIdentityStatus: null, marketProviderIdentityValid: undefined })), "Needs Review");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderProductId: null, marketProviderIdentityStatus: null, marketProviderIdentityValid: undefined })), "No Match");
  assert.equal(marketPriceDisplayReason(marketItem({ marketProviderMatchStatus: "MATCHED", marketProviderIdentityStatus: null, marketProviderIdentityValid: undefined })), "Match needs review");
  assert.equal(marketPriceDisplayReason(marketItem({ marketProviderProductId: null, marketProviderProductName: null })), "Matched product unavailable");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "LOCKED", marketProviderIdentityStatus: "Manually Confirmed" })), "Manually Confirmed");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "REVIEW", marketProviderIdentityStatus: "Needs Review" })), "Needs Review");
  assert.equal(effectiveMarketIdentityStatus(marketItem({ marketProviderMatchStatus: "UNMATCHED", marketProviderIdentityStatus: "No Match" })), "No Match");
});

test("market summary separates exact price display, current totals, and potential projections", () => {
  const exactMissingCost = marketItem({
    id: "exact-missing-cost",
    currentMarketEstimate: 29.55,
    marketCompCount: 1,
    grossMarketValue: 29.55,
    netMarketValue: 24.55,
    marketProfitLoss: null,
    marketRoiPercent: null,
    averageCost: 0,
    totalCost: 0
  });
  const staleExact = marketItem({
    id: "stale-exact",
    currentMarketEstimate: 40,
    marketCompCount: 1,
    grossMarketValue: 40,
    netMarketValue: 34,
    marketProfitLoss: 19.01,
    marketRoiPercent: 126.8,
    marketProviderPriceSyncedAt: "2026-07-20T00:00:00.000Z"
  });
  const exactFullProjection = marketItem({
    id: "exact-full-projection",
    currentMarketEstimate: 20,
    marketCompCount: 1,
    grossMarketValue: 20,
    netMarketValue: 16,
    marketProfitLoss: 1.01,
    marketRoiPercent: 6.7
  });

  const summary = summarizeInventory([exactMissingCost, staleExact, exactFullProjection], new Date("2026-07-26T00:00:00.000Z"));
  assert.equal(summary.marketItemsWithDataCount, 3, "all exact prices remain visible in priced inventory");
  assert.equal(summary.staleMarketPriceCount, 1);
  assert.equal(summary.marketValue, 49.55, "current market value excludes stale exact prices");
  assert.equal(summary.unrealizedProfitLoss, 1.01, "profit projection excludes missing cost basis and stale prices");
  assert.equal(summary.estimatedProfit, 1.01);
  assert.equal(summary.inventoryCostBasis, 29.98, "inventory cost accounting remains unchanged");
});

test("Poke Ball product identity benchmark keeps display rejected and single tin exact", () => {
  const display = product({
    tcgcsvProductId: "654590",
    productName: "Poke Ball Tin Display (Q4 2025)",
    marketPrice: 129.13
  });
  const single = product({
    tcgcsvProductId: "668964",
    productName: "Pokemon - Poke Ball Tin - Poke Ball (Q4 2025)",
    marketPrice: 29.55,
    lowPrice: 25.99,
    subTypeName: "Unopened"
  });
  const displayEvaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, display);
  const singleEvaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, single);

  assert.equal(displayEvaluation.statusLabel, "No Match");
  assert.equal(displayEvaluation.hardRejected, true);
  assert.match(displayEvaluation.warnings.join(" "), /Package form is display/);
  assert.equal(singleEvaluation.statusLabel, "Exact Match");
  assert.equal(singleEvaluation.hardRejected, false);
  assert.equal(tcgcsvMarketPriceFromCachedProduct(single), 29.55);
  assert.equal(single.lowPrice, 25.99);
});

test("market freshness boundaries are deterministic", () => {
  const now = new Date("2026-07-26T12:00:00.000Z");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: "2026-07-25T00:00:00.000Z" }), now).label, "Fresh");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: "2026-07-24T23:59:59.000Z" }), now).label, "Aging");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: "2026-07-22T12:00:00.000Z" }), now).label, "Aging");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: "2026-07-22T11:59:59.000Z" }), now).label, "Stale");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: "not-a-date" }), now).label, "Unavailable");
  assert.equal(inventoryMarketFreshness(marketItem({ marketProviderPriceSyncedAt: null, marketProviderLastPricedAt: null, marketLastRefreshedAt: null }), now).label, "Unavailable");
});

test("manual TCGCSV locks are labeled as manually confirmed without replacing the product ID", () => {
  const locked = evaluateTcgcsvIdentityMatch({ ...benchmarkItem, marketProviderMatchStatus: "LOCKED" }, product(), {
    manuallyConfirmed: true
  });

  assert.equal(locked.statusLabel, "Manually Confirmed");
  assert.equal(locked.hardRejected, false);
  assert.equal(locked.variant, "poke ball");
  assert.equal(locked.releasePeriod, "Q4 2025");
});

test("market UI copy does not present numeric confidence or sell-now directives for TCGCSV pricing", () => {
  const source = fs.readFileSync("src/components/RadarApp.tsx", "utf8");
  assert.match(source, /TCGplayer Market Price/);
  assert.match(source, /Lowest Listing/);
  assert.match(source, /Shipping may apply/);
  assert.match(source, /Match Status/);
  assert.doesNotMatch(source, /Provider \/ Confidence/);
  assert.doesNotMatch(source, /TCGCSV Estimate/);
  assert.doesNotMatch(source, /Low Confidence Sell Now/);
  assert.match(source, /Items With Exact Price/);
  assert.match(source, /Current Market Value/);
  assert.match(source, /Estimated Net Proceeds/);
  assert.match(source, /Potential Profit/);
  assert.match(source, /Stale Prices/);
  assert.match(source, /candidateAction\(match, "lock"[\s\S]{0,220}Confirm Exact Match/);
  assert.match(source, /Manually Confirm Match/);
  assert.match(source, /candidate\.matchStatus !== "No Match"[\s\S]{0,260}Accept Suggested Match/);
  assert.match(source, /Hard-rejected TCGCSV candidates cannot be confirmed|manuallyConfirmCandidate/);
});
