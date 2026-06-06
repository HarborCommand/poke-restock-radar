import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { inventoryCompStatsForTest, summarizeInventory } from "../src/lib/radar-service";
import { inferTcgcsvProductType, normalizeTcgcsvProductText } from "../src/lib/tcgcsv-market";
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
    marketProvider: null,
    marketProviderProductId: null,
    marketProviderProductName: null,
    marketProviderMatchStatus: "UNMATCHED",
    marketProviderConfidenceScore: 0,
    marketProviderMatchReason: null,
    marketProviderMatchedAt: null,
    marketProviderLastPricedAt: null,
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

test("inventory market stats use trusted estimates and ignore active asking prices", () => {
  const stats = inventoryCompStatsForTest([
    { salePrice: 20, sourceQuality: "EBAY_SOLD" },
    { salePrice: 24, sourceQuality: "TCGCSV_ESTIMATE" },
    { salePrice: 999, sourceQuality: "ACTIVE_ASKING" },
    { salePrice: 28, sourceQuality: "PRICECHARTING" }
  ]);

  assert.equal(stats.average, 24);
  assert.equal(stats.median, 24);
  assert.equal(stats.lowest, 20);
  assert.equal(stats.highest, 28);
});

test("market UI explains TCGCSV estimates and hides manual comp as the main workflow", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  assert.match(app, /TCGCSV Market Estimate/i);
  assert.match(app, /not sold comps/i);
  assert.match(app, /Sync TCGCSV Now/i);
  assert.match(app, /Manual comps stay hidden as an admin fallback/i);
  assert.doesNotMatch(app, /<h2>Manual Sold Comp Entry<\/h2>/);
  assert.match(app, /Active asking price/);
});

test("market auto-pricing provider UI and cron are registered", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const providers = fs.readFileSync(new URL("../src/lib/market-providers.ts", import.meta.url), "utf8");
  const vercel = fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

  const tcgcsv = fs.readFileSync(new URL("../src/lib/tcgcsv-market.ts", import.meta.url), "utf8");

  assert.match(app, /Needs Review/);
  assert.match(app, /Unmatched/);
  assert.match(app, /Refresh All Missing/);
  assert.match(app, /Market Sync Log/);
  assert.match(app, /Match Review/);
  assert.match(tcgcsv, /syncTcgcsvCatalog/);
  assert.match(tcgcsv, /tcgcsvProduct/);
  assert.match(tcgcsv, /TCGCSV_ESTIMATE/);
  assert.match(providers, /PRICECHARTING_API_TOKEN/);
  assert.match(providers, /TCGPLAYER_ACCESS_TOKEN/);
  assert.match(providers, /TCGCSV_ENABLED/);
  assert.match(providers, /EBAY_SOLD/);
  assert.ok(vercel.includes("/api/radar/inventory/market-sync/cron"));
});

test("TCGCSV auto-match backfill and review workflow are wired", () => {
  const service = fs.readFileSync(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8");
  const tcgcsv = fs.readFileSync(new URL("../src/lib/tcgcsv-market.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const matchRoute = fs.readFileSync(new URL("../src/app/api/radar/inventory/tcgcsv/matches/[itemId]/route.ts", import.meta.url), "utf8");
  const searchRoute = fs.readFileSync(new URL("../src/app/api/radar/inventory/tcgcsv/search/route.ts", import.meta.url), "utf8");

  assert.match(service, /autoMatchInventoryItemMarket\(currentUser, item\.id\)/);
  assert.match(service, /autoMatchInventoryItemMarket\(currentUser, itemId\)/);
  assert.match(service, /marketProviderMatchStatus: \{ in: \["UNMATCHED", "REVIEW", "REJECTED", "ERROR"\] \}/);
  assert.doesNotMatch(service, /take: options\.limit \?\? 50/);
  assert.match(tcgcsv, /confidence >= 85/);
  assert.match(tcgcsv, /findTcgcsvCandidates/);
  assert.match(tcgcsv, /exact UPC\/identifier match/);
  assert.match(tcgcsv, /candidates: candidates\.map\(tcgcsvCandidateToDTO\)/);
  assert.match(app, /Auto-Match All Inventory/);
  assert.match(app, /Needs Review/);
  assert.match(app, /Unmatched/);
  assert.match(matchRoute, /providerProductId/);
  assert.match(matchRoute, /mark_unmatched/);
  assert.match(searchRoute, /searchTcgcsvMarketMatches/);
});

test("TCGCSV normalization handles Pokemon sealed product names", () => {
  assert.equal(normalizeTcgcsvProductText("Pok&#233;mon TCG: Mega Evolution - Chaos Rising Booster Bundle"), "chaos rising booster bundle");
  assert.equal(inferTcgcsvProductType("Mega Evolution Chaos Rising Booster Bundle"), "booster_bundle");
  assert.equal(inferTcgcsvProductType("Mega Evolution Chaos Rising Booster Box"), "booster_box");
  assert.equal(inferTcgcsvProductType("Perfect Order Premium Checklane Blister - Meganium"), "premium_checklane_blister");
});

test("dashboard labels unknown market data as not collected instead of showing zero dollars", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  assert.match(app, /marketValue === null \? "Not collected"/);
  assert.doesNotMatch(app, /label="Market Value"[\s\S]{0,140}money\(dashboard\.inventorySummary\.marketValue\)/);
});

test("public storefront does not expose internal market or profit data", () => {
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const dtoBlock = types.match(/export type PublicStoreProductDTO = \{[\s\S]*?\n\};/)?.[0] ?? "";

  assert.match(dtoBlock, /price: number/);
  assert.doesNotMatch(dtoBlock, /marketProvider|currentMarketEstimate|marketProfitLoss|costBasis|roiPercent/);
  assert.doesNotMatch(storefront, /currentMarketEstimate|marketProfitLoss|TCGCSV|ROI|cost basis/i);
});

test("storefront publishing and distributor readiness workflow is wired", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const bulkRoute = fs.readFileSync(new URL("../src/app/api/radar/inventory/store-listing/bulk/route.ts", import.meta.url), "utf8");
  const aboutPage = fs.readFileSync(new URL("../src/app/about/page.tsx", import.meta.url), "utf8");
  const policiesPage = fs.readFileSync(new URL("../src/app/policies/page.tsx", import.meta.url), "utf8");
  const contactPage = fs.readFileSync(new URL("../src/app/contact/page.tsx", import.meta.url), "utf8");

  assert.match(validation, /inventoryBulkStorePublishSchema/);
  assert.match(storefront, /bulkPublishInventoryStoreListings/);
  assert.match(storefront, /generatedPublicDescription/);
  assert.match(storefront, /Public price missing/);
  assert.match(bulkRoute, /requireUser/);
  assert.match(bulkRoute, /storefront\.listing\.bulk_publish/);
  assert.match(app, /Storefront Publishing/);
  assert.match(app, /Publish Selected/);
  assert.match(app, /Publish All Eligible/);
  assert.match(app, /Listing Quality/);
  assert.match(app, /Distributor Application Checklist/);
  assert.match(app, /Preview Storefront/);
  assert.match(client, /href: "\/about"/);
  assert.match(client, /href: "\/policies"/);
  assert.match(client, /href: "\/contact"/);
  assert.match(aboutPage, /About GameDayGrabs LLC/);
  assert.match(policiesPage, /Store Policies/);
  assert.match(contactPage, /Contact/);
});

test("alerts tab is rebuilt as a Discord-style tracker command center", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  for (const section of ["Live Drops", "Check Stock", "My Watchlist", "Keywords", "Alert History", "Scanner Status", "System Alerts"]) {
    assert.match(alertsPanel, new RegExp(section), `missing tracker section ${section}`);
  }

  assert.match(alertsPanel, /Discord-style feed/);
  assert.match(alertsPanel, /Live action center/);
  assert.match(alertsPanel, /Target Retail In Stock Now/);
  assert.match(alertsPanel, /Target watch products whose latest check says retail\/MSRP stock is buyable now/);
  assert.match(alertsPanel, /No new drop alerts, but these Target products are currently buyable/);
  assert.match(alertsPanel, /Duplicate suppression can prevent repeat alert spam/);
  assert.match(alertsPanel, /Target Sold Out \/ Watch Only/);
  assert.match(alertsPanel, /targetBuyableFilterOptions/);
  assert.match(alertsPanel, /targetBuyableSortOptions/);
  assert.match(alertsPanel, /Go Buy/);
  assert.match(alertsPanel, /Add to Inventory/);
  assert.match(alertsPanel, /Mark bought/);
  assert.match(alertsPanel, /Got It/);
  assert.match(alertsPanel, /Missed/);
  assert.match(alertsPanel, /Sold Out/);
  assert.match(alertsPanel, /Bad Alert/);
  assert.doesNotMatch(alertsPanel, /AlertCalibrationPanel/);
  assert.match(app, /<AlertCalibrationPanel dashboard=\{dashboard\} setActiveTab=\{setActiveTab\}/);
});

test("tracker alert categories and archived local store cleanup are wired", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  for (const category of [
    "tracker_online_drop",
    "tracker_local_stock",
    "tracker_keyword_match",
    "tracker_sku_match",
    "tracker_price_change",
    "tracker_preorder_live",
    "tracker_add_to_cart",
    "tracker_sold_out",
    "inventory_low_stock",
    "inventory_market_missing",
    "order_paid",
    "order_needs_fulfillment",
    "system_warning",
    "system_error",
    "deprecated_local_store"
  ]) {
    assert.match(app, new RegExp(category), `missing category ${category}`);
  }

  assert.match(app, /Show archived\/deprecated alerts/);
  assert.match(app, /deprecated local store/i);
  assert.match(app, /Muted \/ Archived/);
  assert.match(app, /trackerIsLiveDrop/);
  assert.match(app, /tracker_online_drop:/);
  assert.match(app, /In Stock/);
  assert.match(app, /Add To Cart/);
  assert.match(app, /record\.isSystem/);
  assert.match(app, /No live drops right now/);
  assert.match(app, /Example Alert/);
  assert.match(app, /Tracker setup/);
  assert.match(app, /Watching \{watchProducts\.length\} products/);
  assert.match(app, /tracker-side-rail/);
  assert.match(app, /targetBuyableProductComparator/);
  assert.match(app, /productIsCurrentlyBuyable/);
  assert.match(app, /buyableNowProducts/);
  assert.match(app, /targetRetailInStockProducts/);
  assert.match(app, /visibleTargetRetailInStockProducts/);
  assert.match(app, /targetExactProductUrl/);
  assert.match(app, /Target Retail In Stock Now/);
});

test("alerts Buyable Now remains visible when duplicate suppression prevents new drop alerts", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));
  const buyableHelper = app.slice(app.indexOf("function productIsCurrentlyBuyable"), app.indexOf("function targetBuyableHighStock"));

  assert.match(buyableHelper, /SOLD_OUT/);
  assert.match(buyableHelper, /UNAVAILABLE/);
  assert.match(buyableHelper, /IN_STOCK/);
  assert.match(buyableHelper, /ADD_TO_CART_AVAILABLE/);
  assert.match(buyableHelper, /PREORDER_LIVE/);
  assert.match(buyableHelper, /hasHighOrLowStockSignal/);
  assert.match(buyableHelper, /hasBuyableAction/);
  assert.match(alertsPanel, /liveDrops\.length \? \(/);
  assert.match(alertsPanel, /: targetBuyableProducts\.length \? \(/);
  assert.match(alertsPanel, /No new drop alerts, but these Target products are currently buyable/);
  assert.match(alertsPanel, /Target Retail In Stock Now/);
  assert.match(alertsPanel, /renderExampleLiveDropCard\(\)/);
  const liveDropRender = alertsPanel.slice(alertsPanel.indexOf("{liveDrops.length ? ("), alertsPanel.indexOf("<aside className=\"tracker-side-rail\""));
  assert.ok(
    liveDropRender.indexOf(": targetBuyableProducts.length ? (") < liveDropRender.indexOf("renderExampleLiveDropCard()"),
    "example alert must be behind the current-buyable branch"
  );
});

test("alerts Target retail coverage and Discord comparison tools are wired", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));
  const helper = fs.readFileSync(new URL("../src/lib/target-discord-alert.ts", import.meta.url), "utf8");

  assert.match(alertsPanel, /Target coverage/);
  assert.match(alertsPanel, /Automatic retail\/MSRP coverage/);
  assert.match(alertsPanel, /Poke Radar discovers public Target Pokemon TCG pages/);
  assert.match(alertsPanel, /Auto Discovery/);
  assert.match(alertsPanel, /Auto Approval/);
  assert.match(alertsPanel, /Retail Only/);
  assert.match(alertsPanel, /Target Retail In Stock Now/);
  assert.match(alertsPanel, /targetStaleProducts/);
  assert.match(alertsPanel, /targetMissingExactUrlProducts/);
  assert.match(alertsPanel, /targetMissingIdentifierProducts/);
  assert.match(alertsPanel, /targetLogsInLatestScan/);
  assert.match(alertsPanel, /Run Auto Discovery Now/);
  assert.match(alertsPanel, /Run Monitor Now/);
  assert.match(alertsPanel, /Run High Priority Target Now/);
  assert.match(alertsPanel, /Run One Product Now/);
  assert.match(alertsPanel, /targetQueueRemaining/);
  assert.match(alertsPanel, /targetStaleProducts/);
  assert.match(alertsPanel, /targetProductsCheckedLastRun/);
  assert.match(alertsPanel, /Add from Discord Alert/);
  assert.match(alertsPanel, /Compare Discord Alert/);
  assert.match(alertsPanel, /compareTargetDiscordAlert/);
  assert.match(helper, /not_watched/);
  assert.match(helper, /suppressed_over_msrp/);
  assert.match(helper, /deduped_currently_buyable/);
  assert.match(helper, /sold_out_at_latest_check/);
  assert.match(helper, /targetUrlFromTcin/);
});

test("Target monitor cron uses safe batched freshness mode", () => {
  const monitor = fs.readFileSync(new URL("../src/lib/monitor.ts", import.meta.url), "utf8");
  const cron = fs.readFileSync(new URL("../src/app/api/radar/monitor/cron/route.ts", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8");
  const env = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");

  assert.match(validation, /target_due/);
  assert.match(validation, /target_priority/);
  assert.match(monitor, /targetMonitorBatchSize/);
  assert.match(monitor, /targetMonitorCadenceMinutes/);
  assert.match(monitor, /runTargetProductMonitorBatch/);
  assert.match(monitor, /staleBefore/);
  assert.match(monitor, /staleAfter/);
  assert.match(cron, /TARGET_MONITOR_CRON_ENABLED/);
  assert.match(cron, /target_due/);
  assert.match(env, /TARGET_MONITOR_BATCH_SIZE/);
  assert.match(env, /TARGET_MONITOR_CADENCE_MINUTES/);
  assert.match(types, /targetQueueRemaining/);
  assert.match(types, /targetProductsCheckedLastRun/);
});

test("alerts long lists are paginated for performance", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  assert.match(alertsPanel, /targetCandidateVisibleLimit/);
  assert.match(alertsPanel, /watchlistVisibleLimit/);
  assert.match(alertsPanel, /historyVisibleLimit/);
  assert.match(alertsPanel, /systemVisibleLimit/);
  assert.match(alertsPanel, /visibleTargetCandidates = useMemo/);
  assert.match(alertsPanel, /visibleWatchProducts = useMemo/);
  assert.match(alertsPanel, /visibleHistoryAlerts = useMemo/);
  assert.match(alertsPanel, /visibleSystemAlerts = useMemo/);
  assert.match(alertsPanel, /Load more candidates/);
  assert.match(alertsPanel, /Load more watch products/);
  assert.match(alertsPanel, /Load more alert history/);
  assert.match(alertsPanel, /Load more system alerts/);
  assert.match(app, /Operational payload and scan health/);
  assert.match(app, /API payload caps: inventory 200, discovery candidates 80, alerts 50, monitor logs 50/);
  assert.match(app, /Notification Delivery Log/);
  assert.match(types, /NotificationDeliveryLogDTO/);
  assert.match(types, /notificationDeliveryLogs/);
  assert.match(types, /bestBuyProductsWatched/);
  assert.match(types, /bestBuyDiscoveryApiConfigured/);
});

test("tracker matching helpers cover keywords, identifiers, mute, duplicate cooldown, and feedback", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const trackerMutedHelper = app.slice(app.indexOf("function trackerMuted"), app.indexOf("function trackerDuplicateCooldownKey"));

  assert.match(app, /function trackerKeywordMatch/);
  assert.match(app, /blockedBy/);
  assert.match(app, /function trackerSkuMatch/);
  assert.match(app, /product\.sku, product\.upc, product\.dpci, product\.retailerProductId/);
  assert.match(app, /function trackerMuted/);
  assert.match(trackerMutedHelper, /suppressedAt/);
  assert.doesNotMatch(trackerMutedHelper, /cooldownUntil/);
  assert.match(app, /function trackerDuplicateCooldownKey/);
  assert.match(app, /markAlert\(alert, "false_positive"/);
  assert.match(app, /Alert muted for now/);
  assert.match(app, /Bad-alert feedback saved/);
});

test("alerts Check Stock avoids fake local stock and inventory handoff is wired", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  assert.match(alertsPanel, /Retailer stock check/);
  assert.match(alertsPanel, /store stock source not available/);
  assert.match(alertsPanel, /GameStop/);
  assert.match(alertsPanel, /Pokemon Center/);
  assert.match(alertsPanel, /\/api\/radar\/check-stock/);
  assert.match(alertsPanel, /Best Buy \+ GameStop \+ Pokemon Center/);
  assert.match(alertsPanel, /Pokemon Center is online-only; use Online Drops \/ Watchlist/);
  assert.doesNotMatch(alertsPanel, /Stock: 10/);
  assert.match(app, /INVENTORY_PREFILL_STORAGE_KEY/);
  assert.match(app, /window\.sessionStorage\.setItem\(INVENTORY_PREFILL_STORAGE_KEY/);
  assert.match(app, /window\.sessionStorage\.getItem\(INVENTORY_PREFILL_STORAGE_KEY\)/);
  assert.match(app, /source: "Tracker Alert"/);
});

test("alerts watchlist can add exact watched products from the tracker UI", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const watchForm = app.slice(app.indexOf("function WatchProductQuickForm"), app.indexOf("function AlertsPanel"));
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  assert.match(watchForm, /Add Watch Product/);
  for (const field of ["retailerId", "name", "url", "sku", "upc", "dpci", "retailerProductId", "imageUrl", "productType", "requiredWords", "monitorEnabled"]) {
    assert.match(watchForm, new RegExp(`name="${field}"`), `missing watch field ${field}`);
  }
  assert.match(watchForm, /requestJson\("\/api\/radar\/products"/);
  assert.match(watchForm, /Search\/category links stay unverified/);
  assert.match(alertsPanel, /openWatchProductForm/);
  assert.match(alertsPanel, /trackerWatchPrefillFromRecord/);
});

test("watchlist QA exposes real product readiness, warnings, and monitor actions", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));
  const editForm = app.slice(app.indexOf("function WatchProductIdentifierForm"), app.indexOf("function AlertsPanel"));
  const watchForm = app.slice(app.indexOf("function WatchProductQuickForm"), app.indexOf("function WatchProductIdentifierForm"));

  assert.match(app, /function watchProductWarnings/);
  assert.match(app, /Search\/category URL is rejected for live alerts/);
  assert.match(app, /Live stock status is not verified/);
  assert.match(app, /watchlistRetailerFilters/);
  assert.match(watchForm, /GameStop: use the exact GameStop product page/);
  assert.match(watchForm, /Pokemon Center: use the exact pokemoncenter\.com\/product page/);
  assert.match(watchForm, /Queue, captcha, or waiting-room pages become System Alerts only/);
  assert.match(watchForm, /product ID from the URL/);
  assert.match(alertsPanel, /Watchlist QA/);
  assert.match(alertsPanel, /Ready for Live Alerts/);
  assert.match(alertsPanel, /watchRetailerFilter/);
  assert.match(alertsPanel, /No GameStop products watched yet/);
  assert.match(alertsPanel, /Add GameStop Product/);
  assert.match(alertsPanel, /Seed Real GameStop Product/);
  assert.match(alertsPanel, /\/api\/radar\/products\/seed-gamestop/);
  assert.match(alertsPanel, /openRetailerWatchProductForm\("GameStop"\)/);
  assert.match(alertsPanel, /No Pokemon Center products watched yet/);
  assert.match(alertsPanel, /Add Pokemon Center Product/);
  assert.match(alertsPanel, /Seed Real Pokemon Center Product/);
  assert.match(alertsPanel, /\/api\/radar\/products\/seed-pokemon-center/);
  assert.match(alertsPanel, /openRetailerWatchProductForm\("Pokemon Center"\)/);
  assert.match(alertsPanel, /Target \/ Best Buy \/ GameStop \/ Pokemon Center products/);
  assert.match(alertsPanel, /Run Check Now/);
  assert.match(alertsPanel, /Edit Identifiers/);
  assert.match(alertsPanel, /Verify Exact Product/);
  assert.match(alertsPanel, /Open Product Page/);
  assert.match(alertsPanel, /Create Test Live Drop/);
  assert.match(alertsPanel, /Pause Monitor/);
  assert.match(alertsPanel, /Remove Watch Product/);
  assert.match(alertsPanel, /\/api\/radar\/products\/\$\{product\.id\}\/verify/);
  assert.match(alertsPanel, /\/api\/radar\/products\/\$\{product\.id\}\/archive/);
  for (const field of ["sku", "upc", "dpci", "retailerProductId", "expectedTitleKeywords", "imageUrl"]) {
    assert.match(editForm, new RegExp(`name="${field}"`), `missing edit field ${field}`);
  }
});

test("product create and edit save retailer product IDs parsed from exact URLs", () => {
  const service = fs.readFileSync(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8");
  const gameStopRoute = fs.readFileSync(new URL("../src/app/api/radar/products/seed-gamestop/route.ts", import.meta.url), "utf8");
  const pokemonCenterRoute = fs.readFileSync(new URL("../src/app/api/radar/products/seed-pokemon-center/route.ts", import.meta.url), "utf8");

  assert.match(service, /classifyRetailerProductUrl/);
  assert.match(service, /ensureGameStopWatchProduct/);
  assert.match(service, /ensurePokemonCenterWatchProduct/);
  assert.match(service, /gamestop\.com\/toys-games\/trading-cards\/products\/pokemon-trading-card-game-mega-evolution-booster-bundle\/20023793\.html/);
  assert.match(service, /pokemoncenter\.com\/product\/10-10377-109\/pokemon-tcg-mega-evolution-booster-bundle/);
  assert.match(service, /const urlIdentity = classifyRetailerProductUrl\(input\.url, retailer\.name\)/);
  assert.match(service, /const retailerProductId = input\.retailerProductId \|\| urlIdentity\.retailerProductIdFromUrl \|\| undefined/);
  assert.match(service, /before\.retailerProductId !== \(retailerProductId \?\? null\)/);
  assert.match(service, /retailerProductId,/);
  assert.match(gameStopRoute, /requireAdmin/);
  assert.match(gameStopRoute, /ensureGameStopWatchProduct/);
  assert.match(pokemonCenterRoute, /requireAdmin/);
  assert.match(pokemonCenterRoute, /ensurePokemonCenterWatchProduct/);
});

test("live drops are restricted to real product monitor alerts", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const liveDropHelper = app.slice(app.indexOf("function trackerIsLiveDrop"), app.indexOf("function trackerChannelMatches"));
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  assert.match(liveDropHelper, /record\.category === "tracker_online_drop"/);
  assert.match(liveDropHelper, /record\.alert\.entityType === "PRODUCT"/);
  assert.match(liveDropHelper, /Boolean\(record\.product\)/);
  assert.match(liveDropHelper, /explicitTrackerDrop/);
  assert.match(liveDropHelper, /priceDropWithoutBuyableStock/);
  assert.match(liveDropHelper, /manual checkout only/);
  assert.match(alertsPanel, /\.filter\(\(record\) => trackerIsLiveDrop\(record\)\)/);
  assert.doesNotMatch(liveDropHelper, /tracker_sold_out/);
  assert.match(alertsPanel, /Repeat checks use the product\/event key before creating new Live Drops, but current buyable products stay visible here/);
  assert.match(alertsPanel, /Live Drops are created only when stock is proven buyable and retail\/MSRP eligible/);
});

test("admin-only tracker simulation and alert actions are wired", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const notificationPanel = app.slice(app.indexOf("function NotificationSettingsPanel"), app.indexOf("function AccessManagementPanel"));
  const alertsPanel = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function configuredText"));

  assert.match(notificationPanel, /Simulate Tracker Alert/);
  assert.match(notificationPanel, /Clear Test Alerts/);
  assert.match(notificationPanel, /productReadyForAlert/);
  assert.match(notificationPanel, /action: "simulate_tracker_drop"/);
  assert.match(notificationPanel, /Admin simulated a tracker_online_drop/);
  assert.match(notificationPanel, /requestJson\("\/api\/radar\/alerts", \{ method: "DELETE" \}/);
  for (const action of ["Go Buy", "Add to Inventory", "Watch", "Mute", "Got It", "Missed", "Sold Out", "Bad Alert"]) {
    assert.match(alertsPanel, new RegExp(action), `missing alert action ${action}`);
  }
});

test("admin health exposes build version and cache refresh controls", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const health = fs.readFileSync(new URL("../src/lib/health.ts", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const packageJson = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");

  assert.match(app, /App Build/);
  assert.match(app, /Refresh App \/ Clear Cache/);
  assert.match(app, /APP_VERSION_READY/);
  assert.match(app, /APP_CACHE_CLEARED/);
  assert.match(health, /getBuildInfo/);
  assert.match(types, /serviceWorkerVersion/);
  assert.match(serviceWorker, /poke-radar-sw-2026-06-03-live-drops-v4/);
  assert.match(serviceWorker, /CLEAR_APP_CACHE/);
  assert.match(serviceWorker, /SKIP_WAITING/);
  assert.match(packageJson, /"build:info"/);
  assert.match(packageJson, /"prevercel-build"/);
});

test("monitor creates explicit tracker online drop and system alert events", () => {
  const monitor = fs.readFileSync(new URL("../src/lib/monitor.ts", import.meta.url), "utf8");
  const notifications = fs.readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
  const route = fs.readFileSync(new URL("../src/app/api/radar/alerts/route.ts", import.meta.url), "utf8");

  assert.match(monitor, /createTrackerOnlineDropAlert/);
  assert.match(monitor, /trackerEventKindForDetection/);
  assert.ok(
    monitor.indexOf("if (!detectionReadyForBuyAlerts(input.detection)) return null;") <
      monitor.indexOf("return \"price_drop\" satisfies TrackerDropEventKind;"),
    "price-drop tracker events must stay behind the buyable exact-product gate"
  );
  assert.match(monitor, /fetchPokemonCenterLiveSignal/);
  assert.match(monitor, /pokemonCenterSignal/);
  assert.match(monitor, /tracker_online_drop:\$\{input\.product\.id\}/);
  assert.match(monitor, /delivery\.inAppCreated === 0/);
  assert.match(monitor, /existingVisible/);
  assert.match(monitor, /createTrackerSystemAlert/);
  assert.match(monitor, /kind: "blocked"/);
  assert.match(monitor, /kind: "error"/);
  assert.match(notifications, /payload\.dedupeKey/);
  assert.match(notifications, /payload\.score/);
  assert.match(notifications, /recordAlertDelivery/);
  assert.match(notifications, /quiet_hours/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /clearSimulatedTrackerAlerts/);
});
