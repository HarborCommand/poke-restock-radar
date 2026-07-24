import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardDateRange,
  dashboardTopSellingProducts,
  summarizeDashboardAccounting,
  summarizeDashboardOperations,
  summarizeDashboardStorefrontHealth
} from "../src/lib/admin-dashboard";
import type { DashboardDTO, InventoryItemDTO, InventorySaleDTO, StorefrontOrderDTO } from "../src/types/radar";

const fixedNow = new Date("2026-07-24T16:00:00.000Z");
const fixedTimeZone = "America/New_York";

function sale(overrides: Partial<InventorySaleDTO> = {}): InventorySaleDTO {
  return {
    id: overrides.id ?? "sale-1",
    inventoryItemId: overrides.inventoryItemId ?? "item-1",
    itemName: overrides.itemName ?? "Test Product",
    activeQuantitySold: overrides.activeQuantitySold ?? 1,
    activeNetSale: overrides.activeNetSale ?? 10,
    activeProfitLoss: overrides.activeProfitLoss ?? 2,
    saleStatus: overrides.saleStatus ?? "active",
    saleReference: overrides.saleReference ?? null,
    customerEmail: overrides.customerEmail ?? null,
    customerPhone: overrides.customerPhone ?? null,
    soldAt: overrides.soldAt ?? "2026-07-24T15:00:00.000Z",
    storefrontOrderNumber: overrides.storefrontOrderNumber ?? null,
    refundStatus: overrides.refundStatus ?? null,
    ...overrides
  } as InventorySaleDTO;
}

function inventoryItem(overrides: Partial<InventoryItemDTO> = {}): InventoryItemDTO {
  return {
    id: overrides.id ?? "item-1",
    itemName: overrides.itemName ?? "Test Product",
    category: overrides.category ?? "Booster Boxes",
    sku: overrides.sku ?? "SKU-1",
    upc: overrides.upc ?? null,
    quantityOwned: overrides.quantityOwned ?? 5,
    totalCost: overrides.totalCost ?? 50,
    imageUrl: overrides.imageUrl ?? null,
    publicImages: overrides.publicImages ?? [],
    publishToStore: overrides.publishToStore ?? true,
    storeStatus: overrides.storeStatus ?? "active",
    publicPrice: overrides.publicPrice ?? 19.99,
    availableForSale: overrides.availableForSale ?? overrides.quantityOwned ?? 5,
    needsShippingProfile: overrides.needsShippingProfile ?? false,
    shippingAvailable: overrides.shippingAvailable ?? true,
    localPickupAvailable: overrides.localPickupAvailable ?? true,
    sales: overrides.sales ?? [],
    ...overrides
  } as InventoryItemDTO;
}

function order(overrides: Partial<StorefrontOrderDTO> = {}): StorefrontOrderDTO {
  const orderNumber = overrides.orderNumber ?? "GDG-100";
  return {
    id: overrides.id ?? "order-1",
    orderNumber,
    status: overrides.status ?? "paid",
    paymentStatus: overrides.paymentStatus ?? "paid",
    fulfillmentStatus: overrides.fulfillmentStatus ?? "unfulfilled",
    isTestOrder: overrides.isTestOrder ?? false,
    isLocalPickup: overrides.isLocalPickup ?? false,
    shippingPackageProfile: overrides.shippingPackageProfile ?? "sealed_medium",
    shippingMethodLabel: overrides.shippingMethodLabel ?? "USPS Ground Advantage",
    needsFulfillment: overrides.needsFulfillment ?? true,
    paidAt: overrides.paidAt ?? "2026-07-24T14:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-07-24T13:30:00.000Z",
    shippedAt: overrides.shippedAt ?? null,
    total: overrides.total ?? 10,
    refundedAmount: overrides.refundedAmount ?? 0,
    netProfit: overrides.netProfit ?? 2,
    itemCount: overrides.itemCount ?? 1,
    customerName: overrides.customerName ?? "Test Customer",
    customerEmail: overrides.customerEmail ?? "customer@example.test",
    refundStatus: overrides.refundStatus ?? null,
    stockReturnStatus: overrides.stockReturnStatus ?? null,
    items: overrides.items ?? [
      {
        id: "line-1",
        inventoryItemId: "item-1",
        publicTitle: "Test Product",
        imageUrl: null,
        quantity: 1,
        lineTotal: 10,
        profitLoss: 2
      } as StorefrontOrderDTO["items"][number]
    ],
    ...overrides
  } as StorefrontOrderDTO;
}

function dashboard(input: { orders?: StorefrontOrderDTO[]; inventory?: InventoryItemDTO[] }): Pick<DashboardDTO, "storefrontOrders" | "inventory"> {
  return {
    storefrontOrders: input.orders ?? [],
    inventory: input.inventory ?? []
  };
}

test("dashboard accounting totals use all eligible transactions before applying recent display limit", () => {
  const sales = Array.from({ length: 7 }, (_, index) => sale({
    id: `sale-${index}`,
    activeNetSale: 10,
    activeProfitLoss: 2,
    soldAt: `2026-07-${24 - index}T15:00:00.000Z`
  }));
  const input = dashboard({ inventory: [inventoryItem({ sales })] });
  const range = dashboardDateRange("month_to_date", { now: fixedNow, timeZone: fixedTimeZone });
  const summary = summarizeDashboardAccounting(input, range, { now: fixedNow, timeZone: fixedTimeZone });

  assert.equal(summary.periodTransactions.length, 7);
  assert.equal(summary.recentTransactions.length, 5);
  assert.equal(summary.periodRevenue, 70);
  assert.equal(summary.periodVerifiedProfit, 14);
});

test("dashboard accounting includes revenue with unknown cost basis without inventing profit", () => {
  const input = dashboard({
    orders: [
      order({
        id: "order-unknown-profit",
        netProfit: null as unknown as number,
        items: [
        {
          id: "line-unknown",
          inventoryItemId: "item-1",
          publicTitle: "Unknown Cost Product",
          imageUrl: null,
          quantity: 1,
          lineTotal: 25,
          profitLoss: null as unknown as number
        } as StorefrontOrderDTO["items"][number]
        ],
        total: 25
      })
    ],
    inventory: [inventoryItem()]
  });
  const summary = summarizeDashboardAccounting(input, dashboardDateRange("month_to_date", { now: fixedNow, timeZone: fixedTimeZone }), { now: fixedNow, timeZone: fixedTimeZone });

  assert.equal(summary.periodRevenue, 25);
  assert.equal(summary.periodVerifiedProfit, 0);
  assert.equal(summary.periodUnknownProfitCount, 1);
});

test("dashboard accounting does not double count POS sale rows linked to an eligible storefront order", () => {
  const input = dashboard({
    orders: [order({
      orderNumber: "GDG-200",
      total: 30,
      netProfit: 9,
      items: [
        {
          id: "line-gdg-200",
          inventoryItemId: "item-1",
          publicTitle: "Test Product",
          imageUrl: null,
          quantity: 1,
          lineTotal: 30,
          profitLoss: 9
        } as StorefrontOrderDTO["items"][number]
      ]
    })],
    inventory: [
      inventoryItem({
        sales: [
          sale({ id: "linked-sale", storefrontOrderNumber: "GDG-200", activeNetSale: 30, activeProfitLoss: 9 }),
          sale({ id: "standalone-sale", activeNetSale: 12, activeProfitLoss: 4 })
        ]
      })
    ]
  });
  const summary = summarizeDashboardAccounting(input, dashboardDateRange("month_to_date", { now: fixedNow, timeZone: fixedTimeZone }), { now: fixedNow, timeZone: fixedTimeZone });

  assert.equal(summary.periodRevenue, 42);
  assert.equal(summary.periodVerifiedProfit, 13);
  assert.equal(summary.periodTransactions.length, 2);
});

test("dashboard operations count only genuinely actionable fulfillment and refund states", () => {
  const operations = summarizeDashboardOperations([
    order({ id: "ship-me", needsFulfillment: true, fulfillmentStatus: "unfulfilled", isLocalPickup: false }),
    order({ id: "already-shipped", needsFulfillment: false, fulfillmentStatus: "shipped", shippedAt: "2026-07-24T15:00:00.000Z" }),
    order({ id: "pickup-ready", isLocalPickup: true, shippingPackageProfile: "local_pickup", fulfillmentStatus: "pickup_ready" }),
    order({ id: "picked-up", isLocalPickup: true, shippingPackageProfile: "local_pickup", fulfillmentStatus: "picked_up", needsFulfillment: false }),
    order({ id: "pending-payment", paymentStatus: "pending", status: "pending_payment", needsFulfillment: false }),
    order({ id: "refund-complete", status: "paid", paymentStatus: "partially_refunded", refundStatus: "completed", stockReturnStatus: "completed", needsFulfillment: false }),
    order({ id: "refund-needs-work", status: "refund_pending", paymentStatus: "paid", refundStatus: "pending", needsFulfillment: false })
  ]);

  assert.deepEqual(operations, {
    ordersToShip: 1,
    pickupOrders: 1,
    pendingPayments: 1,
    refundReturns: 1
  });
});

test("storefront health includes active sold-out products and precise setup gaps", () => {
  const health = summarizeDashboardStorefrontHealth([
    inventoryItem({ id: "ok", quantityOwned: 10, availableForSale: 10, publicImages: ["image.jpg"] }),
    inventoryItem({ id: "sold-out-status", storeStatus: "sold_out", quantityOwned: 3, availableForSale: 3, publicImages: ["image.jpg"] }),
    inventoryItem({ id: "low-stock", quantityOwned: 2, availableForSale: 2, publicImages: ["image.jpg"] }),
    inventoryItem({ id: "missing-price", publicPrice: null as unknown as number, publicImages: ["image.jpg"] }),
    inventoryItem({ id: "missing-image", publicImages: [], imageUrl: null }),
    inventoryItem({ id: "missing-shipping", needsShippingProfile: true, shippingAvailable: false, localPickupAvailable: false, publicImages: ["image.jpg"] }),
    inventoryItem({ id: "hidden", publishToStore: false, quantityOwned: 0, publicPrice: null as unknown as number })
  ]);

  assert.equal(health.activeProducts, 6);
  assert.equal(health.outOfStock, 1);
  assert.equal(health.lowStock, 1);
  assert.equal(health.missingPrice, 1);
  assert.equal(health.missingImage, 1);
  assert.equal(health.missingShipping, 1);
});

test("top selling products use all last-30-day transactions, not the recent five rows", () => {
  const productA = inventoryItem({
    id: "a",
    itemName: "Consistent Seller",
    sales: Array.from({ length: 7 }, (_, index) => sale({
      id: `a-${index}`,
      inventoryItemId: "a",
      itemName: "Consistent Seller",
      activeQuantitySold: 1,
      activeNetSale: 8,
      activeProfitLoss: 3,
      soldAt: `2026-07-${10 + index}T15:00:00.000Z`
    }))
  });
  const productB = inventoryItem({
    id: "b",
    itemName: "Recent Runner Up",
    sales: Array.from({ length: 5 }, (_, index) => sale({
      id: `b-${index}`,
      inventoryItemId: "b",
      itemName: "Recent Runner Up",
      activeQuantitySold: 1,
      activeNetSale: 12,
      activeProfitLoss: 4,
      soldAt: `2026-07-${20 + index}T15:00:00.000Z`
    }))
  });
  const summary = summarizeDashboardAccounting(dashboard({ inventory: [productA, productB] }), dashboardDateRange("month_to_date", { now: fixedNow, timeZone: fixedTimeZone }), { now: fixedNow, timeZone: fixedTimeZone });
  const topProducts = dashboardTopSellingProducts(summary.topSellingTransactions, [productA, productB]);

  assert.equal(summary.recentTransactions.length, 5);
  assert.equal(topProducts[0]?.key, "a");
  assert.equal(topProducts[0]?.units, 7);
  assert.equal(topProducts[0]?.verifiedProfit, 21);
});

test("dashboard month boundaries are deterministic in the configured business time zone", () => {
  const range = dashboardDateRange("month_to_date", { now: fixedNow, timeZone: fixedTimeZone });
  const input = dashboard({
    inventory: [
      inventoryItem({
        sales: [
          sale({ id: "before-local-month", soldAt: "2026-07-01T03:59:59.000Z", activeNetSale: 100 }),
          sale({ id: "at-local-month", soldAt: "2026-07-01T04:00:00.000Z", activeNetSale: 10 }),
          sale({ id: "today", soldAt: "2026-07-24T15:00:00.000Z", activeNetSale: 20 })
        ]
      })
    ]
  });
  const summary = summarizeDashboardAccounting(input, range, { now: fixedNow, timeZone: fixedTimeZone });

  assert.equal(range.start.toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(summary.periodRevenue, 30);
  assert.equal(summary.todayRevenue, 20);
});
