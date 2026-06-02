import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { inventoryCompStatsForTest, summarizeInventory } from "../src/lib/radar-service";
import type { InventoryItemDTO, InventorySaleDTO } from "../src/types/radar";

function sale(overrides: Partial<InventorySaleDTO> = {}): InventorySaleDTO {
  return {
    id: "sale-1",
    inventoryItemId: "item-1",
    itemName: "Test Product",
    quantitySold: 1,
    soldPricePerItem: 20,
    grossSale: 20,
    platform: "local",
    fees: 0,
    shippingCost: 0,
    netSale: 20,
    costBasis: 10,
    profitLoss: 10,
    roiPercent: 100,
    soldAt: new Date().toISOString(),
    notes: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function item(overrides: Partial<InventoryItemDTO> = {}): InventoryItemDTO {
  return {
    id: "item-1",
    itemType: "SEALED",
    itemName: "Test Product",
    category: "Booster Bundles",
    setName: "Test Set",
    productId: null,
    linkedProductName: null,
    linkedProductRetailer: null,
    linkedProductLivePrice: null,
    linkedProductLiveStockStatus: null,
    cardId: null,
    cost: 10,
    quantity: 3,
    quantityOwned: 3,
    quantitySold: 0,
    averageCost: 10,
    totalCost: 30,
    purchaseExtraCost: 0,
    source: "Target",
    retailer: "Target",
    brand: "Pokemon",
    description: null,
    manufacturer: null,
    model: null,
    msrp: null,
    purchasedAt: new Date().toISOString(),
    receiptNumber: null,
    receiptImageUrl: null,
    orderNumber: null,
    transactionId: null,
    sourceStore: null,
    paymentMethod: null,
    exactProductUrl: null,
    upc: "196214154155",
    sku: null,
    dpci: null,
    asin: null,
    imageUrl: null,
    condition: "Sealed",
    itemStatus: "SEALED",
    targetSellPrice: null,
    minimumAcceptablePrice: null,
    listingPlatform: null,
    listingStatus: "not_listed",
    soldPrice: null,
    soldAt: null,
    buyerPlatform: null,
    currentMarketEstimate: null,
    marketAverageSalePrice: null,
    marketLowestRecentComp: null,
    marketHighestRecentComp: null,
    marketAverageLast3: null,
    marketMedianLast3: null,
    marketCompCount: 0,
    marketLastRefreshedAt: null,
    marketConfidence: "NONE",
    grossMarketValue: null,
    netMarketValue: null,
    marketProfitLoss: null,
    marketRoiPercent: null,
    estimatedEbayFee: 0,
    estimatedShippingCost: 0,
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
    maxQuantityPerOrder: 10,
    shippingProfile: "standard",
    storeStatus: "draft",
    localPickupAvailable: false,
    shippingAvailable: true,
    storefrontCategory: null,
    storefrontTags: [],
    totalSalesGross: 0,
    totalSalesNet: 0,
    realizedProfitLoss: 0,
    realizedRoiPercent: null,
    businessProfitLoss: 0,
    lastThreeComps: [],
    stockLots: [],
    sales: [],
    expectedPlan: "Hold",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test("inventory with no market comps keeps cost basis but marks market as not collected", () => {
  const summary = summarizeInventory([item({ totalCost: 30, quantityOwned: 3, averageCost: 10, marketCompCount: 0 })]);

  assert.equal(summary.totalSpent, 30);
  assert.equal(summary.inventoryCostBasis, 30);
  assert.equal(summary.marketValue, null);
  assert.equal(summary.unrealizedProfitLoss, null);
  assert.equal(summary.missingMarketDataCount, 1);
});

test("remaining quantity cost basis uses only owned units", () => {
  const summary = summarizeInventory([item({ totalCost: 30, quantityOwned: 2, quantitySold: 1, averageCost: 10 })]);

  assert.equal(summary.totalSpent, 30);
  assert.equal(summary.inventoryCostBasis, 20);
});

test("sale reduces remaining inventory value and realized profit comes from sales", () => {
  const summary = summarizeInventory([
    item({
      totalCost: 30,
      quantityOwned: 2,
      quantitySold: 1,
      averageCost: 10,
      sales: [sale({ netSale: 18, costBasis: 10, profitLoss: 8 })]
    })
  ]);

  assert.equal(summary.inventoryCostBasis, 20);
  assert.equal(summary.totalSalesNet, 18);
  assert.equal(summary.realizedProfitLoss, 8);
});

test("market value and unrealized profit use real comps only", () => {
  const summary = summarizeInventory([
    item({
      quantityOwned: 2,
      averageCost: 10,
      marketCompCount: 3,
      grossMarketValue: 50,
      marketAverageSalePrice: 25
    })
  ]);

  assert.equal(summary.marketValue, 50);
  assert.equal(summary.unrealizedProfitLoss, 30);
  assert.equal(summary.marketItemsWithDataCount, 1);
});

test("inventory market stats use sold comps and ignore active asking prices", () => {
  const stats = inventoryCompStatsForTest([
    { salePrice: 20, sourceQuality: "EBAY_SOLD" },
    { salePrice: 24, sourceQuality: "MANUAL_ESTIMATE" },
    { salePrice: 999, sourceQuality: "ACTIVE_ASKING" },
    { salePrice: 28, sourceQuality: "PRICECHARTING" }
  ]);

  assert.equal(stats.average, 24);
  assert.equal(stats.median, 24);
  assert.equal(stats.lowest, 20);
  assert.equal(stats.highest, 28);
});

test("market UI explains sold-comp-only pricing and manual mode", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  assert.match(app, /sold comps only/i);
  assert.match(app, /Manual comp entry remains available/i);
  assert.match(app, /Active asking price/);
});

test("market auto-pricing provider UI and cron are registered", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const providers = fs.readFileSync(new URL("../src/lib/market-providers.ts", import.meta.url), "utf8");
  const vercel = fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

  assert.match(app, /Active Market Provider/);
  assert.match(app, /Refresh All Missing/);
  assert.match(app, /Market Sync Log/);
  assert.match(providers, /PRICECHARTING_API_TOKEN/);
  assert.match(providers, /TCGPLAYER_ACCESS_TOKEN/);
  assert.match(providers, /TCGCSV_ENABLED/);
  assert.match(providers, /EBAY_SOLD/);
  assert.ok(vercel.includes("/api/radar/inventory/market-sync/cron"));
});

test("dashboard labels unknown market data as not collected instead of showing zero dollars", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  assert.match(app, /marketValue === null \? "Not collected"/);
  assert.doesNotMatch(app, /label="Market Value"[\s\S]{0,140}money\(dashboard\.inventorySummary\.marketValue\)/);
});
