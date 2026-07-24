import type { DashboardDTO, InventoryItemDTO, InventorySaleDTO, StorefrontOrderDTO } from "@/types/radar";

export const ADMIN_DASHBOARD_BUSINESS_TIME_ZONE = "America/New_York";
export const ADMIN_DASHBOARD_RECENT_LIMIT = 5;

export type DashboardRangePreset = "today" | "last_7_days" | "month_to_date" | "last_30_days";

export type DashboardDateRange = {
  start: Date;
  end: Date;
  label: string;
  timeZone: string;
};

export type DashboardTransactionChannel = "online" | "pos";

export type DashboardTransaction = {
  id: string;
  canonicalId: string;
  channel: DashboardTransactionChannel;
  inventoryItemId: string | null;
  productName: string;
  imageUrl: string | null;
  reference: string;
  customer: string;
  occurredAt: string;
  quantity: number;
  revenue: number;
  verifiedProfit: number | null;
  status: string;
  statusTone: "good" | "blue" | "watch" | "bad" | "neutral";
  sourceOrderNumber: string | null;
};

export type DashboardAccountingSummary = {
  allEligibleTransactions: DashboardTransaction[];
  periodTransactions: DashboardTransaction[];
  recentTransactions: DashboardTransaction[];
  topSellingTransactions: DashboardTransaction[];
  todayTransactions: DashboardTransaction[];
  periodRevenue: number;
  periodVerifiedProfit: number;
  periodUnknownProfitCount: number;
  todayRevenue: number;
  todayOnlineCount: number;
  todayPosCount: number;
};

export type DashboardTopProduct = {
  key: string;
  name: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
  verifiedProfit: number | null;
  unknownProfitCount: number;
  margin: number | null;
};

export type DashboardOperationsSummary = {
  ordersToShip: number;
  pickupOrders: number;
  pendingPayments: number;
  refundReturns: number;
};

export type DashboardStorefrontHealth = {
  activeProducts: number;
  missingPrice: number;
  missingImage: number;
  missingShipping: number;
  outOfStock: number;
  lowStock: number;
};

export type DashboardStatusRow = {
  item: InventoryItemDTO;
  status: "Out of Stock" | "Low Stock" | "Missing Price" | "Missing Image" | "In Stock";
  tone: "good" | "watch" | "bad" | "neutral";
};

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const hour = part("hour");
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: hour === 24 ? 0 : hour,
    minute: part("minute"),
    second: part("second")
  };
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number, timeZone: string) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const parts = zonedParts(utcGuess, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond);
  const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  return new Date(utcGuess.getTime() + (wantedUtc - asIfUtc));
}

function addZonedDays(year: number, month: number, day: number, days: number, timeZone: string) {
  const noon = zonedTimeToUtc(year, month, day, 12, 0, 0, 0, timeZone);
  noon.setUTCDate(noon.getUTCDate() + days);
  return zonedParts(noon, timeZone);
}

function formatDashboardDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(value);
}

export function dashboardDateRange(
  preset: DashboardRangePreset,
  options: { now?: Date; timeZone?: string } = {}
): DashboardDateRange {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? ADMIN_DASHBOARD_BUSINESS_TIME_ZONE;
  const current = zonedParts(now, timeZone);
  const startParts =
    preset === "today"
      ? current
      : preset === "month_to_date"
        ? { ...current, day: 1 }
        : addZonedDays(current.year, current.month, current.day, preset === "last_7_days" ? -6 : -29, timeZone);
  const start = zonedTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0, timeZone);
  const nextDay = addZonedDays(current.year, current.month, current.day, 1, timeZone);
  const end = zonedTimeToUtc(nextDay.year, nextDay.month, nextDay.day, 0, 0, 0, 0, timeZone);
  const label = preset === "today" ? "Today" : `${formatDashboardDate(start, timeZone)} – ${formatDashboardDate(new Date(end.getTime() - 1), timeZone)}`;
  return { start, end, label, timeZone };
}

export function dashboardDateInRange(value: string | null | undefined, range: Pick<DashboardDateRange, "start" | "end">) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time >= range.start.getTime() && time < range.end.getTime();
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function dashboardOrderNetRevenue(order: Pick<StorefrontOrderDTO, "total" | "refundedAmount">) {
  return Math.max(0, order.total - order.refundedAmount);
}

export function dashboardOrderIsLocalPickup(order: Pick<StorefrontOrderDTO, "isLocalPickup" | "shippingPackageProfile" | "shippingMethodLabel">) {
  return order.isLocalPickup || order.shippingPackageProfile === "local_pickup" || String(order.shippingMethodLabel || "").trim().toLowerCase() === "local pickup";
}

function orderIsTerminal(order: Pick<StorefrontOrderDTO, "status" | "paymentStatus" | "fulfillmentStatus">) {
  return (
    ["canceled", "expired", "failed", "refunded"].includes(order.status) ||
    ["canceled", "expired", "failed", "refunded"].includes(order.paymentStatus) ||
    order.fulfillmentStatus === "canceled"
  );
}

export function dashboardOrderCountsAsRevenue(order: StorefrontOrderDTO) {
  return !order.isTestOrder && ["paid", "partially_refunded"].includes(order.paymentStatus) && !orderIsTerminal(order) && dashboardOrderNetRevenue(order) > 0;
}

export function dashboardSaleCountsAsRevenue(sale: InventorySaleDTO) {
  return !["canceled", "refunded", "test"].includes(sale.saleStatus) && sale.activeQuantitySold > 0 && sale.activeNetSale > 0;
}

function orderFulfillmentLabel(order: StorefrontOrderDTO) {
  if (dashboardOrderIsLocalPickup(order)) {
    if (order.fulfillmentStatus === "picked_up") return "Picked Up";
    if (order.fulfillmentStatus === "pickup_ready") return "Ready for Pickup";
    if (order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled") return "Pickup Pending";
  }
  return order.fulfillmentStatus.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function dashboardInventoryPrimaryImage(item: Pick<InventoryItemDTO, "publicImages" | "imageUrl">) {
  return item.publicImages[0] ?? item.imageUrl ?? null;
}

export function dashboardInventoryIdentifier(item: Pick<InventoryItemDTO, "sku" | "upc" | "category">) {
  return item.sku ? `SKU: ${item.sku}` : item.upc ? `UPC: ${item.upc}` : item.category;
}

function orderTransactions(order: StorefrontOrderDTO): DashboardTransaction[] {
  const revenue = dashboardOrderNetRevenue(order);
  const orderProfit = finiteNumber(order.netProfit);
  return order.items.map((item, index): DashboardTransaction => {
    const revenueShare = order.total > 0 ? item.lineTotal / order.total : order.items.length > 0 ? 1 / order.items.length : 0;
    const itemRevenue = Math.max(0, item.lineTotal - order.refundedAmount * revenueShare);
    const itemProfit = finiteNumber(item.profitLoss);
    return {
      id: `order-${order.id}-${item.id || index}`,
      canonicalId: `storefront-order:${order.id}:item:${item.id || index}`,
      channel: "online",
      inventoryItemId: item.inventoryItemId,
      productName: item.publicTitle,
      imageUrl: item.imageUrl,
      reference: `#${order.orderNumber}`,
      customer: order.customerName || order.customerEmail || "Guest",
      occurredAt: order.paidAt ?? order.createdAt,
      quantity: item.quantity,
      revenue: itemRevenue,
      verifiedProfit: itemProfit ?? (order.items.length === 1 ? orderProfit : null),
      status: orderFulfillmentLabel(order),
      statusTone: order.needsFulfillment ? "watch" : "good",
      sourceOrderNumber: order.orderNumber
    };
  }).filter((transaction) => transaction.revenue > 0 || revenue > 0);
}

function saleTransaction(sale: InventorySaleDTO, item: InventoryItemDTO): DashboardTransaction {
  return {
    id: `sale-${sale.id}`,
    canonicalId: `sale:${sale.id}`,
    channel: "pos",
    inventoryItemId: sale.inventoryItemId,
    productName: sale.itemName,
    imageUrl: dashboardInventoryPrimaryImage(item),
    reference: sale.saleReference ? `#${sale.saleReference}` : "POS sale",
    customer: sale.customerEmail || sale.customerPhone || "Walk-in",
    occurredAt: sale.soldAt,
    quantity: sale.activeQuantitySold,
    revenue: sale.activeNetSale,
    verifiedProfit: finiteNumber(sale.activeProfitLoss),
    status: sale.refundStatus ? sale.refundStatus.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase()) : "Completed",
    statusTone: sale.activeProfitLoss >= 0 ? "good" : "bad",
    sourceOrderNumber: sale.storefrontOrderNumber
  };
}

function sortTransactionsNewestFirst(a: DashboardTransaction, b: DashboardTransaction) {
  return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || a.canonicalId.localeCompare(b.canonicalId);
}

export function dashboardEligibleTransactions(dashboard: Pick<DashboardDTO, "storefrontOrders" | "inventory">) {
  const eligibleOrders = dashboard.storefrontOrders.filter(dashboardOrderCountsAsRevenue);
  const orderNumbers = new Set(eligibleOrders.map((order) => order.orderNumber).filter(Boolean));
  const transactions: DashboardTransaction[] = [];

  // Accounting uses the complete eligible online-order set. Storefront-generated Sale rows are excluded by order number
  // so a paid checkout cannot be counted once as a StorefrontOrder and again as a sale.
  for (const order of eligibleOrders) transactions.push(...orderTransactions(order));

  for (const item of dashboard.inventory) {
    for (const sale of item.sales) {
      if (!dashboardSaleCountsAsRevenue(sale)) continue;
      if (sale.storefrontOrderNumber && orderNumbers.has(sale.storefrontOrderNumber)) continue;
      transactions.push(saleTransaction(sale, item));
    }
  }

  const byCanonicalId = new Map<string, DashboardTransaction>();
  for (const transaction of transactions) {
    if (!byCanonicalId.has(transaction.canonicalId)) byCanonicalId.set(transaction.canonicalId, transaction);
  }
  return [...byCanonicalId.values()].sort(sortTransactionsNewestFirst);
}

export function summarizeDashboardAccounting(
  dashboard: Pick<DashboardDTO, "storefrontOrders" | "inventory">,
  range: DashboardDateRange,
  options: { now?: Date; timeZone?: string; recentLimit?: number } = {}
): DashboardAccountingSummary {
  const timeZone = options.timeZone ?? range.timeZone ?? ADMIN_DASHBOARD_BUSINESS_TIME_ZONE;
  const allEligibleTransactions = dashboardEligibleTransactions(dashboard);
  // periodTransactions is filtered from the complete eligible set before any display limit is applied.
  const periodTransactions = allEligibleTransactions.filter((transaction) => dashboardDateInRange(transaction.occurredAt, range));
  // recentTransactions is the only sliced dataset; it is display-only and must never feed accounting totals.
  const recentTransactions = allEligibleTransactions.slice(0, options.recentLimit ?? ADMIN_DASHBOARD_RECENT_LIMIT);
  const last30Range = dashboardDateRange("last_30_days", { now: options.now, timeZone });
  const topSellingTransactions = allEligibleTransactions.filter((transaction) => dashboardDateInRange(transaction.occurredAt, last30Range));
  const todayRange = dashboardDateRange("today", { now: options.now, timeZone });
  const todayTransactions = allEligibleTransactions.filter((transaction) => dashboardDateInRange(transaction.occurredAt, todayRange));
  const knownProfitTransactions = periodTransactions.filter((transaction) => transaction.verifiedProfit !== null);
  return {
    allEligibleTransactions,
    periodTransactions,
    recentTransactions,
    topSellingTransactions,
    todayTransactions,
    periodRevenue: periodTransactions.reduce((sum, transaction) => sum + transaction.revenue, 0),
    periodVerifiedProfit: knownProfitTransactions.reduce((sum, transaction) => sum + (transaction.verifiedProfit ?? 0), 0),
    periodUnknownProfitCount: periodTransactions.length - knownProfitTransactions.length,
    todayRevenue: todayTransactions.reduce((sum, transaction) => sum + transaction.revenue, 0),
    todayOnlineCount: todayTransactions.filter((transaction) => transaction.channel === "online").length,
    todayPosCount: todayTransactions.filter((transaction) => transaction.channel === "pos").length
  };
}

export function dashboardTopSellingProducts(transactions: DashboardTransaction[], inventory: InventoryItemDTO[]) {
  const byProduct = new Map<string, { key: string; name: string; imageUrl: string | null; units: number; revenue: number; profit: number; unknownProfitCount: number }>();
  for (const transaction of transactions) {
    if (!transaction.inventoryItemId) continue;
    const existing = byProduct.get(transaction.inventoryItemId) ?? {
      key: transaction.inventoryItemId,
      name: transaction.productName,
      imageUrl: transaction.imageUrl,
      units: 0,
      revenue: 0,
      profit: 0,
      unknownProfitCount: 0
    };
    existing.units += transaction.quantity;
    existing.revenue += transaction.revenue;
    if (transaction.verifiedProfit === null) existing.unknownProfitCount += 1;
    else existing.profit += transaction.verifiedProfit;
    existing.imageUrl = existing.imageUrl ?? transaction.imageUrl;
    byProduct.set(transaction.inventoryItemId, existing);
  }

  return [...byProduct.values()]
    .map((product): DashboardTopProduct => {
      const inventoryMatch = inventory.find((item) => item.id === product.key);
      const verifiedProfit = product.unknownProfitCount > 0 && product.profit === 0 ? null : product.profit;
      return {
        ...product,
        imageUrl: product.imageUrl ?? (inventoryMatch ? dashboardInventoryPrimaryImage(inventoryMatch) : null),
        verifiedProfit,
        margin: product.revenue > 0 && verifiedProfit !== null ? (verifiedProfit / product.revenue) * 100 : null
      };
    })
    .filter((product) => product.units > 0)
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export function dashboardOrderRequiresShipment(order: StorefrontOrderDTO) {
  if (!dashboardOrderCountsAsRevenue(order) || dashboardOrderIsLocalPickup(order) || !order.needsFulfillment) return false;
  return !["shipped", "delivered", "completed", "picked_up", "canceled"].includes(order.fulfillmentStatus) && !order.shippedAt;
}

export function dashboardOrderRequiresPickup(order: StorefrontOrderDTO) {
  if (!dashboardOrderCountsAsRevenue(order) || !dashboardOrderIsLocalPickup(order) || !order.needsFulfillment) return false;
  return !["picked_up", "completed", "canceled"].includes(order.fulfillmentStatus);
}

export function dashboardOrderPaymentPending(order: StorefrontOrderDTO) {
  if (order.isTestOrder || orderIsTerminal(order)) return false;
  return ["pending", "requires_payment_method", "requires_action", "processing"].includes(order.paymentStatus) || order.status === "pending_payment";
}

export function dashboardOrderNeedsRefundReturnAction(order: StorefrontOrderDTO) {
  if (order.isTestOrder) return false;
  return ["refund_pending", "refund_failed", "return_requested", "return_pending"].includes(order.status) ||
    ["refund_pending", "refund_failed"].includes(order.paymentStatus) ||
    ["pending", "failed", "requested"].includes(order.refundStatus || "") ||
    ["pending", "requested", "failed"].includes(order.stockReturnStatus || "");
}

export function summarizeDashboardOperations(orders: StorefrontOrderDTO[]): DashboardOperationsSummary {
  return {
    ordersToShip: orders.filter(dashboardOrderRequiresShipment).length,
    pickupOrders: orders.filter(dashboardOrderRequiresPickup).length,
    pendingPayments: orders.filter(dashboardOrderPaymentPending).length,
    refundReturns: orders.filter(dashboardOrderNeedsRefundReturnAction).length
  };
}

export function dashboardActiveStorefrontProducts(items: InventoryItemDTO[]) {
  return items.filter((item) => item.publishToStore && ["active", "sold_out"].includes(item.storeStatus));
}

export function dashboardStorefrontAvailableQuantity(item: Pick<InventoryItemDTO, "availableForSale" | "quantityOwned">) {
  return Math.max(0, Math.min(item.quantityOwned, item.availableForSale ?? item.quantityOwned));
}

export function summarizeDashboardStorefrontHealth(items: InventoryItemDTO[]): DashboardStorefrontHealth {
  const activeProducts = dashboardActiveStorefrontProducts(items);
  return {
    activeProducts: activeProducts.length,
    missingPrice: activeProducts.filter((item) => typeof item.publicPrice !== "number" || item.publicPrice <= 0).length,
    missingImage: activeProducts.filter((item) => !dashboardInventoryPrimaryImage(item)).length,
    missingShipping: activeProducts.filter((item) => item.needsShippingProfile || (!item.shippingAvailable && !item.localPickupAvailable)).length,
    outOfStock: activeProducts.filter((item) => item.storeStatus === "sold_out" || dashboardStorefrontAvailableQuantity(item) <= 0).length,
    lowStock: activeProducts.filter((item) => {
      const available = dashboardStorefrontAvailableQuantity(item);
      return available > 0 && available <= 2;
    }).length
  };
}

export function dashboardInventoryStatusRows(items: InventoryItemDTO[]): DashboardStatusRow[] {
  return [...items]
    .filter((item) => item.quantityOwned <= 0 || item.quantityOwned <= 2 || item.publishToStore)
    .sort((a, b) => {
      const priority = (item: InventoryItemDTO) => {
        if (item.quantityOwned <= 0 || (item.publishToStore && item.storeStatus === "sold_out")) return 0;
        if (item.quantityOwned <= 2) return 1;
        if (item.publishToStore && (typeof item.publicPrice !== "number" || item.publicPrice <= 0)) return 2;
        if (item.publishToStore && !dashboardInventoryPrimaryImage(item)) return 3;
        return 4;
      };
      return priority(a) - priority(b) || a.quantityOwned - b.quantityOwned || a.itemName.localeCompare(b.itemName);
    })
    .map((item) => {
      if (item.quantityOwned <= 0 || (item.publishToStore && item.storeStatus === "sold_out")) return { item, status: "Out of Stock", tone: "bad" };
      if (item.quantityOwned <= 2) return { item, status: "Low Stock", tone: "watch" };
      if (item.publishToStore && (typeof item.publicPrice !== "number" || item.publicPrice <= 0)) return { item, status: "Missing Price", tone: "bad" };
      if (item.publishToStore && !dashboardInventoryPrimaryImage(item)) return { item, status: "Missing Image", tone: "neutral" };
      return { item, status: "In Stock", tone: "good" };
    });
}
