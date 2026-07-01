import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  applyStorefrontOrderAdjustmentsToInventory,
  calculateInventorySaleProfitForTest,
  filterDashboardAlertsForStorefrontOrderStatus,
  inventoryCompStatsForTest,
  inventoryLotUnitCostForTest,
  summarizeInventory
} from "../src/lib/radar-service";
import {
  storefrontAvailabilityLabel,
  storefrontConfiguredPurchaseLimit,
  storefrontEffectiveMaxQuantity,
  storefrontPurchaseLimitLabel
} from "../src/lib/storefront-purchase-limits";
import { inferTcgcsvProductType, normalizeTcgcsvProductText } from "../src/lib/tcgcsv-market";
import type { AlertDTO, InventoryItemDTO, InventorySaleDTO, StorefrontOrderDTO } from "../src/types/radar";

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

function sale(overrides: Partial<InventorySaleDTO> = {}): InventorySaleDTO {
  const base: InventorySaleDTO = {
    id: "sale-1",
    inventoryItemId: "item-1",
    itemName: "Test Product",
    quantitySold: 1,
    activeQuantitySold: 1,
    actualSalePrice: 20,
    soldPricePerItem: 20,
    grossSale: 20,
    activeGrossSale: 20,
    platform: "local",
    fees: 0,
    shippingCost: 0,
    netSale: 20,
    activeNetSale: 20,
    costBasis: 10,
    stockLotSource: "FIFO stock lots",
    profitLoss: 10,
    activeProfitLoss: 10,
    roiPercent: 100,
    saleStatus: "active",
    storefrontOrderNumber: null,
    storefrontOrderStatus: null,
    refundStatus: null,
    refundedAmount: 0,
    netRevenueAfterRefund: 20,
    soldAt: new Date().toISOString(),
    notes: null,
    createdAt: new Date().toISOString()
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    activeQuantitySold: overrides.activeQuantitySold ?? merged.quantitySold,
    activeGrossSale: overrides.activeGrossSale ?? merged.grossSale,
    activeNetSale: overrides.activeNetSale ?? merged.netSale,
    activeProfitLoss: overrides.activeProfitLoss ?? merged.profitLoss,
    netRevenueAfterRefund: overrides.netRevenueAfterRefund ?? merged.grossSale
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
    purchaseLimitEnabled: false,
    shippingProfile: "standard",
    packageWeightOz: null,
    packageLengthIn: null,
    packageWidthIn: null,
    packageHeightIn: null,
    shippingMetadataSource: null,
    freeShippingEligible: false,
    localPickupEligible: false,
    requiresBox: false,
    insuranceRecommended: false,
    needsShippingProfile: true,
    storeStatus: "draft",
    localPickupAvailable: false,
    shippingAvailable: true,
    storefrontCategory: null,
    storefrontTags: [],
    publishedAt: null,
    totalSalesGross: 0,
    totalSalesNet: 0,
    realizedProfitLoss: 0,
    realizedRoiPercent: null,
    businessProfitLoss: 0,
    lastThreeComps: [],
    productImages: [],
    stockLots: [],
    sales: [],
    expectedPlan: "Hold",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function storefrontOrder(overrides: Partial<StorefrontOrderDTO> = {}): StorefrontOrderDTO {
  const now = new Date().toISOString();
  return {
    id: "order-1",
    orderNumber: "GDG-1001",
    customerEmail: "buyer@example.com",
    customerName: "Test Buyer",
    customerPhone: null,
    stripeCustomerId: "cus_test",
    customerOrderCount: 1,
    customerTotalSpent: 100,
    shippingAddress: null,
    billingAddress: null,
    status: "paid",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    source: "stripe_checkout",
    sourceLabel: "Stripe Checkout",
    isLocalPickup: false,
    itemCount: 1,
    needsFulfillment: true,
    isNewPaidOrder: true,
    statusBadge: "Paid",
    subtotal: 100,
    shippingCharged: 0,
    shippingMethodLabel: null,
    shippingRateSource: null,
    shippingPackageWeightOz: null,
    shippingPackageLengthIn: null,
    shippingPackageWidthIn: null,
    shippingPackageHeightIn: null,
    shippingPackageProfile: null,
    shippingWarnings: [],
    shippingQuoteId: null,
    shippingQuoteProvider: null,
    shippingCarrier: null,
    shippingService: null,
    shippingQuotedAmountCents: null,
    shippingQuotedZip: null,
    shippingQuoteFallbackUsed: false,
    shippingQuoteExpiresAt: null,
    shippingZipMismatchReview: false,
    shippingLabelProvider: null,
    shippingLabelProviderId: null,
    shippingLabelUrl: null,
    shippingLabelFileType: null,
    shippingTrackingNumber: null,
    shippingTrackingUrl: null,
    shippingLabelCostCents: null,
    shippingLabelCurrency: null,
    shippingLabelPurchasedAt: null,
    shippingLabelVoidedAt: null,
    shippingLabelStatus: null,
    tax: 0,
    total: 100,
    stripeFeeEstimate: 5,
    shippingCost: 0,
    costBasis: 60,
    netProfit: 35,
    roiPercent: 58.33,
    trackingNumber: null,
    carrier: null,
    notes: null,
    stripeCheckoutSessionId: "cs_test",
    stripePaymentIntentId: "pi_test",
    refundStatus: null,
    refundedAmount: 0,
    refundableAmount: 100,
    refundCurrency: "usd",
    stripeRefundId: null,
    refundReason: null,
    refundNote: null,
    stockReturnStatus: null,
    stockReturnedAt: null,
    customerCancellationEmailStatus: null,
    customerCancellationEmailSentAt: null,
    isTestOrder: false,
    testOrderReason: null,
    testMarkedAt: null,
    testMarkedBy: null,
    canCancelOrRefund: true,
    paidAt: now,
    shippedAt: null,
    canceledAt: null,
    refundedAt: null,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: "order-item-1",
        inventoryItemId: "item-1",
        publicTitle: "Test Product",
        publicSlug: "test-product",
        imageUrl: null,
        upc: null,
        sku: null,
        dpci: null,
        tcin: null,
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
        costBasis: 60,
        profitLoss: 35
      }
    ],
    reservations: [],
    paymentEvents: [],
    customerEmailNotifications: [],
    rewardSummary: {
      pointsEarned: 0,
      pointsReversed: 0,
      netPoints: 0,
      ledgerCount: 0,
      status: "No rewards recorded",
      redemptionEnabled: false
    },
    customerRewardSummary: null,
    timeline: [],
    ...overrides
  };
}

function dashboardAlert(overrides: Partial<AlertDTO> = {}): AlertDTO {
  const now = new Date().toISOString();
  return {
    id: "alert-1",
    title: "New paid order",
    reason: "Stripe Checkout paid order GDG-1001 is ready for fulfillment.",
    priority: "HIGH",
    timestamp: now,
    entityType: "STOREFRONT_ORDER",
    entityId: "order-1",
    actionUrl: "/?tab=orders",
    read: false,
    score: 96,
    dedupeKey: "storefront-order:order-1:paid",
    explanation: null,
    falsePositiveAt: null,
    suppressedAt: null,
    cooldownUntil: null,
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

test("fully refunded storefront sales stay in history but are excluded from active sales totals", () => {
  const adjusted = applyStorefrontOrderAdjustmentsToInventory(
    [
      item({
        quantityOwned: 3,
        quantitySold: 1,
        sales: [
          sale({
            grossSale: 100,
            netSale: 95,
            costBasis: 60,
            profitLoss: 35,
            platform: "website",
            notes: "Storefront order GDG-1001"
          })
        ]
      })
    ],
    [
      storefrontOrder({
        status: "refunded",
        paymentStatus: "refunded",
        fulfillmentStatus: "canceled",
        refundedAmount: 100,
        refundableAmount: 0,
        refundStatus: "refunded"
      })
    ]
  );
  const adjustedSale = adjusted[0].sales[0];
  const summary = summarizeInventory(adjusted);

  assert.equal(adjustedSale.saleStatus, "refunded");
  assert.equal(adjustedSale.grossSale, 100);
  assert.equal(adjustedSale.activeGrossSale, 0);
  assert.equal(adjustedSale.netRevenueAfterRefund, 0);
  assert.equal(summary.totalSalesGross, 0);
  assert.equal(summary.totalSalesNet, 0);
  assert.equal(summary.realizedProfitLoss, 0);
  assert.equal(summary.itemsSold, 0);
});

test("test storefront sales stay in history but are excluded from active business totals", () => {
  const adjusted = applyStorefrontOrderAdjustmentsToInventory(
    [
      item({
        quantityOwned: 3,
        quantitySold: 1,
        sales: [
          sale({
            grossSale: 18,
            netSale: 18,
            costBasis: 9,
            profitLoss: 9,
            platform: "website",
            notes: "Storefront order GDG-1001"
          })
        ]
      })
    ],
    [
      storefrontOrder({
        isTestOrder: true,
        testOrderReason: "live_checkout_smoke",
        testMarkedAt: new Date().toISOString(),
        testMarkedBy: "admin@example.com"
      })
    ]
  );
  const adjustedSale = adjusted[0].sales[0];
  const summary = summarizeInventory(adjusted);

  assert.equal(adjustedSale.saleStatus, "test");
  assert.equal(adjustedSale.grossSale, 18);
  assert.equal(adjustedSale.activeGrossSale, 0);
  assert.equal(adjustedSale.activeNetSale, 0);
  assert.equal(adjustedSale.activeProfitLoss, 0);
  assert.equal(adjustedSale.activeQuantitySold, 0);
  assert.equal(adjustedSale.netRevenueAfterRefund, 0);
  assert.equal(summary.totalSalesGross, 0);
  assert.equal(summary.realizedProfitLoss, 0);
  assert.equal(summary.itemsSold, 0);
});

test("partially refunded storefront sales count only remaining net revenue and adjusted profit", () => {
  const adjusted = applyStorefrontOrderAdjustmentsToInventory(
    [
      item({
        sales: [
          sale({
            grossSale: 100,
            netSale: 95,
            costBasis: 60,
            profitLoss: 35,
            platform: "website",
            notes: "Storefront order GDG-1001"
          })
        ]
      })
    ],
    [
      storefrontOrder({
        status: "partially_refunded",
        paymentStatus: "partially_refunded",
        fulfillmentStatus: "canceled",
        refundedAmount: 25,
        refundableAmount: 75,
        refundStatus: "partially_refunded"
      })
    ]
  );
  const adjustedSale = adjusted[0].sales[0];
  const summary = summarizeInventory(adjusted);

  assert.equal(adjustedSale.saleStatus, "partially_refunded");
  assert.equal(adjustedSale.refundedAmount, 25);
  assert.equal(adjustedSale.activeGrossSale, 75);
  assert.equal(adjustedSale.activeNetSale, 70);
  assert.equal(adjustedSale.activeProfitLoss, 10);
  assert.equal(summary.totalSalesGross, 75);
  assert.equal(summary.totalSalesNet, 70);
  assert.equal(summary.realizedProfitLoss, 10);
  assert.equal(summary.itemsSold, 1);
});

test("canceled unpaid orders do not create active sales totals", () => {
  const adjusted = applyStorefrontOrderAdjustmentsToInventory(
    [
      item({
        sales: [
          sale({
            grossSale: 40,
            netSale: 38,
            costBasis: 25,
            profitLoss: 13,
            platform: "website",
            notes: "Storefront order GDG-1001"
          })
        ]
      })
    ],
    [
      storefrontOrder({
        status: "canceled",
        paymentStatus: "failed",
        fulfillmentStatus: "canceled",
        refundedAmount: 0,
        refundableAmount: 0,
        refundStatus: "not_applicable"
      })
    ]
  );
  const summary = summarizeInventory(adjusted);

  assert.equal(adjusted[0].sales[0].saleStatus, "canceled");
  assert.equal(summary.totalSalesGross, 0);
  assert.equal(summary.realizedProfitLoss, 0);
  assert.equal(summary.itemsSold, 0);
});

test("inventory summary fixture matches dashboard KPI formulas", () => {
  const summary = summarizeInventory([
    item({
      id: "item-kpi-1",
      totalCost: 120,
      quantityOwned: 3,
      quantitySold: 1,
      averageCost: 15,
      sales: [
        sale({
          id: "sale-active",
          grossSale: 100,
          activeGrossSale: 100,
          netSale: 90,
          activeNetSale: 90,
          costBasis: 50,
          profitLoss: 40,
          activeProfitLoss: 40
        }),
        sale({
          id: "sale-refunded",
          grossSale: 50,
          activeGrossSale: 0,
          netSale: 45,
          activeNetSale: 0,
          costBasis: 20,
          profitLoss: 25,
          activeProfitLoss: 0,
          quantitySold: 1,
          activeQuantitySold: 0,
          saleStatus: "refunded"
        })
      ]
    })
  ]);

  assert.equal(summary.itemsOwned, 3);
  assert.equal(summary.inventoryCostBasis, 45);
  assert.equal(summary.totalSpent, 120);
  assert.equal(summary.totalSalesGross, 100);
  assert.equal(summary.totalSalesNet, 90);
  assert.equal(summary.realizedProfitLoss, 40);
  assert.equal(summary.itemsSold, 1);
});

test("inventory dashboard KPI cards use financially accurate labels and fields", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const inventoryPanel = sourceSlice(app, "function InventoryPanel", "type StorefrontOrderTab");

  assert.match(inventoryPanel, /label="Total Products" value=\{String\(dashboard\.inventory\.length\)\}/);
  assert.match(inventoryPanel, /label="Units On Hand" value=\{String\(summary\.itemsOwned\)\}/);
  assert.match(inventoryPanel, /label="Inventory Cost" value=\{money\(summary\.inventoryCostBasis\)\}/);
  assert.match(inventoryPanel, /label="Active Sales" value=\{money\(summary\.totalSalesNet\)\}/);
  assert.match(inventoryPanel, /label="Realized Profit"/);
  assert.match(inventoryPanel, /value=\{money\(summary\.realizedProfitLoss\)\}/);
  assert.doesNotMatch(inventoryPanel, /label="Items Owned"/);
  assert.doesNotMatch(inventoryPanel, /label="Total Spent"/);
  assert.doesNotMatch(inventoryPanel, /label="Net Profit \/ Loss"/);
  assert.doesNotMatch(inventoryPanel, /money\(summary\.totalSalesGross\)/);
  assert.doesNotMatch(inventoryPanel, /money\(summary\.netProfitLoss\)/);
});

test("inventory row metrics use current on-hand cost and storefront sell price", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const listComponent = sourceSlice(app, "function InventoryList", "function inventoryStockStatusLabel");

  assert.match(app, /function inventoryOnHandCost\(item: Pick<InventoryItemDTO, "averageCost" \| "quantityOwned">\)/);
  assert.match(app, /return item\.averageCost \* item\.quantityOwned/);
  assert.match(app, /function inventoryDisplaySellPrice\(item: Pick<InventoryItemDTO, "publicPrice" \| "targetSellPrice">\)/);
  assert.match(app, /return item\.publicPrice \?\? item\.targetSellPrice/);
  assert.match(listComponent, /data-label="Avg Cost">\{money\(item\.averageCost\)\}/);
  assert.match(listComponent, /data-label="Total Cost">\{money\(inventoryOnHandCost\(item\)\)\}/);
  assert.match(listComponent, /const sellPrice = inventoryDisplaySellPrice\(item\)/);
  assert.match(listComponent, /\{sellPrice !== null \? money\(sellPrice\) : "Not set"\}/);
  assert.match(listComponent, /data-label="Sold">\{item\.quantitySold\}/);
  assert.match(listComponent, /data-label="Realized Profit"/);
  assert.match(listComponent, /money\(item\.realizedProfitLoss\)/);
  assert.doesNotMatch(listComponent, /data-label="Total Cost">\{money\(item\.totalCost\)\}/);
  assert.doesNotMatch(listComponent, /item\.targetSellPrice !== null \? money\(item\.targetSellPrice\)/);
});

test("inventory dashboard polish does not introduce checkout payment or refund behavior", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const inventoryPanel = sourceSlice(app, "function InventoryPanel", "type StorefrontOrderTab");
  const inventoryList = sourceSlice(app, "function InventoryList", "function inventoryStockStatusLabel");

  assert.match(inventoryPanel, /InventoryStorefrontPublishToolbar/);
  assert.match(inventoryList, /catalog-action-menu-section/);
  assert.doesNotMatch(inventoryPanel + inventoryList, /stripe|checkout|paymentIntent|refunds\.create|cancelOrRefund|createCheckoutSession/i);
});

test("refunded storefront orders suppress stale paid fulfillment dashboard alerts", () => {
  const alerts = [
    dashboardAlert({
      id: "paid-alert",
      title: "New paid order",
      reason: "Stripe Checkout paid order GDG-1001 is ready for fulfillment.",
      dedupeKey: "storefront-order:order-1:paid"
    }),
    dashboardAlert({
      id: "refund-alert",
      title: "Order refunded",
      reason: "Storefront order GDG-1001 was refunded and removed from active fulfillment alerts.",
      priority: "MEDIUM",
      dedupeKey: "storefront-order:order-1:refunded"
    }),
    dashboardAlert({
      id: "product-alert",
      title: "Product restocked",
      reason: "A watched product is in stock.",
      entityType: "PRODUCT",
      entityId: "product-1",
      dedupeKey: "product:product-1:restock"
    })
  ];

  const filtered = filterDashboardAlertsForStorefrontOrderStatus(alerts, [
    storefrontOrder({
      status: "refunded",
      paymentStatus: "refunded",
      fulfillmentStatus: "canceled"
    })
  ]);

  assert.deepEqual(filtered.map((alert) => alert.id), ["refund-alert", "product-alert"]);
  assert.doesNotMatch(filtered.map((alert) => `${alert.title} ${alert.reason}`).join("\n"), /New paid order|ready for fulfillment/);
});

test("inventory sale profit uses actual sale price instead of target price", () => {
  const result = calculateInventorySaleProfitForTest({
    actualSalePrice: 90,
    quantitySold: 1,
    costBasis: 80.74,
    targetSellPrice: 95,
    publicStorePrice: 95
  });

  assert.equal(result.grossSale, 90);
  assert.equal(Number(result.profitLoss.toFixed(2)), 9.26);
});

test("inventory sale profit includes full stock lot cost basis when tax and shipping are part of the lot", () => {
  const result = calculateInventorySaleProfitForTest({
    actualSalePrice: 90,
    quantitySold: 1,
    costBasis: 96.49,
    targetSellPrice: 95,
    publicStorePrice: 95
  });

  assert.equal(result.grossSale, 90);
  assert.equal(Number(result.profitLoss.toFixed(2)), -6.49);
});

test("stock lot total cost overrides raw unit cost for sale cost basis", () => {
  const unitCost = inventoryLotUnitCostForTest({
    costPerUnit: 80.74,
    totalCost: 96.49,
    quantity: 1
  });

  assert.equal(Number(unitCost.toFixed(2)), 96.49);
});

test("inventory sale editing and stock lot editing recalculate realized profit", () => {
  const service = fs.readFileSync(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const saleUpdateRoute = fs.readFileSync(new URL("../src/app/api/radar/inventory/[itemId]/sales/[saleId]/route.ts", import.meta.url), "utf8");

  assert.match(service, /export async function updateInventorySale/);
  assert.match(service, /await recalculateInventorySalesAndLots\(item\.id\)/);
  assert.match(service, /await syncInventoryItemTotalsFromLots\(item\.id\);[\s\S]*await recalculateInventorySalesAndLots\(item\.id\);/);
  assert.match(service, /const grossSale = input\.actualSalePrice \* input\.quantitySold/);
  assert.match(service, /targetSellPrice\?: number \| null/);
  assert.match(service, /publicStorePrice\?: number \| null/);
  assert.match(app, /label="Actual sale price"/);
  assert.match(app, /Actual Sale Price/);
  assert.match(app, /Stock Lot Source/);
  assert.match(app, /Profit uses actual recorded sale price and stock lot cost basis/);
  assert.match(saleUpdateRoute, /inventorySaleUpdateSchema/);
  assert.match(saleUpdateRoute, /updateInventorySale/);
});

test("inventory mutations reveal or explain saved rows after refresh", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(app, /type InventoryMutationIntent/);
  assert.match(app, /inventoryItemMatchesFilters\(item, filters, dashboard\.shippingProfiles\)/);
  assert.match(app, /findMutatedInventoryItem\(dashboard\.inventory, pendingInventoryMutation\)/);
  assert.match(app, /saved, but hidden by current filters/);
  assert.match(app, /Clear filters and show item/);
  assert.match(app, /id=\{`inventory-row-\$\{item\.id\}`\}/);
  assert.match(app, /data-highlighted=\{highlightedId === item\.id/);
  assert.match(css, /\.catalog-row\.inventory-row-highlighted/);
  assert.match(css, /scroll-margin-top: 120px/);
});

test("inventory admin modals use light layout and stock edit has live cost preview", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(app, /stock-cost-preview/);
  assert.match(app, /Calculated total/);
  assert.match(app, /Effective total/);
  assert.match(app, /Average cost/);
  assert.match(app, /remainingAfterSoldLock/);
  assert.match(app, /Public storefront listings never expose cost basis/);
  assert.match(css, /body \.inventory-details-modal/);
  assert.match(css, /body \.inventory-modal,[\s\S]*background: #ffffff !important/);
  assert.match(css, /\.inventory-detail-section,[\s\S]*background: #ffffff !important/);
  assert.match(css, /\.stock-cost-preview/);
});

test("admin modal checkboxes and sticky footers stay on light theme", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const finalCleanup = css.slice(css.indexOf("Inventory admin visibility and white-modal cleanup"));
  const editListing = app.slice(app.indexOf("function StoreListingModal"), app.indexOf("function InventoryMarketHero"));

  assert.match(editListing, /Shipping available/);
  assert.match(editListing, /Local pickup eligible/);
  assert.match(editListing, /inventory-edit-actions/);
  assert.match(finalCleanup, /body \.checkbox-label,[\s\S]*background: #ffffff !important/);
  assert.match(finalCleanup, /body \.checkbox-label:has\(input:checked\),[\s\S]*background: #f0fdf4 !important/);
  assert.match(finalCleanup, /body \.inventory-edit-actions,[\s\S]*background: linear-gradient\(180deg, rgba\(255, 255, 255, 0\.88\), #ffffff 38%\) !important/);
  assert.match(finalCleanup, /body \.inventory-edit-actions \.primary-action[\s\S]*background: #22c55e !important/);
  assert.doesNotMatch(finalCleanup, /background: linear-gradient\(180deg, rgba\(11, 14, 13/);
  assert.doesNotMatch(finalCleanup, /background: #0b0e0d/);
});

test("private admin app source styles do not keep old dark layout surfaces", () => {
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const adminCss = css.slice(0, css.indexOf("GameDayGrabs public storefront"));

  assert.match(adminCss, /body \{[\s\S]*linear-gradient\(180deg, #f7f9fb 0%, #f8fafc 46%, #eef4f8 100%\)/);
  assert.match(adminCss, /input,[\s\S]*textarea \{[\s\S]*background: #ffffff/);
  assert.match(adminCss, /\.inventory-modal \{[\s\S]*background: #ffffff/);
  assert.match(adminCss, /\.inventory-details-modal \{[\s\S]*#ffffff/);
  assert.match(adminCss, /\.admin-drawer \{[\s\S]*#ffffff/);
  assert.match(adminCss, /\.barcode-camera-panel,[\s\S]*background: #f8fafc/);
  assert.match(adminCss, /\.inventory-choice-card \{[\s\S]*background: #ffffff/);
  assert.match(adminCss, /\.sale-product-preview \{[\s\S]*background: #f8fafc/);
  assert.doesNotMatch(adminCss, /linear-gradient\(180deg, #090b0a/);
  assert.doesNotMatch(adminCss, /background:\s*(#0a0c0b|#0b0e0d|#050505|#080808|#0f1115|#111827|#0f172a)/);
  assert.doesNotMatch(adminCss, /background:\s*rgba\(0,\s*0,\s*0/);
  assert.doesNotMatch(adminCss, /background:\s*rgba\((18,\s*21,\s*20|9,\s*15,\s*18|7,\s*8,\s*8|9,\s*11,\s*10|5,\s*7,\s*7|8,\s*10,\s*9)/);
});

test("inventory catalog row actions fit inside the operating screen", () => {
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const catalogCleanup = css.slice(css.indexOf("body .app-main-inventory .catalog-row"));

  assert.match(catalogCleanup, /minmax\(240px, 2\.1fr\)/);
  assert.match(catalogCleanup, /minmax\(92px, 0\.58fr\) !important/);
  assert.match(catalogCleanup, /body \.catalog-action-trigger \{[\s\S]*min-width: 0/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*body \.app-main-inventory \.catalog-row,[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.doesNotMatch(catalogCleanup, /minmax\(300px, 2\.25fr\)[\s\S]*minmax\(112px, 0\.64fr\) !important/);
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
  const routing = fs.readFileSync(new URL("../src/lib/storefront-routing.ts", import.meta.url), "utf8");
  const storefrontNavigation = fs.readFileSync(new URL("../src/lib/storefront-navigation.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const home = fs.readFileSync(new URL("../src/lib/storefront-home.ts", import.meta.url), "utf8");
  const serverViews = fs.readFileSync(new URL("../src/components/StorefrontServerViews.tsx", import.meta.url), "utf8");
  const shopPage = fs.readFileSync(new URL("../src/app/shop/page.tsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const settingsRoute = fs.readFileSync(new URL("../src/app/api/radar/storefront/settings/route.ts", import.meta.url), "utf8");
  const prismaSchema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const bulkRoute = fs.readFileSync(new URL("../src/app/api/radar/inventory/store-listing/bulk/route.ts", import.meta.url), "utf8");
  const contactRoute = fs.readFileSync(new URL("../src/app/api/storefront/contact/route.ts", import.meta.url), "utf8");
  const aboutPage = fs.readFileSync(new URL("../src/app/about/page.tsx", import.meta.url), "utf8");
  const policiesPage = fs.readFileSync(new URL("../src/app/policies/page.tsx", import.meta.url), "utf8");
  const contactPage = fs.readFileSync(new URL("../src/app/contact/page.tsx", import.meta.url), "utf8");

  assert.match(validation, /inventoryBulkStorePublishSchema/);
  assert.match(validation, /storefrontContactMessageSchema/);
  assert.match(validation, /contact_message/);
  assert.match(storefront, /bulkPublishInventoryStoreListings/);
  assert.match(storefront, /cleanStorefrontDescription/);
  assert.match(storefront, /cleanStorefrontTitle/);
  assert.match(storefront, /Public price missing/);
  assert.match(storefront, /createContactMessage/);
  assert.match(storefront, /sendStorefrontEmail/);
  assert.match(storefront, /storefrontContactEmail/);
  assert.match(storefront, /sportsCardsExternalUrl/);
  assert.match(routing, /GAMEDAYGRABS_SPORTS_CARDS_URL = "https:\/\/www\.ebay\.com\/str\/a1rbreaks"/);
  assert.match(routing, /storefrontSportsCardsUrl/);
  assert.match(storefront, /sportsCardsExternalUrl: storefrontSportsCardsUrl\(settings\?\.sportsCardsExternalUrl\)/);
  assert.match(routing, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL = "gamedaygrabs@outlook\.com"/);
  assert.match(routing, /LEGACY_PUBLIC_CONTACT_EMAIL = "ariverah7@gmail\.com"/);
  assert.match(storefrontNavigation, /isGameDayGrabsHost/);
  assert.match(storefrontNavigation, /\? "\/" : "\/shop"/);
  assert.match(storefront, /status: "contact_message"/);
  assert.match(storefront, /inquiryCount/);
  assert.match(bulkRoute, /requireUser/);
  assert.match(bulkRoute, /storefront\.listing\.bulk_publish/);
  assert.match(contactRoute, /storefrontContactMessageSchema/);
  assert.match(contactRoute, /createContactMessage/);
  assert.match(settingsRoute, /sportsCardsExternalUrl: input\.sportsCardsExternalUrl \?\? null/);
  assert.match(prismaSchema, /sportsCardsExternalUrl\s+String\?/);
  assert.match(app, /Storefront Publishing/);
  assert.match(app, /Publish Selected/);
  assert.match(app, /Publish All Eligible/);
  assert.match(app, /Listing Quality/);
  assert.match(app, /Distributor Application Checklist/);
  assert.match(app, /Public contact email/);
  assert.match(app, /Sports Cards external link/);
  assert.match(app, /settings\.sportsCardsExternalUrl \|\| GAMEDAYGRABS_SPORTS_CARDS_URL/);
  assert.match(app, /Use this while sports cards are sold through eBay/);
  assert.match(app, /Current public URL/);
  assert.match(app, /Inquiry flow/);
  assert.match(app, /Distributor readiness/);
  assert.match(app, /Preview Storefront/);
  assert.match(client, /StorefrontFooter/);
  assert.match(client, /StorefrontContactForm/);
  assert.match(client, /sportsCardsExternalUrl/);
  assert.match(client, /gdg-gallery \$\{visibleGalleryImages\.length > 1 \? "has-thumbs" : "single-image"\}/);
  assert.match(client, /visibleGalleryImages = images\.filter/);
  assert.match(client, /gdg-gallery-thumbs[\s\S]*onError=\{\(\) => setFailedImages/);
  assert.match(client, /Image coming soon/);
  assert.match(client, /cleanStorefrontDescription/);
  assert.match(client, /storefrontSoldOutNote/);
  assert.match(styles, /\.gdg-gallery-main[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.match(styles, /\.gdg-gallery-main img[\s\S]*object-fit: contain/);
  assert.match(client, /target="_blank"/);
  assert.match(client, /rel="noopener noreferrer"/);
  assert.match(client, /ExternalLink/);
  assert.match(client, /\/api\/storefront\/contact/);
  assert.match(serverViews, /mode="home"/);
  assert.match(serverViews, /mode="shop"/);
  assert.match(serverViews, /homeHref/);
  assert.match(serverViews, /getStorefrontHomeHref/);
  assert.match(serverViews, /StorefrontShopView/);
  assert.match(shopPage, /StorefrontShopView/);
  assert.match(client, /homeCategories/);
  assert.match(client, /categoryPreviewCards/);
  assert.match(client, /homepageFeaturedDropsSection/);
  assert.match(client, /HomepageProductSection/);
  assert.match(client, /HomepageGrabbyTip/);
  assert.match(client, /HomepageSupportStrip/);
  assert.match(client, /HomepageAccountCta/);
  assert.match(home, /Featured Drops/);
  assert.match(client, /Guest checkout stays available\. Sign in anytime to view orders, saved addresses, and points/);
  assert.match(client, /Your account is ready/);
  assert.match(client, /Shop as Guest/);
  assert.match(client, /Shop New Arrivals/);
  assert.match(client, /gdg-home-account-badge-shell/);
  assert.match(client, /<span className="gdg-home-account-badge-mark">G<\/span>/);
  assert.doesNotMatch(client, /gdg-home-account-icon/);
  assert.doesNotMatch(client, /gdg-home-account-[\s\S]{0,160}<User/);
  assert.doesNotMatch(client, /<section className="gdg-trust-bar"/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{almostGoneSection\}/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{collectorPicksSection\}/);
  assert.doesNotMatch(client, /<HomepageProductSection section=\{premiumCollectionsSection\}/);
  assert.ok(client.indexOf("<HomepageAccountCta settings={settings} signedIn={accountSignedIn} />") > client.indexOf('<section className="gdg-hero">'));
  assert.ok(client.indexOf("<HomepageAccountCta settings={settings} signedIn={accountSignedIn} />") < client.indexOf("section={featuredSection}"));
  assert.ok(client.indexOf("<HomepageGrabbyTip />") > client.indexOf("section={featuredSection}"));
  assert.ok(client.indexOf("<HomepageGrabbyTip />") < client.indexOf("<h2>Shop By Category</h2>"));
  assert.ok(client.indexOf("<h2>Shop By Category</h2>") > client.indexOf("section={featuredSection}"));
  assert.match(client, /storefrontCollectionPathForCategory\(category\) \?\? `\/shop\?category=\$\{categoryToSlug\(category\)\}`/);
  assert.match(client, /GAMEDAYGRABS_SPORTS_CARDS_URL/);
  assert.match(client, /Sports card inventory is currently listed on our eBay store/);
  assert.match(client, /Open eBay Store/);
  assert.match(client, /storefrontCollectionPath\("new-arrivals"\)/);
  assert.match(client, /initialCategory/);
  assert.match(client, /initialSort/);
  assert.match(client, /availabilityFromParam/);
  assert.match(shopPage, /searchParams/);
  assert.match(shopPage, /firstParam\(params\.category\)/);
  assert.match(client, /section\.linkLabel/);
  assert.doesNotMatch(client, /\/shop#/);
  assert.match(client, /Contact email pending setup/);
  assert.match(client, /Thanks - we received your request and will contact you shortly/);
  assert.match(client, /customerPhone/);
  assert.match(client, /customerNotes/);
  assert.match(client, /Packed carefully/);
  assert.match(client, /Sleeved Boosters/);
  assert.match(client, /Product Details/);
  assert.match(client, /What&apos;s included/);
  assert.match(client, /Shipping summary/);
  assert.match(client, /Checkout hold/);
  assert.doesNotMatch(client, /href="\/app"|href=\{`\/app/);
  assert.match(client, /href: "\/about"/);
  assert.match(client, /href: "\/policies"/);
  assert.match(client, /href: "\/contact"/);
  assert.match(aboutPage, /About GameDayGrabs LLC/);
  assert.match(policiesPage, /Store Policies/);
  assert.match(policiesPage, /variant="policies-support"/);
  assert.match(policiesPage, /Contact/);
  assert.match(contactPage, /Contact/);
  assert.match(contactPage, /variant="contact-support"/);
  assert.match(contactPage, /StorefrontContactForm/);
});

test("GameDayGrabs About and Policies pages use current customer policy copy", () => {
  const aboutPage = fs.readFileSync(new URL("../src/app/about/page.tsx", import.meta.url), "utf8");
  const policiesPage = fs.readFileSync(new URL("../src/app/policies/page.tsx", import.meta.url), "utf8");
  const routing = fs.readFileSync(new URL("../src/lib/storefront-routing.ts", import.meta.url), "utf8");
  const combined = `${aboutPage}\n${policiesPage}`;

  assert.match(aboutPage, /About GameDayGrabs/);
  assert.match(aboutPage, /Built for Pokemon collectors/);
  assert.match(aboutPage, /accurate listings, real inventory/);
  assert.match(aboutPage, /secure checkout, local pickup when available, and careful packaging/);
  assert.match(aboutPage, /sealed Pokemon TCG products and collectible card products/);
  assert.match(aboutPage, /Email \$\{contactEmail\} for help with an order or product question/);

  assert.match(policiesPage, /Shipping Policy/);
  assert.match(policiesPage, /Shipping is calculated from product weight and package size/);
  assert.match(policiesPage, /Final shipping is shown before payment/);
  assert.match(policiesPage, /Local Pickup Policy/);
  assert.match(policiesPage, /Local pickup is only available when shown at checkout/);
  assert.match(policiesPage, /Cancellations \/ Refunds/);
  assert.match(policiesPage, /Approved refunds are processed back to the original payment method/);
  assert.match(policiesPage, /3-10 business days after approval/);
  assert.match(policiesPage, /Trading Card Return Policy/);
  assert.match(policiesPage, /All sealed trading card products/);
  assert.match(policiesPage, /are final sale and are not\s+eligible for return or exchange/);
  assert.match(policiesPage, /buyer-remorse returns/);
  assert.match(policiesPage, /opened product returns/);
  assert.match(policiesPage, /or exchanges\s+for sealed trading card items/);
  assert.match(policiesPage, /Order Issue Exceptions/);
  assert.match(policiesPage, /damaged, incorrect, missing an item, or materially different/);
  assert.match(policiesPage, /within 3 calendar days of delivery/);
  assert.match(policiesPage, /photos of the package/);
  assert.match(policiesPage, /photos of the product condition/);
  assert.match(policiesPage, /photos of the shipping label/);
  assert.match(policiesPage, /replacement, refund, partial refund, or another resolution/);
  assert.match(policiesPage, /Opened Products/);
  assert.match(policiesPage, /not eligible for return, refund, or exchange/);
  assert.match(policiesPage, /tampering, missing contents, suspected abuse/);
  assert.match(policiesPage, /Return Shipping/);
  assert.match(policiesPage, /Approved returns must be returned in the condition received/);
  assert.match(policiesPage, /Payment Security/);
  assert.match(policiesPage, /Stripe securely handles payment/);
  assert.match(policiesPage, /GameDayGrabs does not store card numbers or CVC/);
  assert.match(policiesPage, /Inventory \/ Checkout Holds/);
  assert.match(policiesPage, /Checkout holds items for 15 minutes while payment is completed/);
  assert.match(policiesPage, /Abandoned or expired checkout sessions release the hold/);
  assert.match(policiesPage, /Inventory is finalized only after successful payment/);
  assert.match(policiesPage, /GameDayGrabs Rewards/);
  assert.match(policiesPage, /No account required to checkout/);
  assert.match(policiesPage, /Customer accounts are optional/);
  assert.match(policiesPage, /guest checkout remains available/);
  assert.match(policiesPage, /Earn points on eligible purchases/);
  assert.match(policiesPage, /Points are awarded after payment is confirmed/);
  assert.match(policiesPage, /Shipping, taxes, refunds, discounts, canceled orders, and test\/smoke orders do not earn points/);
  assert.match(policiesPage, /Refunded or canceled orders can reverse points/);
  assert.match(policiesPage, /Rewards redemption coming soon/);
  assert.match(policiesPage, /Redemption is not currently available/);
  assert.match(policiesPage, /points cannot be used at checkout yet/);
  assert.match(policiesPage, /Points have no cash value/);
  assert.match(policiesPage, /GameDayGrabs may adjust or reverse points for fraud, abuse, refunds, cancellations, or errors/);
  assert.doesNotMatch(policiesPage, /Redeem Now|Apply points|Use points at checkout|points have cash value|cash equivalent/i);
  assert.match(policiesPage, /Product Availability \/ Preorders/);
  assert.match(policiesPage, /If a product is sold out, checkout is blocked/);
  assert.match(policiesPage, /Privacy \/ Customer Information/);
  assert.match(policiesPage, /Trademark Notice/);
  assert.match(policiesPage, /GameDayGrabs is not affiliated with The Pokemon Company International/);
  assert.match(policiesPage, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
  assert.match(policiesPage, /mailto:\$\{contactEmail\}/);
  assert.match(routing, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL = "gamedaygrabs@outlook\.com"/);

  assert.doesNotMatch(policiesPage, /Default shipping|defaultShippingPrice|flat shipping|flat \$5|\$5\.00/i);
  assert.doesNotMatch(policiesPage, /eBay feedback|feedback screenshots|feedback links|Customer Feedback|reviews from eBay/i);
  assert.doesNotMatch(policiesPage, /aggregateRating|ratingValue|reviewCount|fake review/i);
  assert.doesNotMatch(combined, /payment_method_details|payment_method_data|card_number|cardNumber|cvv|JSON\.stringify|raw Stripe object/i);
  assert.doesNotMatch(combined, /same[- ]day shipping|same[- ]day delivery/i);
  assert.doesNotMatch(combined, /official Pokemon partner|officially affiliated|authorized by The Pokemon Company/i);
});

test("GameDayGrabs marketplace feedback section uses curated safe social proof", () => {
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const aboutPage = fs.readFileSync(new URL("../src/app/about/page.tsx", import.meta.url), "utf8");
  const feedback = fs.readFileSync(new URL("../src/lib/storefront-feedback.ts", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const componentStart = client.indexOf("export function MarketplaceFeedbackSection");
  const componentEnd = client.indexOf("export function StorefrontContactForm");
  assert.notEqual(componentStart, -1);
  assert.notEqual(componentEnd, -1);
  const feedbackComponent = client.slice(componentStart, componentEnd);
  const feedbackIndex = client.indexOf("<MarketplaceFeedbackSection />");
  const shopByCategoryIndex = client.indexOf("<h2>Shop By Category</h2>");
  const trustSectionIndex = client.indexOf("<HomepageSupportStrip />");

  assert.notEqual(feedbackIndex, -1);
  assert.notEqual(shopByCategoryIndex, -1);
  assert.notEqual(trustSectionIndex, -1);
  assert.ok(shopByCategoryIndex < trustSectionIndex);
  assert.ok(trustSectionIndex < feedbackIndex);
  assert.match(aboutPage, /MarketplaceFeedbackSection, StorefrontFooter, StorefrontHeader/);
  assert.match(aboutPage, /<MarketplaceFeedbackSection variant="about" \/>/);

  assert.match(feedback, /GAMEDAYGRABS_EBAY_FEEDBACK_URL = "https:\/\/feedback\.ebay\.com\/fdbk\/feedback_profile\/gamedaygrabs_llc"/);
  assert.match(feedback, /Trusted by collectors/);
  assert.match(feedback, /Marketplace feedback/);
  assert.match(feedback, /Carefully packed/);
  assert.match(feedback, /Fast shipping/);
  assert.match(feedback, /Accurate listings/);
  assert.match(feedback, /Marketplace feedback/);
  assert.match(feedback, /Source: eBay seller feedback/);
  assert.match(feedback, /Marketplace buyer/);
  assert.match(feedback, /View verified eBay feedback/);
  assert.match(feedback, /GameDayGrabs is not affiliated with, endorsed by, or sponsored by eBay/);
  assert.match(feedback, /Great seller! Well packaged, quick shipping! I wouldn't hesitate to purchase from seller again!/);
  assert.match(feedback, /Condition and quality as described\. Beautiful card\. Very prompt shipping\. Would buy from again\./);
  assert.match(feedback, /Fast shipping, product as described\. Would do business again\./);
  assert.match(feedback, /Quick shipper! Perfectly packaged!/);
  assert.match(feedback, /Thank you for the fast shipping and the great packaging\. Items came as described and the value was great\./);
  assert.match(feedback, /The packaging was of good quality and wrapped well\. Condition of the box was great\./);

  assert.match(feedbackComponent, /storefrontFeedback\.snippets\.slice\(0, 3\)/);
  assert.match(feedbackComponent, /href=\{GAMEDAYGRABS_EBAY_FEEDBACK_URL\}/);
  assert.match(feedbackComponent, /target="_blank"/);
  assert.match(feedbackComponent, /rel="noopener noreferrer"/);
  assert.match(css, /gdg-feedback-panel/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);

  assert.doesNotMatch(feedback + feedbackComponent, /eBayLogo|ebay-logo|logo.*eBay|screenshot|feedback screenshot/i);
  assert.doesNotMatch(feedback + feedbackComponent, /scrape|crawler|auto-import|fetch\(|seller score|feedback percentage|feedbackPercent|sellerScore|positive feedback/i);
  assert.doesNotMatch(feedback, /buyerName|username|order number|address|private message|item id|itemId|\$\d/i);
  assert.doesNotMatch(feedback + feedbackComponent, /endorsed by eBay[^.]|sponsored by eBay[^.]|owned by eBay|verified seller/i);
  assert.doesNotMatch(feedback + feedbackComponent, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe object/i);
});

test("Stripe Checkout preparation uses session route, webhook verification, and invoice fallback", () => {
  const env = fs.readFileSync(new URL("../src/lib/env.ts", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const sessionRoute = fs.readFileSync(new URL("../src/app/api/storefront/checkout/session/route.ts", import.meta.url), "utf8");
  const oldCheckoutRoute = fs.readFileSync(new URL("../src/app/api/storefront/checkout/route.ts", import.meta.url), "utf8");
  const webhookRoute = fs.readFileSync(new URL("../src/app/api/storefront/stripe/webhook/route.ts", import.meta.url), "utf8");
  const successPage = fs.readFileSync(new URL("../src/app/checkout/success/page.tsx", import.meta.url), "utf8");

  assert.match(env, /STRIPE_CHECKOUT_ENABLED/);
  assert.match(env, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/);
  assert.match(env, /checkoutSessionReady/);
  assert.match(env, /webhookReady/);
  assert.match(env, /publishableKeyMode/);
  assert.match(env, /secretKeyMode/);
  assert.match(env, /testMode/);
  assert.match(storefront, /storefrontStripeReadiness/);
  assert.match(storefront, /STRIPE_WEBHOOK_SECRET/);
  assert.match(storefront, /webhooks\.constructEvent\(rawBody, signature, secret\)/);
  assert.match(storefront, /checkout\.sessions\.create/);
  assert.match(storefront, /payment_intent_data/);
  assert.match(storefront, /number=\$\{encodeURIComponent\(order\.orderNumber\)\}/);
  assert.match(storefront, /payment_intent\.payment_failed/);
  assert.match(storefront, /checkout\.session\.completed/);
  assert.match(storefront, /checkout\.session\.expired/);
  assert.match(storefront, /releaseOrderReservations/);
  assert.match(storefront, /platform: "website"/);
  assert.match(storefront, /lot\.totalCost \/ lot\.quantity/);
  assert.match(storefront, /paymentEvents: \{ orderBy: \{ receivedAt: "desc" \} \}/);
  assert.match(storefront, /reservations: order\.reservations\.map/);
  assert.match(storefront, /safeStripeEventPayload/);
  assert.match(storefront, /upsertSafePaymentEvent/);
  assert.doesNotMatch(storefront, /payload: rawBody/);
  assert.match(client, /\/api\/storefront\/checkout\/session/);
  assert.match(client, /\/api\/storefront\/invoice-request/);
  assert.match(client, /gdg-order-reference/);
  assert.match(successPage, /searchParams/);
  assert.match(successPage, /orderReference/);
  assert.match(app, /Stripe is configured in test mode/);
  assert.match(app, /Stripe Live Mode Readiness/);
  assert.match(app, /Estimated Stripe fee/);
  assert.match(app, /checkout\.session\.completed is stored in Admin Orders/);
  assert.match(sessionRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.match(oldCheckoutRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.match(webhookRoute, /const rawBody = await request\.text\(\)/);
  assert.match(webhookRoute, /request\.headers\.get\("stripe-signature"\)/);
  assert.match(webhookRoute, /handleStripeWebhook/);
});

test("storefront availability and purchase limits stay buyer-facing", () => {
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../prisma/migrations/20260615103000_storefront_purchase_limits/migration.sql", import.meta.url), "utf8");

  assert.equal(storefrontAvailabilityLabel({ availabilityLevel: "in_stock", status: "active" }), "In Stock");
  assert.equal(storefrontAvailabilityLabel({ availabilityLevel: "low_stock", status: "active" }), "Low Stock");
  assert.equal(storefrontAvailabilityLabel({ availabilityLevel: "almost_gone", status: "active" }), "Almost gone");
  assert.equal(storefrontAvailabilityLabel({ availabilityLevel: "sold_out", status: "sold_out" }), "Sold Out");
  assert.equal(storefrontPurchaseLimitLabel({ maxQuantityPerOrder: null }), null);
  assert.equal(storefrontPurchaseLimitLabel({ maxQuantityPerOrder: 1 }), "Limit 1 per order");
  assert.equal(storefrontPurchaseLimitLabel({ maxQuantityPerOrder: 2 }), "Maximum 2 per order");
  assert.equal(storefrontConfiguredPurchaseLimit({ maxQuantityPerOrder: 1, purchaseLimitEnabled: false }), 1);
  assert.equal(storefrontConfiguredPurchaseLimit({ maxQuantityPerOrder: 4, purchaseLimitEnabled: false }), null);
  assert.equal(storefrontConfiguredPurchaseLimit({ maxQuantityPerOrder: 1, purchaseLimitEnabled: true }), 1);
  assert.equal(storefrontEffectiveMaxQuantity({ publicMaxQuantity: 4, maxQuantityPerOrder: null }), 4);
  assert.equal(storefrontEffectiveMaxQuantity({ publicMaxQuantity: 4, maxQuantityPerOrder: 2 }), 2);
  assert.equal(storefrontEffectiveMaxQuantity({ publicMaxQuantity: 1, maxQuantityPerOrder: 4 }), 1);

  assert.doesNotMatch(client, /Stock visible now|visible stock|stock visible|\$\{product\.(?:availableQuantity|publicMaxQuantity)\} available|Only \$\{product\.(?:availableQuantity|publicMaxQuantity)\}/i);
  assert.match(client, /storefrontAvailabilityLabel\(product\)/);
  assert.match(client, /storefrontAvailabilityDetail\(product\)/);
  assert.match(client, /storefrontPurchaseLimitLabel\(product\)/);
  assert.match(client, /Limit reached for this item\./);
  assert.match(client, /disabled=\{isSoldOut \|\| quantity >= effectiveMaxQuantity\}/);
  assert.match(client, /storefrontEffectiveMaxQuantity\(product\)/);
  assert.match(storefront, /maxQuantityPerOrder: storefrontConfiguredPurchaseLimit\(item\)/);
  assert.match(storefront, /const effectiveMaxQuantity = storefrontEffectiveMaxQuantity\(\{ \.\.\.product, publicMaxQuantity: rawAvailableQuantity \}\)/);
  assert.match(storefront, /if \(strict && requestedQuantity > effectiveMaxQuantity\)/);
  assert.match(storefront, /Purchase limit reached for \$\{product\.title\}/);
  assert.match(app, /Enable purchase limit/);
  assert.match(app, /label="Max quantity per order"/);
  assert.match(app, /Entering a max quantity enables the limit; leave blank and disabled for no limit\./);
  assert.match(app, /DetailStat label="On hand"/);
  assert.match(schema, /purchaseLimitEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(migration, /ADD COLUMN "purchaseLimitEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(client, /per person/i);
  assert.doesNotMatch(client, /payment_method_details|payment_method_data|card_number|cardNumber|cvv|raw Stripe object/i);
});

test("GameDayGrabs cart checkout is polished while preserving server-side guards", () => {
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const cartRoute = fs.readFileSync(new URL("../src/app/api/storefront/cart/route.ts", import.meta.url), "utf8");
  const sessionRoute = fs.readFileSync(new URL("../src/app/api/storefront/checkout/session/route.ts", import.meta.url), "utf8");
  const invoiceRoute = fs.readFileSync(new URL("../src/app/api/storefront/invoice-request/route.ts", import.meta.url), "utf8");

  assert.match(client, /Review your cart/);
  assert.match(client, /Confirm your items, choose shipping or pickup, then continue to secure checkout\./);
  assert.match(client, /Secure Checkout/);
  assert.match(client, /Fast Shipping/);
  assert.match(client, /Carefully Packaged/);
  assert.match(client, /100% Authentic/);
  assert.match(client, /Proceed to Secure Checkout/);
  assert.match(client, /Powered by Stripe/);
  assert.match(client, /Shipping calculated at checkout/);
  assert.match(client, /Secure checkout by Stripe\. Guest checkout available\./);
  assert.match(client, /<details className="gdg-checkout-notes">/);
  assert.match(client, /<summary>Checkout notes<\/summary>/);
  assert.match(client, /Shipping is calculated by ZIP before payment\./);
  assert.match(client, /Items are reserved when checkout starts\./);
  assert.match(client, /Guest checkout is available\./);
  assert.match(client, /Create an account/);
  assert.match(client, /Your items are held for 15 minutes while you complete checkout\./);
  assert.ok(client.indexOf("gdg-checkout-button") > -1, "checkout button should render");
  assert.ok(client.indexOf("gdg-checkout-notes") > client.indexOf("gdg-checkout-button"), "checkout notes should render after checkout button");
  assert.match(client, /Request Invoice/);
  assert.match(client, /No card is charged today/);
  assert.doesNotMatch(client, /PaymentNetworkBadges/);
  assert.doesNotMatch(client, /Cards accepted securely through Stripe\./);
  assert.doesNotMatch(client, /Visa accepted|Mastercard accepted|American Express accepted|Discover accepted/);
  assert.doesNotMatch(client, /className="gdg-payment-badges"|className="gdg-payment-badge"/);
  assert.doesNotMatch(client, />\s*VISA\s*<|>\s*Mastercard\s*<|>\s*AMEX\s*<|>\s*Discover\s*</);
  assert.match(client, /isStripeCheckout/);
  assert.match(client, /gdg-invoice-form-card/);
  assert.match(client, /requestPayload/);
  assert.match(client, /if \(customerEmail\.trim\(\)\) requestPayload\.customerEmail/);
  assert.match(client, /variant="empty-cart"/);
  assert.match(client, /gdg-cart-grabby-card/);
  assert.match(client, /className="gdg-cart-grabby-tip"/);
  assert.match(client, /className="gdg-usps-quote-controls"/);
  assert.match(client, /className="gdg-cart-grabby-mark"/);
  assert.match(client, /className="gdg-cart-grabby-copy"/);
  assert.match(client, /<strong>Grabby tip<\/strong>/);
  assert.match(client, /Enter your ZIP to see USPS shipping\./);
  assert.doesNotMatch(client, /variant="shipping"\s+title="Grabby tip"/);
  assert.match(client, /Guest checkout stays available when you are ready to buy/);
  assert.match(client, /Shop New Arrivals/);
  assert.match(client, /Shop Pok&eacute;mon/);
  assert.match(client, /Remove sold-out item/);
  assert.match(client, /Remove sold-out items/);
  assert.match(client, /Cart availability changed\./);
  assert.match(client, /Remove sold-out items or update changed quantities before checkout\./);
  assert.match(client, /Remove this sold-out item to continue checkout\./);
  assert.match(client, /Quantity updated because availability or purchase limits changed/);
  assert.match(client, /cartHasBlockingStockIssue/);
  assert.match(client, /return products\.some\(\(product\) => isSoldOutProduct\(product\) \|\| product\.publicMaxQuantity <= 0 \|\| product\.requestedQuantity > storefrontEffectiveMaxQuantity\(product\)\)/);
  assert.match(client, /checkoutDisabled/);
  assert.match(client, /quoteRequired && \(!shippingQuote \|\| quoteExpired\)/);
  assert.match(client, /const missingShippingQuote = quoteRequired && fulfillmentMethod === "shipping" && !hasBlockingStockIssue && \(!shippingQuote \|\| quoteExpired\)/);
  assert.match(client, /missingShippingQuote \?/);
  assert.match(client, /gdg-shipping-required-warning/);
  assert.match(client, /Enter ZIP for USPS shipping, or choose Local Pickup if available\./);
  assert.match(client, /quoteBusy/);
  assert.match(client, /Enter ZIP code to calculate USPS shipping\./);
  assert.match(client, /shippingQuoteToken/);
  assert.match(client, /setProducts\(products\.filter\(\(product\) => !blockedIds\.has\(product\.id\)\)\)/);
  assert.match(client, /disabled=\{product\.publicMaxQuantity <= 0 \|\| product\.requestedQuantity >= maxQuantity\}/);
  assert.match(client, /\/api\/storefront\/checkout\/session/);
  assert.match(client, /\/api\/storefront\/invoice-request/);
  assert.doesNotMatch(client, /Card Element|payment_method_details|payment_method_data|card_number|cardNumber|cvv|cost basis|supplier notes|admin notes/i);
  assert.doesNotMatch(client, /https?:\/\/[^"']*(visa|mastercard|amex|americanexpress|discover|stripe)[^"']*/i);

  assert.match(css, /gdg-checkout-trust-row/);
  assert.match(css, /gdg-checkout-panel/);
  assert.match(css, /gdg-invoice-form-card/);
  assert.match(css, /gdg-cart-line-price/);
  assert.match(css, /--gdg-gold: #d4af37/);
  assert.match(css, /background:\s*\n\s*linear-gradient\(135deg, #050505 0%, #111111 48%, #5d3b00 100%\)/);
  assert.match(css, /gdg-checkout-trust-line/);
  assert.match(css, /gdg-checkout-notes/);
  assert.match(css, /gdg-usps-quote-controls/);
  assert.doesNotMatch(css, /gdg-usps-quote-form > div/);
  assert.match(css, /gdg-usps-quote-form input::placeholder/);
  assert.match(css, /font-size: 0\.82rem/);
  assert.match(css, /gdg-shipping-required-warning/);
  assert.match(css, /gdg-cart-grabby-mark/);
  assert.match(css, /gdg-cart-grabby-mark::before/);
  assert.match(css, /gdg-cart-grabby-copy/);
  assert.match(css, /gdg-cart-stock-warning-copy/);
  assert.match(css, /gdg-stock-remove-button/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /gdg-free-shipping|gdg-checkout-trust-copy|gdg-shipping-checkout-note/);
  assert.doesNotMatch(css, /gdg-payment-trust-card|gdg-payment-badges|gdg-payment-badge/);
  assert.doesNotMatch(css, /gdg-payment-icons svg|gdg-payment-icons \.visa|gdg-payment-icons \.mastercard|gdg-payment-icons \.amex|gdg-payment-icons \.discover/);
  assert.doesNotMatch(css, /background: linear-gradient\(135deg, #5b21b6, #9333ea\)/);
  assert.doesNotMatch(css, /gdg-payment-icons span \{\s*display: inline-flex;\s*min-width: 38px/s);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 360px\)/);

  assert.match(cartRoute, /getCartProducts\(input\.items, \{ strict: false \}\)/);
  assert.match(sessionRoute, /createCheckoutSession\(input, \{ requestUrl: request\.url \}\)/);
  assert.match(invoiceRoute, /createInvoiceRequest\(input\)/);
  assert.match(storefront, /export async function getCartProducts\(\s*items: Array<\{ id: string; quantity: number \}>,\s*options: \{ strict\?: boolean; profileDefinitions\?: Record<string, ShippingProfileDefinition> \} = \{\}\s*\)/);
  assert.match(storefront, /const strict = options\.strict \?\? true/);
  assert.match(storefront, /if \(strict && product\.status !== "active"\)/);
  assert.match(storefront, /const rawAvailableQuantity = sellableQuantity\(item\)/);
  assert.match(storefront, /if \(strict && requestedQuantity > rawAvailableQuantity\)/);
  assert.match(storefront, /if \(strict && requestedQuantity > effectiveMaxQuantity\)/);
  assert.match(storefront, /unit_amount: Math\.round\(item\.unitPrice \* 100\)/);
  assert.match(storefront, /customer_email: input\.customerEmail/);
  assert.match(storefront, /customer_creation: "always"/);
  assert.match(storefront, /phone_number_collection: \{ enabled: true \}/);
  assert.match(storefront, /billing_address_collection: "auto"/);
  assert.match(storefront, /const stripeShippingAllowedCountries = \["US"\]/);
  assert.match(storefront, /shipping_address_collection: \{\s*allowed_countries: stripeShippingAllowedCountries\s*\}/);
  assert.match(storefront, /shipping_options: checkoutShippingOptions/);
  assert.doesNotMatch(storefront, /product_data: \{ name: "Shipping" \}/);
  assert.doesNotMatch(storefront, /shipping_address_collection:\s*\n\s*input\.fulfillmentMethod/);
  assert.doesNotMatch(storefront, /payment_method_data|card_number|cvc|cvv/i);
});

test("admin orders dashboard and fulfillment center surface Stripe and invoice events", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../prisma/migrations/20260613110511_checkout_customer_records/migration.sql", import.meta.url), "utf8");
  const sqliteInit = fs.readFileSync(new URL("../prisma/init-sqlite.ts", import.meta.url), "utf8");
  const ordersRoute = fs.readFileSync(new URL("../src/app/api/radar/storefront/orders/route.ts", import.meta.url), "utf8");
  const orderUpdateRoute = fs.readFileSync(new URL("../src/app/api/radar/storefront/orders/[orderId]/route.ts", import.meta.url), "utf8");

  assert.match(storefront, /createStorefrontOrderAlert/);
  assert.match(storefront, /title: "New paid order"/);
  assert.match(storefront, /title: "New invoice request"/);
  assert.match(storefront, /paymentStatus === "expired" \? "checkout_expired" : "payment_failed"/);
  assert.match(storefront, /type: "inventory_issue"/);
  assert.match(storefront, /entityType: "STOREFRONT_ORDER"/);
  assert.match(storefront, /actionUrl: "\/\?tab=orders"/);
  assert.match(storefront, /status: "paid"/);
  assert.match(storefront, /fulfillmentStatus: "unfulfilled"/);
  assert.match(storefront, /newPaidOrderCount/);
  assert.match(storefront, /ordersToShipCount/);
  assert.match(storefront, /pickupOrderCount/);
  assert.match(storefront, /NOT: localPickupOrderWhere/);
  assert.match(storefront, /\.\.\.localPickupOrderWhere/);
  assert.match(storefront, /lastWebhookAt/);
  assert.match(storefront, /lastPaidOrderAt/);
  assert.match(storefront, /checkout\.session\.completed/);
  assert.match(storefront, /payment_intent\.payment_failed/);
  assert.match(storefront, /stripeCustomerId/);
  assert.match(storefront, /customerPhone/);
  assert.match(storefront, /shippingLine1/);
  assert.match(storefront, /billingLine1/);
  assert.match(storefront, /session\.payment_status !== "paid"/);
  assert.match(storefront, /skipped: "checkout_session_not_paid"/);
  assert.match(storefront, /const wasPaid = order\.paymentStatus === "paid"/);
  assert.match(storefront, /!wasPaid && order\.paymentStatus !== "paid"/);
  assert.match(storefront, /syncStorefrontCustomerTotals/);
  assert.match(storefront, /totalOrders: paidOrders\.filter\(\(order\) => storefrontOrderNetRevenue\(order\) > 0\)\.length/);
  assert.match(storefront, /totalSpent: paidOrders\.reduce\(\(sum, order\) => sum \+ storefrontOrderNetRevenue\(order\), 0\)/);
  assert.match(storefront, /normalizedCustomerEmail/);
  assert.match(storefront, /customerEmail: normalizedCustomerEmail/);
  assert.match(storefront, /amountTotal: numberValue\(object\.amount_total\)/);
  assert.match(storefront, /currency: stringValue\(object\.currency\)\?\.toLowerCase\(\) \?\? null/);
  assert.match(storefront, /shippingDetails\?\./);
  assert.match(storefront, /billingAddress\?\./);
  assert.doesNotMatch(storefront, /totalOrders: \{ increment: 1 \}/);
  assert.doesNotMatch(storefront, /totalSpent: \{ increment: order\.total \}/);
  assert.doesNotMatch(storefront, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv/i);

  for (const label of ["New Paid Orders", "Pending Payment", "Invoice Requests", "Orders To Ship", "Pickup Orders", "Today's Net Sales", "Store Revenue", "Store Profit"]) {
    assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing dashboard/order card ${label}`);
  }
  for (const tab of ["New", "Pickup Orders", "Pending Payment", "Paid", "Packing", "Shipped", "Invoice Requests", "Canceled / Expired"]) {
    assert.match(app, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing fulfillment tab ${tab}`);
  }
  assert.match(app, /New order received/);
  assert.match(app, /sidebar-nav-badge/);
  assert.match(app, /Fulfillment Center/);
  assert.match(app, /needs-fulfillment/);
  assert.match(app, /Mark Packing/);
  assert.match(app, /Mark Shipped/);
  assert.match(app, /Customer/);
  assert.match(app, /Ship To/);
  assert.match(app, /Payment Summary/);
  assert.match(app, /Profit Summary/);
  assert.match(app, /Shipping Summary/);
  assert.match(app, /Customer Notifications/);
  assert.match(app, /Advanced Details/);
  assert.match(app, /Shipping address/);
  assert.match(app, /Billing address/);
  assert.match(app, /Stripe customer/);
  assert.match(app, /Order history/);
  assert.match(app, /Customer spent/);
  assert.match(app, /Stripe session/);
  assert.match(app, /Payment intent/);
  assert.match(app, /Timeline/);
  assert.match(app, /Cost basis/);
  assert.match(app, /Estimated Stripe fee/);
  assert.match(app, /Webhook active/);
  assert.match(app, /Last webhook received/);
  assert.match(app, /Last paid order/);
  assert.match(app, /Orders to ship/);
  assert.match(app, /Pickup orders/);
  assert.match(app, /New carrier fulfillment/);
  assert.match(app, /Invoice requests pending/);
  assert.match(app, /function formatStorefrontAddressLines/);
  assert.match(app, /return \["Not provided"\]/);
  assert.match(app, /className="storefront-address-lines"/);
  assert.match(app, /formatStorefrontAddressLines\(address\)\.map/);
  assert.match(css, /storefront-address-lines \{[\s\S]*display: grid;[\s\S]*gap: 2px;/);

  const orderModal = app.slice(app.indexOf("function StorefrontOrderDetailsModal"), app.indexOf("function DetailStat"));
  const customerSection = orderModal.slice(orderModal.indexOf('<section className="storefront-order-workspace-card storefront-order-customer-card">'), orderModal.indexOf("<h3>Ship To</h3>"));
  const shipToSection = orderModal.slice(orderModal.indexOf("<h3>Ship To</h3>"), orderModal.indexOf("<h3>Items</h3>"));
  const primaryWorkspace = orderModal.slice(orderModal.indexOf('<div className="storefront-order-workspace-grid">'), orderModal.indexOf('<details className="storefront-order-advanced-details">'));
  const advancedDetails = orderModal.slice(orderModal.indexOf('<details className="storefront-order-advanced-details">'));
  assert.match(customerSection, /\{order\.customerEmail \|\| "Not provided"\}/);
  assert.match(customerSection, /\{order\.customerPhone \|\| "Not provided"\}/);
  assert.match(customerSection, /value=\{order\.stripeCustomerId \|\| "Not provided"\}/);
  assert.match(shipToSection, /<StorefrontAddressLines address=\{order\.shippingAddress\} \/>/);
  assert.match(shipToSection, /<StorefrontAddressLines address=\{order\.billingAddress\} \/>/);
  assert.doesNotMatch(customerSection, /Not saved|Not collected|Not stored|formatStorefrontAddress|JSON\.stringify|<pre|<code/);
  assert.doesNotMatch(primaryWorkspace, /Stripe session|Payment intent|Payment Verification|Inventory Reservations/);
  assert.match(advancedDetails, /Stripe session/);
  assert.match(advancedDetails, /Payment intent/);
  assert.match(advancedDetails, /Payment Verification/);
  assert.match(advancedDetails, /Inventory Reservations/);
  assert.doesNotMatch(orderModal, /email not saved/);

  assert.match(types, /isNewPaidOrder: boolean/);
  assert.match(types, /needsFulfillment: boolean/);
  assert.match(types, /sourceLabel: string/);
  assert.match(types, /type StorefrontAddressDTO/);
  assert.match(types, /shippingAddress: StorefrontAddressDTO \| null/);
  assert.match(types, /billingAddress: StorefrontAddressDTO \| null/);
  assert.match(types, /stripeCustomerId: string \| null/);
  assert.match(types, /customerOrderCount: number \| null/);
  assert.match(types, /timeline: Array/);
  assert.match(types, /lastWebhookAt: string \| null/);

  for (const field of ["customerPhone", "shippingLine1", "billingLine1", "firstOrderAt", "lastOrderAt", "totalOrders", "totalSpent", "defaultShippingLine1"]) {
    assert.match(schema, new RegExp(field), `missing schema field ${field}`);
    assert.match(migration, new RegExp(field), `missing migration field ${field}`);
    assert.match(sqliteInit, new RegExp(field), `missing sqlite init field ${field}`);
  }
  assert.match(schema, /stripeCheckoutSessionId\s+String\?\s+@unique/);
  assert.match(schema, /email\s+String\s+@unique/);
  assert.match(schema, /stripeCustomerId\s+String\?/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "StorefrontOrder_stripeCheckoutSessionId_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_eventId_key"/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE .* DROP/i);

  assert.match(ordersRoute, /requireUser/);
  assert.match(orderUpdateRoute, /requireUser/);
  assert.match(orderUpdateRoute, /orderFulfillmentUpdateSchema/);
  assert.match(orderUpdateRoute, /storefront\.order\.updated/);
});

test("GameDayGrabs custom domain routes public storefront without exposing private root", () => {
  const rootPage = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const routing = fs.readFileSync(new URL("../src/lib/storefront-routing.ts", import.meta.url), "utf8");
  const appAlias = fs.readFileSync(new URL("../src/app/app/page.tsx", import.meta.url), "utf8");
  const adminAlias = fs.readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
  const dashboardAlias = fs.readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  const productAlias = fs.readFileSync(new URL("../src/app/product/[slug]/page.tsx", import.meta.url), "utf8");
  const shopCartAlias = fs.readFileSync(new URL("../src/app/shop/cart/page.tsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const domainDocs = fs.readFileSync(new URL("../docs/gamedaygrabs-domain-setup.txt", import.meta.url), "utf8");

  assert.match(routing, /gamedaygrabs\.com/);
  assert.match(routing, /www\.gamedaygrabs\.com/);
  assert.match(routing, /isGameDayGrabsHost/);
  assert.match(rootPage, /headers/);
  assert.match(rootPage, /StorefrontHomeView/);
  assert.match(rootPage, /RadarApp/);
  assert.match(rootPage, /GameDayGrabs LLC \| Sealed Pokemon TCG & Collectible Card Products/);
  assert.match(productAlias, /StorefrontProductView/);
  assert.match(shopCartAlias, /redirect\("\/cart"\)/);
  for (const privateAlias of [appAlias, adminAlias, dashboardAlias]) {
    assert.match(privateAlias, /RadarApp/);
  }
  assert.match(app, /Storefront Status/);
  assert.match(app, /gamedaygrabs\.com/);
  assert.match(app, /Current public URL/);
  assert.match(app, /Intended domain/);
  assert.match(app, /Domain connected/);
  assert.match(app, /Contact email visible/);
  assert.match(app, /Custom domain connected/);
  assert.match(app, /Storefront root works/);
  assert.match(app, /Shop page works/);
  assert.match(app, /About page works/);
  assert.match(app, /Request Invoice \/ cart works/);
  assert.match(app, /No private data exposed/);
  assert.match(app, /Needs Work/);
  assert.match(app, /SSL active/);
  assert.match(app, /Manual check pending/);
  assert.match(domainDocs, /Do not add gamedaygrabs\.com or www\.gamedaygrabs\.com to Harbor Command/);
  assert.match(domainDocs, /Settings -> Domains/);
  assert.match(domainDocs, /gamedaygrabs@outlook\.com/);
  assert.match(domainDocs, /Public Data Safety/);
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
  assert.match(serviceWorker, /poke-radar-sw-2026-06-12-login-recovery-v1/);
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

test("admin shipping hub is a top-level navigation tab with overview sections", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));

  assert.match(app, /\| "shipping"/);
  assert.match(app, /\{ id: "shipping", label: "Shipping", icon: Navigation, section: "inventory" \}/);
  assert.match(app, /activeTab === "shipping"/);
  assert.match(app, /<ShippingHubPanel/);
  assert.match(shippingHub, /Shipping Hub/);
  assert.match(shippingHub, /Shipping Overview/);
  for (const label of [
    "Orders To Ship",
    "Packing",
    "Shipped Today",
    "Missing Shipping Data",
    "Using Fallback Shipping",
    "Average Shipping Charged",
    "Shipping Revenue",
    "Local Pickup",
    "Calculated USPS",
    "Shippo configured",
    "Fallback shipping",
    "Shippo labels",
    "Label provider configured"
  ]) {
    assert.match(shippingHub, new RegExp(label), `missing shipping overview card ${label}`);
  }
});

test("shipping hub keeps carrier work separate from local pickup and archived orders", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));
  const canShip = app.slice(app.indexOf("function storefrontOrderCanShip"), app.indexOf("function storefrontOrderCanPickup"));

  assert.match(canShip, /storefrontOrderCanFulfill\(order\) && !storefrontOrderIsLocalPickup\(order\)/);
  assert.match(shippingHub, /const businessStorefrontOrders = dashboard\.storefrontOrders\.filter\(\(order\) => !order\.isTestOrder\)/);
  assert.match(shippingHub, /const carrierOrdersToShip = businessStorefrontOrders\.filter\(storefrontOrderCanShip\)/);
  assert.match(shippingHub, /Local Pickup and archived orders are excluded\./);
  assert.match(shippingHub, /storefrontOrderIsCanceledOrRefunded/);
  assert.match(shippingHub, /shipping-packing-items/);
  assert.match(shippingHub, /shipping-packing-checklist/);
  assert.match(shippingHub, /shippingHubPackingChecklist/);
  assert.match(app, /Pull item/);
  assert.match(app, /Check condition/);
  assert.match(app, /Sleeve\/protect if applicable/);
  assert.match(app, /Add tracking/);
  assert.match(shippingHub, /shippingHubOrderDestination\(order\)/);
  assert.match(shippingHub, /Order age \{timerState\.shortLabel\}/);
  assert.match(shippingHub, /formatShippingPackageWeight\(order\)/);
  assert.match(shippingHub, /formatShippingPackageProfile\(order\)/);
  assert.match(shippingHub, /formatShippingPackageDimensions\(order\)/);
  assert.match(shippingHub, /Copy Address/);
  assert.match(shippingHub, /shippingHubOrderAddressText\(order\)/);
  assert.match(shippingHub, /Copy Order #/);
  assert.match(shippingHub, /Print Packing Slip/);
  assert.match(shippingHub, /setPrintPackingSlipOrderId\(order\.id\)/);
  assert.match(shippingHub, /Open Order/);
  assert.match(shippingHub, /Add Tracking/);
  assert.match(shippingHub, /Mark Shipped/);
  assert.match(shippingHub, /Enter carrier and tracking in order detail first\./);
  assert.match(shippingHub, /formatShippingCarrierService\(order\)/);
  assert.match(shippingHub, /Quoted ZIP/);
  assert.match(shippingHub, /shippingQuoteStatusBadges\(order\)/);
  assert.match(shippingHub, /shipping-label-status-shell/);
  assert.match(app, /Label purchase disabled\. Enable Shippo labels after live shipping test\./);
  assert.match(shippingHub, /Buy Label/);
  assert.match(shippingHub, /disabled=\{busy \|\| !labelEligibility\.enabled\}/);
  assert.match(shippingHub, /storefrontOrderLabelEligibility\(order, dashboard\.health\)/);
});

test("shipping hub tracking section shows shipped carrier orders and copy actions", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));

  assert.match(shippingHub, /Tracking \/ Shipped Orders/);
  assert.match(shippingHub, /fulfillmentStatus === "shipped"/);
  assert.match(shippingHub, /!storefrontOrderIsLocalPickup\(order\)/);
  assert.match(shippingHub, /storefrontOrderPreferredTrackingNumber\(order\)/);
  assert.match(shippingHub, /storefrontOrderPreferredTrackingUrl\(order\)/);
  assert.match(shippingHub, /Copy tracking/);
  assert.match(shippingHub, /Copy URL/);
  assert.match(shippingHub, /Marked-shipped orders with tracking will appear here\./);
});

test("shipping hub surfaces missing shipping data and merchant readiness", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));

  assert.match(app, /function shippingHubMissingProducts/);
  assert.match(app, /inventoryShippingProfileComplete/);
  assert.match(app, /inventoryUsesFallbackShipping/);
  assert.match(app, /inventoryMissingShippingWeight/);
  assert.match(app, /inventoryMissingShippingDimensions/);
  assert.match(shippingHub, /Missing Shipping Data/);
  assert.match(shippingHub, /Edit Product Shipping/);
  assert.match(shippingHub, /shipping-missing-main/);
  assert.match(shippingHub, /shipping-missing-badges/);
  assert.match(shippingHub, /shipping-missing-actions/);
  assert.match(shippingHub, /Google \/ Merchant Readiness/);
  assert.match(shippingHub, /Feed items missing brand/);
  assert.match(shippingHub, /Feed items missing product type\/category/);
  assert.match(shippingHub, /Feed ready/);
  assert.match(shippingHub, /shippingHubMerchantBrand\(item\)/);
  assert.match(shippingHub, /shippingHubMerchantProductType\(item\)/);
  assert.match(shippingHub, /Products missing packed weight/);
  assert.match(shippingHub, /Products missing dimensions/);
  assert.match(shippingHub, /Ready for Standard Shipping/);
  assert.match(shippingHub, /dashboard\.health\?\.providers\.shippingRates\.calculatedUspsEnabled/);
  assert.match(shippingHub, /dashboard\.health\?\.providers\.shippingRates\.shippoConfigured/);
  assert.match(shippingHub, /dashboard\.health\?\.providers\.shippingRates\.fallbackEnabled/);
  assert.match(shippingHub, /dashboard\.health\?\.providers\.shippingLabels\.shippoLabelPurchaseEnabled/);
  assert.match(shippingHub, /dashboard\.health\?\.providers\.shippingLabels\.labelProviderConfigured/);
  assert.match(css, /\.shipping-missing-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(320px, 1fr\) minmax\(280px, 0\.8fr\) auto;/);
  assert.match(css, /\.shipping-missing-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
});

test("shipping hub and order detail show calculated quote and label review fields without provider payloads", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const env = fs.readFileSync(new URL("../src/lib/env.ts", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const detail = app.slice(app.indexOf("function StorefrontOrderDetailsModal"), app.indexOf("function CancelRefundModal"));
  const healthPanel = app.slice(app.indexOf("function AdminHealthPanel"), app.indexOf("function NotificationSettingsPanel"));

  assert.match(detail, /Carrier \/ service/);
  assert.match(detail, /Quoted amount/);
  assert.match(detail, /Quoted ZIP/);
  assert.match(detail, /Rate provider/);
  assert.match(detail, /Fallback used/);
  assert.match(detail, /ZIP review/);
  assert.match(detail, /Shipping ZIP differs from quoted ZIP/);
  assert.match(detail, /Label &amp; Tracking/);
  assert.match(detail, /No shipping label purchased yet\./);
  assert.match(detail, /Shippo label purchase is disabled\./);
  assert.match(detail, /storefrontOrderPreferredTrackingNumber\(order\)/);
  assert.match(detail, /storefrontOrderPreferredTrackingUrl\(order\)/);
  assert.match(app, /Fallback shipping used/);
  assert.match(app, /ZIP review needed/);
  assert.match(app, /function storefrontOrderLabelEligibility/);
  assert.match(app, /storefrontOrderIsLocalPickup\(order\)/);
  assert.match(app, /storefrontOrderIsCanceledOrRefunded\(order\)/);
  assert.match(app, /storefrontOrderHasShipToAddress\(order\)/);
  assert.match(app, /storefrontOrderHasPackageSnapshot\(order\)/);
  assert.match(healthPanel, /Calculated USPS/);
  assert.match(healthPanel, /Shippo Labels/);
  assert.match(healthPanel, /health\.providers\.shippingRates\.provider/);
  assert.match(healthPanel, /health\.providers\.shippingLabels\.shippoLabelPurchaseEnabled/);
  assert.match(healthPanel, /health\.providers\.shippingLabels\.labelProviderConfigured/);
  assert.match(env, /shippingRates:/);
  assert.match(env, /shippingLabels:/);
  assert.match(types, /shippingRates: ProviderHealthMetadataDTO/);
  assert.match(types, /shippingLabels: ProviderHealthMetadataDTO/);
  assert.doesNotMatch(detail + healthPanel, /shippingQuoteRateProviderRef|shippingQuoteShipmentProviderRef|SHIPPO_API_TOKEN|DATABASE_URL|STRIPE_SECRET_KEY/);
});

test("shipping label shell is an additive disabled workflow without purchase API wiring", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../prisma/migrations/20260623024500_shipping_label_shell/migration.sql", import.meta.url), "utf8");
  const labelConfig = fs.readFileSync(new URL("../src/lib/shipping-labels.ts", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));

  for (const field of [
    "shippingLabelProvider",
    "shippingLabelProviderId",
    "shippingLabelUrl",
    "shippingLabelFileType",
    "shippingTrackingNumber",
    "shippingTrackingUrl",
    "shippingLabelCostCents",
    "shippingLabelCurrency",
    "shippingLabelPurchasedAt",
    "shippingLabelVoidedAt",
    "shippingLabelStatus"
  ]) {
    assert.match(schema, new RegExp(`${field}\\s+`), `missing schema field ${field}`);
    assert.match(migration, new RegExp(`ADD COLUMN "${field}"`), `missing additive migration field ${field}`);
  }

  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER COLUMN|SET NOT NULL|DELETE FROM|UPDATE /i);
  assert.match(labelConfig, /SHIPPO_LABEL_PURCHASE_ENABLED/);
  assert.match(labelConfig, /SHIPPING_LABELS_ENABLED/);
  assert.match(labelConfig, /defaultValue = false/);
  assert.match(labelConfig, /purchaseReady: shippoLabelPurchaseEnabled && labelProviderConfigured/);
  assert.doesNotMatch(labelConfig, /fetch\(|transactions|label_url|api\.goshippo\.com\/transactions/i);
  assert.match(app, /if \(order\.paymentStatus !== "paid"\) return \{ enabled: false, reason: "Only paid orders can buy labels\." \}/);
  assert.match(app, /if \(storefrontOrderIsLocalPickup\(order\)\) return \{ enabled: false, reason: "Local Pickup orders do not need carrier labels\." \}/);
  assert.match(app, /if \(storefrontOrderIsCanceledOrRefunded\(order\)\) return \{ enabled: false, reason: "Historical orders cannot buy labels\." \}/);
  assert.match(app, /if \(!storefrontOrderHasShipToAddress\(order\)\) return \{ enabled: false, reason: "Ship-to address is required before buying a label\." \}/);
  assert.match(app, /if \(!storefrontOrderHasPackageSnapshot\(order\)\) return \{ enabled: false, reason: "Package weight and dimensions are required before buying a label\." \}/);
  assert.match(app, /Label purchase disabled\. Enable Shippo labels after live shipping test\./);
  assert.match(shippingHub, /window\.alert\("Shippo label purchase is not implemented in this disabled shell\."\)/);
  assert.doesNotMatch(shippingHub, /\/api\/.*label|buyShippingLabel|purchaseLabel|ShippoToken/i);
});

test("shipping profiles are database-backed with an additive migration", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../prisma/migrations/20260618124500_shipping_profiles/migration.sql", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../src/lib/shipping-profiles.ts", import.meta.url), "utf8");
  const radarService = fs.readFileSync(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8");

  assert.match(schema, /model ShippingProfile/);
  assert.match(schema, /key\s+String\s+@unique/);
  assert.match(schema, /active\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /systemDefault\s+Boolean\s+@default\(false\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ShippingProfile"/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE "StorefrontOrder"|ALTER TABLE "InventoryItem"/i);
  assert.match(types, /export type ShippingProfileDTO/);
  assert.match(types, /shippingProfiles: ShippingProfileDTO\[\]/);
  assert.match(service, /ensureDefaultShippingProfiles/);
  assert.match(service, /shippingProfileUsageCounts/);
  assert.match(service, /Profile key cannot be changed while products or historical orders use this profile/);
  assert.match(radarService, /listShippingProfiles\(currentUser\)/);
  assert.match(radarService, /shippingProfiles,/);
});

test("shipping profile APIs are admin-only and do not expose delete semantics", () => {
  const createRoute = fs.readFileSync(new URL("../src/app/api/radar/shipping-profiles/route.ts", import.meta.url), "utf8");
  const updateRoute = fs.readFileSync(new URL("../src/app/api/radar/shipping-profiles/[profileId]/route.ts", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8");

  assert.match(createRoute, /requireAdmin\(user\)/);
  assert.match(createRoute, /export async function GET/);
  assert.match(createRoute, /export async function POST/);
  assert.match(createRoute, /shippingProfileCreateSchema/);
  assert.match(createRoute, /createShippingProfile/);
  assert.match(updateRoute, /requireAdmin\(user\)/);
  assert.match(updateRoute, /export async function PATCH/);
  assert.match(updateRoute, /shippingProfileUpdateSchema/);
  assert.match(updateRoute, /updateShippingProfile/);
  assert.doesNotMatch(createRoute + updateRoute, /export async function DELETE/);
  assert.match(validation, /export const shippingProfileCreateSchema/);
  assert.match(validation, /export const shippingProfileUpdateSchema/);
  assert.match(validation, /defaultWeightOz: requiredPackageWeight/);
});

test("shipping hub profile manager supports create edit deactivate and reactivate", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function ProductShippingEditorModal"));
  const profileEditor = app.slice(app.indexOf("function ShippingProfileEditorModal"), app.indexOf("function StorefrontOrdersPanel"));

  assert.match(shippingHub, /Shipping Profiles Manager/);
  assert.match(shippingHub, /shipping-hub-card shipping-hub-span shipping-profile-manager-card/);
  assert.match(shippingHub, /Create Profile/);
  assert.match(shippingHub, /Edit Profile/);
  assert.match(shippingHub, /Deactivate/);
  assert.match(shippingHub, /Reactivate/);
  assert.match(shippingHub, /dashboard\.shippingProfiles/);
  assert.match(shippingHub, /shipping-profile-identity/);
  assert.match(shippingHub, /shipping-profile-detail-group/);
  assert.match(shippingHub, /shipping-profile-stat-grid/);
  assert.match(shippingHub, /shipping-profile-stat-wide/);
  assert.match(shippingHub, /shipping-profile-control-panel/);
  assert.match(shippingHub, /productsUsingCount/);
  assert.match(shippingHub, /historicalOrdersUsingCount/);
  assert.match(shippingHub, /Inactive profile is still used by existing products or historical orders/);
  assert.match(css, /\.shipping-profile-manager-row\s*\{[\s\S]*grid-template-columns:\s*[\s\S]*minmax\(200px, 1fr\)[\s\S]*minmax\(250px, 1\.15fr\)[\s\S]*minmax\(210px, 0\.85fr\)[\s\S]*minmax\(180px, 0\.75fr\)/);
  assert.match(css, /\.shipping-profile-stat-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(120px, 1fr\)\)/);
  assert.match(css, /\.shipping-profile-stat-wide\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.shipping-profile-manager-row[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(profileEditor, /Create Shipping Profile/);
  assert.match(profileEditor, /Edit Shipping Profile/);
  assert.match(profileEditor, /Changes apply to future checkout estimates only/);
  for (const field of [
    "name",
    "key",
    "packageType",
    "defaultWeightOz",
    "packageLengthIn",
    "packageWidthIn",
    "packageHeightIn",
    "defaultShippingCharge",
    "localPickupEligibleDefault",
    "freeShippingEligibleDefault",
    "requiresBoxDefault",
    "insuranceRecommendedDefault",
    "active"
  ]) {
    assert.match(profileEditor, new RegExp(`name="${field}"`), `missing shipping profile field ${field}`);
  }
  for (const privateField of ["quantityOwned", "quantitySold", "publicPrice", "costBasis", "supplierNotes", "stripeCheckoutSessionId"]) {
    assert.doesNotMatch(profileEditor, new RegExp(`name="${privateField}"`), `profile editor should not submit ${privateField}`);
  }
});

test("shipping product editor saves package metadata without inventory or price mutation controls", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const editor = app.slice(app.indexOf("function ProductShippingEditorModal"), app.indexOf("function StorefrontOrdersPanel"));

  assert.match(editor, /Edit Product Shipping/);
  assert.match(editor, /Quantity, sold count, orders, sales, refunds, and price are preserved\./);
  assert.match(editor, /\/api\/radar\/inventory\/\$\{item\.id\}\/store-listing/);
  for (const field of [
    "shippingProfile",
    "shippingMetadataSource",
    "packageWeightOz",
    "packageLengthIn",
    "packageWidthIn",
    "packageHeightIn",
    "shippingAvailable",
    "localPickupAvailable",
    "freeShippingEligible",
    "requiresBox",
    "insuranceRecommended"
  ]) {
    assert.match(editor, new RegExp(`name="${field}"`), `missing product shipping field ${field}`);
  }
  for (const privateField of ["quantityOwned", "quantitySold", "quantity", "soldCount", "costBasis", "supplier", "stockLots"]) {
    assert.doesNotMatch(editor, new RegExp(`name="${privateField}"`), `shipping editor should not submit ${privateField}`);
  }
  assert.match(editor, /options=\{shippingProfileSelectOptions\(shippingProfiles, item\.shippingProfile\)\}/);
  assert.match(editor, /shippingMetadataDraftFromItem\(item\)/);
  assert.match(editor, /inventoryItemWithShippingDraft\(item, shippingDraft\)/);
  assert.match(editor, /Shipping package details/);
  assert.match(editor, /Used to calculate USPS shipping\. Leave blank to use safe fallback\./);
  assert.match(editor, /Weigh the product as it will be shipped, measure the box or mailer, and enter ounces and inches\./);
  assert.match(editor, /Metadata source/);
  assert.match(editor, /Using profile defaults\./);
  assert.match(editor, /profileDefaultPlaceholder\(selectedShippingProfile, "defaultWeightOz", "oz"\)/);
  assert.match(editor, /profileDefaultPlaceholder\(selectedShippingProfile, "packageLengthIn", "in"\)/);
  assert.match(app, /inactive - existing products only/);
  assert.match(editor, /name="publicPrice" value=\{item\.publicPrice \?\? ""\}/);
  assert.match(editor, /name="storeStatus" value=\{item\.storeStatus\}/);
});

test("checkout shipping uses persisted active profiles while preserving hardcoded fallback", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const shipping = fs.readFileSync(new URL("../src/lib/shipping.ts", import.meta.url), "utf8");
  const profiles = fs.readFileSync(new URL("../src/lib/shipping-profiles.ts", import.meta.url), "utf8");

  assert.match(storefront, /shippingProfileDefinitionsForCheckout/);
  assert.match(storefront, /const \[settings, profileDefinitions\] = await Promise\.all\(\[getStorefrontSettings\(\), shippingProfileDefinitionsForCheckout\(\)\]\)/);
  assert.match(storefront, /fulfillmentMethod: input\.fulfillmentMethod, profileDefinitions/);
  assert.match(shipping, /shippingProfileDefinitionMap\(options\.profileDefinitions \?\? \{\}\)/);
  assert.match(shipping, /normalizeShippingProfile\(item\.shippingProfile, definitions\)/);
  assert.match(shipping, /effectiveShippingPackageData/);
  assert.match(shipping, /normalizeShippingMetadataSource/);
  assert.match(shipping, /packageWeightOz = itemWeight \?\? fallbackWeight \?\? profileWeight/);
  assert.match(shipping, /One or more items need a shipping profile; using a safe package fallback\./);
  assert.match(profiles, /where: \{ active: true \}/);
  assert.match(profiles, /shippingProfileToDefinition/);
});

test("shipping hub avoids payment and private inventory exposure", () => {
  const app = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const shippingHub = app.slice(app.indexOf("function ShippingHubPanel"), app.indexOf("function StorefrontOrdersPanel"));

  for (const forbidden of ["cardNumber", "CVC", "paymentMethodDetails", "rawStripe", "webhookBody", "costBasis", "supplierNotes", "private inventory lots"]) {
    assert.doesNotMatch(shippingHub, new RegExp(forbidden, "i"), `shipping hub should not expose ${forbidden}`);
  }
  assert.doesNotMatch(shippingHub, /stripePaymentIntentId|stripeCheckoutSessionId|stripeRefundId/);
});
