import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import { cleanStorefrontDescription, cleanStorefrontTitle } from "@/lib/storefront-copy";
import { isStorefrontDisplayImageUrl } from "@/lib/product-image-quality";
import { getSavedProductImageUrls } from "@/lib/product-images";
import { calculateCartShipping, itemNeedsShippingProfile, type ShippingCalculation } from "@/lib/shipping";
import { storefrontContactEmail, storefrontSportsCardsUrl } from "@/lib/storefront-routing";
import type {
  PublicStoreProductDTO,
  SessionUser,
  StorefrontOrderDTO,
  StorefrontOrderItemDTO,
  StorefrontSettingsDTO,
  StorefrontSummaryDTO
} from "@/types/radar";

const reservationMinutes = 15;
const stripeCheckoutExpirationMinutes = 30;
const stripeShippingAllowedCountries = ["US"] satisfies Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];

const storefrontInventoryInclude = {
  stockLots: true,
  sales: true,
  stockReservations: true,
  productImages: {
    orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }, { createdAt: "asc" as const }]
  },
  product: {
    select: {
      liveImageUrl: true,
      imageUrl: true,
      url: true,
      verifiedFinalUrl: true,
      sku: true,
      upc: true,
      dpci: true,
      retailerProductId: true
    }
  }
} satisfies Prisma.InventoryItemInclude;

const storefrontOrderInclude = {
  items: {
    include: {
      inventoryItem: {
        select: {
          upc: true,
          sku: true,
          dpci: true,
          exactProductUrl: true,
          imageUrl: true,
          publicImages: true,
          productImages: {
            orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }, { createdAt: "asc" as const }]
          },
          product: {
            select: {
              liveImageUrl: true,
              imageUrl: true,
              url: true,
              verifiedFinalUrl: true,
              sku: true,
              upc: true,
              dpci: true,
              retailerProductId: true
            }
          }
        }
      }
    }
  },
  customer: true,
  reservations: true,
  paymentEvents: { orderBy: { receivedAt: "desc" } },
  fulfillment: true
} satisfies Prisma.StorefrontOrderInclude;

type StorefrontInventoryItem = Prisma.InventoryItemGetPayload<{ include: typeof storefrontInventoryInclude }>;
type StorefrontOrderWithItems = Prisma.StorefrontOrderGetPayload<{ include: typeof storefrontOrderInclude }>;
type StorefrontOrderItemWithInventory = StorefrontOrderWithItems["items"][number];
type ReservationSessionKey = {
  stripeCheckoutSessionId?: string | null;
  orderId?: string | null;
};

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function storefrontCheckoutConfigured() {
  return Boolean(
    envValue("STRIPE_CHECKOUT_ENABLED") === "true" &&
      envValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") &&
      envValue("STRIPE_SECRET_KEY") &&
      envValue("STRIPE_WEBHOOK_SECRET")
  );
}

function parseList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function stringifyList(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => String(entry).trim()).filter(Boolean));
  if (typeof value === "string") {
    const entries = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.length ? JSON.stringify(entries) : null;
  }
  return null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(base: string, itemId: string) {
  const normalized = slugify(base) || `product-${itemId.slice(-6)}`;
  let candidate = normalized;
  for (let index = 2; index < 50; index += 1) {
    const existing = await prisma.inventoryItem.findFirst({
      where: { publicSlug: candidate, id: { not: itemId } },
      select: { id: true }
    });
    if (!existing) return candidate;
    candidate = `${normalized}-${index}`;
  }
  return `${normalized}-${Date.now()}`;
}

function quantitySold(item: Pick<StorefrontInventoryItem, "sales">) {
  return item.sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
}

function quantityOwned(item: StorefrontInventoryItem) {
  const lotRemaining = item.stockLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  return item.stockLots.length ? lotRemaining : Math.max(0, item.quantity - quantitySold(item));
}

function sellableQuantity(item: StorefrontInventoryItem) {
  const owned = quantityOwned(item);
  const publicCap = item.availableForSale === null || item.availableForSale === undefined ? owned : Math.max(0, item.availableForSale);
  return Math.min(owned, publicCap);
}

function publicCategoryForItem(item: Pick<StorefrontInventoryItem, "category" | "setName" | "itemName">) {
  return displayStorefrontCategory({
    category: item.category,
    itemName: item.itemName,
    setName: item.setName
  });
}

function publicListingPrice(item: Pick<StorefrontInventoryItem, "publicPrice" | "targetSellPrice" | "msrp" | "currentMarketEstimate">) {
  return item.publicPrice ?? item.targetSellPrice ?? item.msrp ?? item.currentMarketEstimate ?? null;
}

function publicImages(item: StorefrontInventoryItem) {
  return getSavedProductImageUrls(item, { publicOnly: true }).filter(isStorefrontDisplayImageUrl);
}

export function publicProductToDTO(item: StorefrontInventoryItem): PublicStoreProductDTO | null {
  const price = item.publicPrice;
  const availableQuantity = sellableQuantity(item);
  const slug = item.publicSlug;
  if (!item.publishToStore || !slug || price === null || price === undefined) return null;
  if (!["active", "sold_out"].includes(item.storeStatus)) return null;
  const images = publicImages(item);
  const publicCategory = displayStorefrontCategory({
    category: item.storefrontCategory || item.category,
    title: item.publicTitle || item.itemName,
    itemName: item.itemName,
    setName: item.setName,
    tags: parseList(item.storefrontTags)
  });
  const publicTitle = cleanStorefrontTitle(item.publicTitle || item.itemName);
  const status = availableQuantity > 0 && item.storeStatus === "active" ? "active" : "sold_out";
  const primaryImageUrl = images[0] ?? null;
  return {
    id: item.id,
    slug,
    title: publicTitle,
    description: cleanStorefrontDescription({
      title: publicTitle,
      itemName: item.itemName,
      brand: item.brand,
      category: publicCategory,
      setName: item.setName,
      publicDescription: item.publicDescription,
      description: item.description,
      status,
      availableQuantity
    }),
    price,
    compareAtPrice: item.compareAtPrice,
    imageUrl: primaryImageUrl,
    primaryImageUrl,
    images,
    category: publicCategory,
    tags: parseList(item.storefrontTags),
    condition: cleanStorefrontTitle(item.condition),
    availableQuantity,
    maxQuantityPerOrder: item.maxQuantityPerOrder,
    status,
    localPickupAvailable: item.localPickupAvailable,
    localPickupEligible: item.localPickupAvailable,
    shippingAvailable: item.shippingAvailable,
    shippingProfile: item.shippingProfile,
    packageWeightOz: item.packageWeightOz,
    packageLengthIn: item.packageLengthIn,
    packageWidthIn: item.packageWidthIn,
    packageHeightIn: item.packageHeightIn,
    freeShippingEligible: item.freeShippingEligible,
    requiresBox: item.requiresBox,
    insuranceRecommended: item.insuranceRecommended,
    needsShippingProfile: itemNeedsShippingProfile(item),
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

export async function cleanupExpiredReservationsForCheckoutOnly(now = new Date()) {
  return prisma.stockReservation.updateMany({
    where: { status: "reserved", expiresAt: { lte: now } },
    data: { status: "released", releasedAt: now }
  });
}

export async function releaseExpiredReservations() {
  return cleanupExpiredReservationsForCheckoutOnly();
}

export async function getStorefrontSettings(): Promise<StorefrontSettingsDTO> {
  const settings = await prisma.storefrontSettings.findFirst({ orderBy: { updatedAt: "desc" } });
  return {
    storeName: settings?.storeName ?? "GameDayGrabs LLC",
    storeLogoUrl: settings?.storeLogoUrl ?? null,
    sportsCardsExternalUrl: storefrontSportsCardsUrl(settings?.sportsCardsExternalUrl),
    contactEmail: storefrontContactEmail(settings?.contactEmail),
    featuredHeroProductId: settings?.featuredHeroProductId ?? null,
    homepageHeroMode: (settings?.homepageHeroMode === "manual_product" || settings?.homepageHeroMode === "brand_only" ? settings.homepageHeroMode : "automatic_latest") as StorefrontSettingsDTO["homepageHeroMode"],
    newArrivalDays: Math.min(60, Math.max(1, settings?.newArrivalDays ?? 14)),
    showSoldOutInHero: settings?.showSoldOutInHero ?? true,
    returnPolicyText: settings?.returnPolicyText ?? null,
    shippingPolicyText: settings?.shippingPolicyText ?? null,
    localPickupInstructions: settings?.localPickupInstructions ?? null,
    announcementBanner: settings?.announcementBanner ?? null,
    defaultShippingPrice: settings?.defaultShippingPrice ?? 5,
    freeShippingThreshold: settings?.freeShippingThreshold ?? null,
    socialLinks: parseList(settings?.socialLinks),
    checkoutConfigured: storefrontCheckoutConfigured()
  };
}

export async function listPublicStoreProducts(input?: { q?: string; category?: string }) {
  const products = await prisma.inventoryItem.findMany({
    where: {
      publishToStore: true,
      storeStatus: { in: ["active", "sold_out"] },
      publicPrice: { not: null },
      publicSlug: { not: null }
    },
    include: storefrontInventoryInclude,
    orderBy: { updatedAt: "desc" }
  });
  const q = input?.q?.trim().toLowerCase();
  const category = input?.category?.trim().toLowerCase();
  return products
    .map((item) => publicProductToDTO(item))
    .filter((product): product is PublicStoreProductDTO => Boolean(product))
    .filter((product) => !q || product.title.toLowerCase().includes(q) || product.tags.some((tag) => tag.toLowerCase().includes(q)))
    .filter((product) => !category || category === "all" || product.category.toLowerCase() === category)
    .sort((left, right) => {
      const leftTime = Date.parse(left.publishedAt ?? left.createdAt);
      const rightTime = Date.parse(right.publishedAt ?? right.createdAt);
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
}

export async function getPublicStoreProduct(slug: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { publicSlug: slug, publishToStore: true, storeStatus: { in: ["active", "sold_out"] } },
    include: storefrontInventoryInclude
  });
  if (!item) return null;
  return publicProductToDTO(item);
}

export async function getCartProducts(items: Array<{ id: string; quantity: number }>, options: { strict?: boolean } = {}) {
  const strict = options.strict ?? true;
  const requested = new Map(items.map((item) => [item.id, item.quantity]));
  const products = await prisma.inventoryItem.findMany({
    where: { id: { in: [...requested.keys()] } },
    include: storefrontInventoryInclude
  });
  if (products.length !== requested.size) {
    throw new Error("One or more cart items are no longer available.");
  }
  return products.map((item) => {
    const product = publicProductToDTO(item);
    if (!product) throw new Error(`${item.publicTitle || item.itemName} is not available for checkout.`);
    const requestedQuantity = requested.get(item.id) ?? 0;
    if (strict && product.status !== "active") throw new Error(`${item.publicTitle || item.itemName} is not available for checkout.`);
    if (strict && requestedQuantity > product.availableQuantity) throw new Error(`Only ${product.availableQuantity} available for ${product.title}.`);
    if (strict && requestedQuantity > product.maxQuantityPerOrder) throw new Error(`Max ${product.maxQuantityPerOrder} per order for ${product.title}.`);
    return { item, product, quantity: requestedQuantity };
  });
}

function checkoutReservationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + reservationMinutes * 60 * 1000);
}

function stripeCheckoutSessionExpiresAt(now = new Date()) {
  return Math.floor((now.getTime() + stripeCheckoutExpirationMinutes * 60 * 1000) / 1000);
}

function activeReservedQuantityFromItem(item: StorefrontInventoryItem, now = new Date()) {
  return item.stockReservations
    .filter((reservation) => reservation.status === "reserved" && reservation.expiresAt > now)
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
}

export async function getActiveReservedQuantity(inventoryItemId: string, now = new Date()) {
  const aggregate = await prisma.stockReservation.aggregate({
    where: {
      inventoryItemId,
      status: "reserved",
      expiresAt: { gt: now }
    },
    _sum: { quantity: true }
  });
  return aggregate._sum.quantity ?? 0;
}

function checkoutAvailableQuantity(item: StorefrontInventoryItem, now = new Date()) {
  return Math.max(0, sellableQuantity(item) - activeReservedQuantityFromItem(item, now));
}

type CheckoutCartEntry = Awaited<ReturnType<typeof getCartProducts>>[number];

function validateCheckoutReservationAvailability(cart: CheckoutCartEntry[], now = new Date()) {
  for (const { item, product, quantity } of cart) {
    const availableAfterActiveReservations = checkoutAvailableQuantity(item, now);
    if (quantity > availableAfterActiveReservations) {
      throw new Error("This item is temporarily held in another checkout. Please try again shortly.");
    }
    if (quantity > sellableQuantity(item)) {
      throw new Error(`Only ${product.availableQuantity} available for ${product.title}.`);
    }
  }
}

async function createCheckoutReservations(tx: Prisma.TransactionClient, orderId: string, cart: CheckoutCartEntry[], expiresAt: Date) {
  return tx.stockReservation.createMany({
    data: cart.map(({ item, quantity }) => ({
      inventoryItemId: item.id,
      orderId,
      quantity,
      expiresAt
    }))
  });
}

function reservationSessionWhere(input: ReservationSessionKey, statuses = ["reserved"]) {
  const selectors: Prisma.StockReservationWhereInput[] = [];
  if (input.stripeCheckoutSessionId) selectors.push({ stripeCheckoutSessionId: input.stripeCheckoutSessionId });
  if (input.orderId) selectors.push({ orderId: input.orderId });
  if (!selectors.length) return null;
  return {
    status: statuses.length === 1 ? statuses[0] : { in: statuses },
    OR: selectors
  } satisfies Prisma.StockReservationWhereInput;
}

async function completeReservationsForSessionInTransaction(tx: Prisma.TransactionClient, stripeCheckoutSessionId: string | null | undefined, orderId?: string | null) {
  const where = reservationSessionWhere({ stripeCheckoutSessionId, orderId }, ["reserved", "released"]);
  if (!where) return { count: 0 };
  return tx.stockReservation.updateMany({
    where,
    data: { status: "completed" }
  });
}

export async function completeReservationsForSession(stripeCheckoutSessionId: string | null | undefined, orderId?: string | null) {
  const where = reservationSessionWhere({ stripeCheckoutSessionId, orderId }, ["reserved", "released"]);
  if (!where) return { count: 0 };
  return prisma.stockReservation.updateMany({
    where,
    data: { status: "completed" }
  });
}

export async function releaseReservationsForSession(stripeCheckoutSessionId: string | null | undefined, orderId?: string | null, now = new Date()) {
  const where = reservationSessionWhere({ stripeCheckoutSessionId, orderId });
  if (!where) return { count: 0 };
  return prisma.stockReservation.updateMany({
    where,
    data: { status: "released", releasedAt: now }
  });
}

function stripeClient() {
  const key = envValue("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe checkout is not configured. Set STRIPE_SECRET_KEY in Vercel.");
  return new Stripe(key);
}

export function storefrontStripeReadiness() {
  const missing = [
    envValue("STRIPE_CHECKOUT_ENABLED") !== "true" ? "STRIPE_CHECKOUT_ENABLED" : null,
    !envValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" : null,
    !envValue("STRIPE_SECRET_KEY") ? "STRIPE_SECRET_KEY" : null,
    !envValue("STRIPE_WEBHOOK_SECRET") ? "STRIPE_WEBHOOK_SECRET" : null
  ].filter((name): name is string => Boolean(name));
  return {
    configured: missing.length === 0,
    missing
  };
}

function isAllowedStorefrontHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "gamedaygrabs.com" ||
    normalized === "www.gamedaygrabs.com" ||
    normalized === "poke-restock-radar.vercel.app" ||
    normalized.endsWith(".vercel.app") ||
    normalized === "localhost" ||
    normalized === "127.0.0.1"
  );
}

export function storefrontCheckoutBaseUrl(requestUrl?: string | null) {
  const configured = envValue("STORE_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  if (requestUrl) {
    try {
      const parsed = new URL(requestUrl);
      if ((parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && isAllowedStorefrontHost(parsed.hostname)) {
        return parsed.origin;
      }
    } catch {
      // Fall through to APP_URL/default.
    }
  }

  return envValue("APP_URL")?.replace(/\/$/, "") || "https://poke-restock-radar.vercel.app";
}

function orderNumber() {
  return `PR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function inquiryNumber() {
  return `GDG-INQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function estimateStripeFee(total: number) {
  return Math.round((total * 0.029 + 0.3) * 100) / 100;
}

const cancellationReasonLabels = {
  out_of_stock: "Out of stock",
  customer_requested: "Customer requested cancellation",
  address_issue: "Address issue",
  fraud_suspicious: "Fraud / suspicious order",
  duplicate_order: "Duplicate order",
  other: "Other"
} as const;

type StorefrontCancellationReason = keyof typeof cancellationReasonLabels;
type StorefrontRefundType = "full" | "partial" | "none";

type StorefrontCancelRefundInput = {
  reason: StorefrontCancellationReason;
  adminNote?: string;
  refundType: StorefrontRefundType;
  partialRefundAmount?: number | null;
  returnItemsToStock: boolean;
  sendCustomerEmail: boolean;
  idempotencyKey: string;
};

function smtpReady() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

async function sendStorefrontEmail(to: string, subject: string, text: string) {
  if (!smtpReady()) return false;
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ""
        }
      : undefined
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text
  });
  return true;
}

function moneyFromCents(cents: number) {
  return Math.round(cents) / 100;
}

function centsFromMoney(amount: number) {
  return Math.round(amount * 100);
}

function stripeShippingOptions(shippingCalculation: ShippingCalculation): Stripe.Checkout.SessionCreateParams.ShippingOption[] {
  return shippingCalculation.shippingOptions.map((option) => ({
    shipping_rate_data: {
      type: "fixed_amount",
      display_name: option.label,
      fixed_amount: {
        amount: centsFromMoney(option.amount),
        currency: "usd"
      },
      metadata: {
        shippingOptionId: option.id,
        shippingOptionLabel: option.label,
        shippingRateSource: option.rateSource,
        shippingPackageProfile: option.profile,
        shippingPackageWeightOz: String(shippingCalculation.totalWeightOz),
        shippingWarnings: stringifyList(shippingCalculation.warnings) ?? ""
      }
    }
  }));
}

function orderRefundedCents(order: Pick<StorefrontOrderWithItems, "refundedAmount">) {
  return centsFromMoney(order.refundedAmount || 0);
}

function orderTotalCents(order: Pick<StorefrontOrderWithItems, "total">) {
  return centsFromMoney(order.total || 0);
}

function orderRemainingRefundableCents(order: Pick<StorefrontOrderWithItems, "total" | "refundedAmount">) {
  return Math.max(0, orderTotalCents(order) - orderRefundedCents(order));
}

const activeRevenuePaymentStatuses = ["paid", "partially_refunded"];

function storefrontOrderNetRevenue(order: Pick<StorefrontOrderWithItems, "total" | "refundedAmount">) {
  return Math.max(0, order.total - (order.refundedAmount || 0));
}

function storefrontOrderNetProfitAfterRefund(order: Pick<StorefrontOrderWithItems, "total" | "refundedAmount" | "stripeFeeEstimate" | "shippingCost" | "costBasis" | "netProfit">) {
  if (!order.refundedAmount) return order.netProfit;
  const netRevenue = storefrontOrderNetRevenue(order);
  if (netRevenue <= 0) return 0;
  return netRevenue - order.stripeFeeEstimate - order.shippingCost - order.costBasis;
}

function orderCanCancelOrRefund(order: StorefrontOrderWithItems) {
  return !(
    ["canceled", "refunded", "partially_refunded", "refund_pending"].includes(order.status) ||
    ["refunded", "partially_refunded", "refund_pending"].includes(order.paymentStatus) ||
    Boolean(order.canceledAt && order.refundStatus)
  );
}

function orderInventoryWasFinalized(order: StorefrontOrderWithItems) {
  return (
    order.paymentStatus === "paid" ||
    order.reservations.some((reservation) => reservation.status === "completed") ||
    order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0)
  );
}

function refundPaymentStatus(stripeRefundStatus: string | null, newRefundedCents: number, totalCents: number) {
  if (stripeRefundStatus === "failed" || stripeRefundStatus === "canceled") return "refund_failed";
  if (stripeRefundStatus && stripeRefundStatus !== "succeeded") return "refund_pending";
  return newRefundedCents >= totalCents ? "refunded" : "partially_refunded";
}

function refundEventPayload(input: {
  order: StorefrontOrderWithItems;
  reason: StorefrontCancellationReason;
  adminNote?: string;
  refundType: StorefrontRefundType;
  refundAmount: number;
  stripeRefundId?: string | null;
  stripeRefundStatus?: string | null;
  returnItemsToStock: boolean;
  stockReturnStatus: string;
  customerEmailStatus: string;
}) {
  return JSON.stringify({
    provider: "admin",
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    reason: input.reason,
    reasonLabel: cancellationReasonLabels[input.reason],
    adminNote: input.adminNote || null,
    refundType: input.refundType,
    refundAmount: input.refundAmount,
    currency: "usd",
    stripeRefundId: input.stripeRefundId || null,
    stripeRefundStatus: input.stripeRefundStatus || null,
    returnItemsToStock: input.returnItemsToStock,
    stockReturnStatus: input.stockReturnStatus,
    customerEmailStatus: input.customerEmailStatus
  });
}

async function sendStorefrontCancellationEmail(input: {
  order: StorefrontOrderWithItems;
  reason: StorefrontCancellationReason;
  adminNote?: string;
  refundAmount: number;
  contactEmail: string;
}) {
  const to = input.order.customerEmail ?? input.order.customer?.email ?? null;
  if (!to) return "missing_customer_email";
  const reasonLabel = cancellationReasonLabels[input.reason];
  const refundLine =
    input.refundAmount > 0
      ? `Refund amount: $${input.refundAmount.toFixed(2)}. Refund timing depends on your bank or card issuer.`
      : "No Stripe refund was issued for this order.";
  const text = [
    "GameDayGrabs order cancellation",
    "",
    `Order: ${input.order.orderNumber}`,
    `Reason: ${reasonLabel}`,
    input.adminNote ? `Note: ${input.adminNote}` : null,
    refundLine,
    "",
    `Questions? Contact ${input.contactEmail}.`
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  try {
    const sent = await sendStorefrontEmail(to, `GameDayGrabs order ${input.order.orderNumber} cancellation`, text);
    return sent ? "sent" : "not_configured";
  } catch {
    return "failed";
  }
}

function stripeImage(imageUrl: string | null | undefined) {
  return imageUrl && /^https?:\/\//i.test(imageUrl) ? [imageUrl] : undefined;
}

function orderItemToDTO(item: StorefrontOrderItemWithInventory): StorefrontOrderItemDTO {
  const resolvedImageUrl = item.imageUrl ?? getSavedProductImageUrls(item.inventoryItem, { publicOnly: true }).find(isStorefrontDisplayImageUrl) ?? null;
  return {
    id: item.id,
    inventoryItemId: item.inventoryItemId,
    publicTitle: item.publicTitle,
    publicSlug: item.publicSlug,
    imageUrl: resolvedImageUrl,
    upc: item.inventoryItem.upc,
    sku: item.inventoryItem.sku,
    dpci: item.inventoryItem.dpci,
    tcin: item.inventoryItem.sku,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    costBasis: item.costBasis,
    profitLoss: item.profitLoss
  };
}

function orderSource(order: StorefrontOrderWithItems): StorefrontOrderDTO["source"] {
  if (order.stripeCheckoutSessionId || order.paymentStatus === "paid" || order.paymentStatus === "failed" || order.paymentStatus === "expired") return "stripe_checkout";
  if (order.status === "invoice_requested" || order.paymentStatus === "invoice_requested") return "request_invoice";
  if (order.status === "contact_message") return "contact_message";
  return "manual";
}

function orderStatusBadge(order: StorefrontOrderWithItems) {
  if (order.status === "contact_message") return "Inquiry";
  if (order.status === "invoice_requested") return "Invoice Request";
  if (order.paymentStatus === "refund_failed" || order.status === "refund_failed") return "Refund Failed";
  if (order.paymentStatus === "refund_pending" || order.status === "refund_pending") return "Refund Pending";
  if (order.paymentStatus === "partially_refunded" || order.status === "partially_refunded") return "Partially Refunded";
  if (order.status === "inventory_review" || order.fulfillmentStatus === "review_required") return "Inventory Review";
  if (order.paymentStatus === "refunded" || order.status === "refunded") return "Refunded";
  if (order.status === "canceled") return "Canceled";
  if (order.paymentStatus === "expired") return "Expired";
  if (order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled") return "Needs Shipping";
  if (order.paymentStatus === "paid") return "Paid";
  if (order.paymentStatus === "pending") return "New";
  return order.status;
}

function orderTimeline(order: StorefrontOrderWithItems): StorefrontOrderDTO["timeline"] {
  const completedEvent = order.paymentEvents.find((event) => event.eventType === "checkout.session.completed");
  const cancellationStarted = order.paymentEvents.find((event) => event.eventType === "admin.cancel_refund.started");
  const refundCreated = order.paymentEvents.find((event) => event.eventType === "admin.refund.created");
  const notificationEvent = order.paymentEvents.find((event) => event.eventType.startsWith("admin.cancellation_email."));
  return [
    { label: "Order created", at: order.createdAt.toISOString(), detail: "Storefront order was created." },
    { label: "Checkout started", at: order.stripeCheckoutSessionId ? order.createdAt.toISOString() : null, detail: order.stripeCheckoutSessionId ? "Stripe Checkout session was created." : "No Stripe Checkout session for this order." },
    { label: "Payment completed", at: completedEvent?.receivedAt.toISOString() ?? order.paidAt?.toISOString() ?? null, detail: completedEvent ? "Stripe webhook checkout.session.completed was received." : "Payment completion webhook has not been stored." },
    { label: "Inventory reduced", at: order.reservations.some((reservation) => reservation.status === "completed") ? order.paidAt?.toISOString() ?? null : null, detail: order.reservations.some((reservation) => reservation.status === "completed") ? "Stock reservation completed after payment." : "Inventory has not been finalized for this order." },
    { label: "Sale created", at: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? order.paidAt?.toISOString() ?? null : null, detail: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? "Inventory sale/profit values are attached to order items." : "No sale/profit allocation stored yet." },
    { label: "Cancellation started", at: cancellationStarted?.receivedAt.toISOString() ?? order.canceledAt?.toISOString() ?? null, detail: order.refundReason ? `Reason: ${order.refundReason}.` : "No cancellation has been started." },
    { label: "Refund created", at: refundCreated?.receivedAt.toISOString() ?? order.refundedAt?.toISOString() ?? null, detail: order.refundedAmount > 0 ? `Refund total recorded: $${order.refundedAmount.toFixed(2)}.` : "No Stripe refund recorded." },
    { label: "Refund status", at: order.refundedAt?.toISOString() ?? null, detail: order.refundStatus ? `Refund status: ${order.refundStatus}.` : "No refund status recorded." },
    { label: "Inventory returned", at: order.stockReturnedAt?.toISOString() ?? null, detail: order.stockReturnStatus ? `Stock return status: ${order.stockReturnStatus}.` : "Stock has not been returned for this order." },
    { label: "Customer notified", at: order.customerCancellationEmailSentAt?.toISOString() ?? notificationEvent?.receivedAt.toISOString() ?? null, detail: order.customerCancellationEmailStatus ? `Email status: ${order.customerCancellationEmailStatus}.` : "No cancellation email recorded." },
    { label: "Admin note/reason", at: cancellationStarted?.receivedAt.toISOString() ?? null, detail: [order.refundReason ? `Reason: ${order.refundReason}` : null, order.refundNote ? `Note: ${order.refundNote}` : null].filter(Boolean).join(" - ") || "No admin cancellation note recorded." },
    { label: "Packing", at: order.fulfillmentStatus === "packing" || order.status === "packing" ? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "packing" || order.status === "packing" ? "Order is marked packing." : "Not marked packing yet." },
    { label: "Shipped", at: order.fulfillmentStatus === "shipped" ? order.fulfillment?.shippedAt?.toISOString() ?? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "shipped" ? "Order is marked shipped." : "Not shipped yet." }
  ];
}

function orderAddress(fields: {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}) {
  if (!fields.line1 && !fields.city && !fields.postalCode && !fields.country) return null;
  return {
    name: fields.name ?? null,
    line1: fields.line1 ?? null,
    line2: fields.line2 ?? null,
    city: fields.city ?? null,
    state: fields.state ?? null,
    postalCode: fields.postalCode ?? null,
    country: fields.country ?? null
  };
}

export function storefrontOrderToDTO(order: StorefrontOrderWithItems): StorefrontOrderDTO {
  const source = orderSource(order);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const needsFulfillment = order.paymentStatus === "paid" && !["shipped", "picked_up", "canceled"].includes(order.fulfillmentStatus);
  const isNewPaidOrder = order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled";
  const refundableAmount = moneyFromCents(orderRemainingRefundableCents(order));
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail ?? order.customer?.email ?? null,
    customerName: order.customerName ?? order.customer?.name ?? null,
    customerPhone: order.customerPhone ?? order.customer?.phone ?? null,
    stripeCustomerId: order.customer?.stripeCustomerId ?? null,
    customerOrderCount: order.customer?.totalOrders ?? null,
    customerTotalSpent: order.customer?.totalSpent ?? null,
    shippingAddress: orderAddress({
      name: order.shippingName,
      line1: order.shippingLine1,
      line2: order.shippingLine2,
      city: order.shippingCity,
      state: order.shippingState,
      postalCode: order.shippingPostalCode,
      country: order.shippingCountry
    }),
    billingAddress: orderAddress({
      name: order.billingName,
      line1: order.billingLine1,
      line2: order.billingLine2,
      city: order.billingCity,
      state: order.billingState,
      postalCode: order.billingPostalCode,
      country: order.billingCountry
    }),
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    source,
    sourceLabel: source === "stripe_checkout" ? "Stripe Checkout" : source === "request_invoice" ? "Request Invoice" : source === "contact_message" ? "Contact Message" : "Manual",
    itemCount,
    needsFulfillment,
    isNewPaidOrder,
    statusBadge: orderStatusBadge(order),
    subtotal: order.subtotal,
    shippingCharged: order.shippingCharged,
    shippingMethodLabel: order.shippingMethodLabel,
    shippingRateSource: order.shippingRateSource,
    shippingPackageWeightOz: order.shippingPackageWeightOz,
    shippingPackageProfile: order.shippingPackageProfile,
    shippingWarnings: parseList(order.shippingWarnings),
    tax: order.tax,
    total: order.total,
    stripeFeeEstimate: order.stripeFeeEstimate,
    shippingCost: order.shippingCost,
    costBasis: order.costBasis,
    netProfit: order.netProfit,
    roiPercent: order.roiPercent,
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    notes: order.notes,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    refundStatus: order.refundStatus,
    refundedAmount: order.refundedAmount,
    refundableAmount,
    refundCurrency: order.refundCurrency,
    stripeRefundId: order.stripeRefundId,
    refundReason: order.refundReason,
    refundNote: order.refundNote,
    stockReturnStatus: order.stockReturnStatus,
    stockReturnedAt: order.stockReturnedAt?.toISOString() ?? null,
    customerCancellationEmailStatus: order.customerCancellationEmailStatus,
    customerCancellationEmailSentAt: order.customerCancellationEmailSentAt?.toISOString() ?? null,
    canCancelOrRefund: orderCanCancelOrRefund(order),
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(orderItemToDTO),
    reservations: order.reservations.map((reservation) => ({
      id: reservation.id,
      inventoryItemId: reservation.inventoryItemId,
      stripeCheckoutSessionId: reservation.stripeCheckoutSessionId,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt.toISOString(),
      releasedAt: reservation.releasedAt?.toISOString() ?? null
    })),
    paymentEvents: order.paymentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      receivedAt: event.receivedAt.toISOString()
    })),
    timeline: orderTimeline(order)
  };
}

export async function createCheckoutSession(input: {
  items: Array<{ id: string; quantity: number }>;
  fulfillmentMethod: "shipping" | "pickup";
  customerEmail?: string;
  customerName?: string;
}, options: { requestUrl?: string | null } = {}) {
  const readiness = storefrontStripeReadiness();
  if (!readiness.configured) {
    throw new Error(`Stripe Checkout is not ready. Missing: ${readiness.missing.join(", ")}. Use Request Invoice until these are configured.`);
  }
  const checkoutBaseUrl = storefrontCheckoutBaseUrl(options.requestUrl);
  const settings = await getStorefrontSettings();
  const checkoutStartedAt = new Date();
  const reservationExpiresAt = checkoutReservationExpiresAt(checkoutStartedAt);
  await cleanupExpiredReservationsForCheckoutOnly(checkoutStartedAt);
  const cart = await getCartProducts(input.items);
  validateCheckoutReservationAvailability(cart, checkoutStartedAt);
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCalculation = calculateCartShipping(
    cart.map(({ item, quantity }) => ({ ...item, quantity })),
    { subtotal, freeShippingThreshold: settings.freeShippingThreshold, fulfillmentMethod: input.fulfillmentMethod }
  );
  const selectedShipping = shippingCalculation.defaultShippingOption;
  if (!selectedShipping) throw new Error("No safe shipping option is available for this cart. Use Request Invoice for manual review.");
  if (input.fulfillmentMethod === "shipping" && selectedShipping.id === "local_pickup") {
    throw new Error("Shipping is not available for one or more cart items. Use Request Invoice for manual review.");
  }
  if (input.fulfillmentMethod === "pickup" && selectedShipping.id !== "local_pickup") {
    throw new Error("Local pickup is not available for one or more cart items.");
  }
  const checkoutShippingOptions = stripeShippingOptions(shippingCalculation);
  if (!checkoutShippingOptions.length) throw new Error("No safe shipping option is available for this cart. Use Request Invoice for manual review.");
  const shippingCharged = selectedShipping.amount;
  const total = subtotal + shippingCharged;
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.storefrontOrder.create({
      data: {
        orderNumber: orderNumber(),
        userId: cart[0]?.item.userId ?? null,
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        subtotal,
        shippingCharged,
        shippingMethodLabel: selectedShipping.label,
        shippingRateSource: selectedShipping.rateSource,
        shippingPackageWeightOz: shippingCalculation.totalWeightOz,
        shippingPackageProfile: shippingCalculation.packageProfile,
        shippingWarnings: stringifyList(shippingCalculation.warnings),
        total,
        stripeFeeEstimate: estimateStripeFee(total),
        items: {
          create: cart.map(({ product, item, quantity }) => ({
            inventoryItemId: item.id,
            publicTitle: product.title,
            publicSlug: product.slug,
            imageUrl: product.imageUrl,
            quantity,
            unitPrice: product.price,
            lineTotal: product.price * quantity
          }))
        }
      }
    });
    await createCheckoutReservations(tx, created.id, cart, reservationExpiresAt);
    return tx.storefrontOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: storefrontOrderInclude
    });
  });
  const metadata = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    inventoryProductIds: order.items.map((item) => item.inventoryItemId).join(","),
    quantities: order.items.map((item) => item.quantity).join(","),
    internalReservationExpiresAt: reservationExpiresAt.toISOString(),
    internalReservationMinutes: String(reservationMinutes)
  };
  const stripe = stripeClient();
  let createdSession: Stripe.Checkout.Session | null = null;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.customerEmail,
      customer_creation: "always",
      phone_number_collection: { enabled: true },
      billing_address_collection: "auto",
      shipping_address_collection: {
        allowed_countries: stripeShippingAllowedCountries
      },
      shipping_options: checkoutShippingOptions,
      expires_at: stripeCheckoutSessionExpiresAt(checkoutStartedAt),
      line_items: [
        ...order.items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(item.unitPrice * 100),
            product_data: {
              name: item.publicTitle,
              images: stripeImage(item.imageUrl)
            }
          }
        }))
      ],
      metadata,
      payment_intent_data: {
        metadata
      },
      success_url: `${checkoutBaseUrl}/checkout/success?order=${order.id}&number=${encodeURIComponent(order.orderNumber)}`,
      cancel_url: `${checkoutBaseUrl}/checkout/cancel?order=${order.id}`
    });
    createdSession = session;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.stockReservation.updateMany({
        where: { orderId: order.id, status: "reserved" },
        data: { stripeCheckoutSessionId: session.id }
      });
      return tx.storefrontOrder.update({
        where: { id: order.id },
        data: { stripeCheckoutSessionId: session.id },
        include: storefrontOrderInclude
      });
    });
    return { order: storefrontOrderToDTO(updated), checkoutUrl: session.url };
  } catch (error) {
    if (createdSession?.id) {
      try {
        await stripe.checkout.sessions.expire(createdSession.id);
      } catch {
        // The session may already be complete or expired; local holds are still released below.
      }
    }
    await releaseReservationsForSession(createdSession?.id ?? null, order.id);
    await prisma.storefrontOrder.update({
      where: { id: order.id },
      data: {
        status: "canceled",
        paymentStatus: "failed",
        canceledAt: new Date(),
        notes: `Stripe Checkout session creation failed: ${error instanceof Error ? error.message.slice(0, 240) : "unknown error"}`
      }
    });
    throw error;
  }
}

export async function createInvoiceRequest(input: {
  items: Array<{ id: string; quantity: number }>;
  fulfillmentMethod: "shipping" | "pickup";
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  customerNotes?: string | null;
}) {
  const settings = await getStorefrontSettings();
  const cart = await getCartProducts(input.items);
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCalculation = calculateCartShipping(
    cart.map(({ item, quantity }) => ({ ...item, quantity })),
    { subtotal, freeShippingThreshold: settings.freeShippingThreshold, fulfillmentMethod: input.fulfillmentMethod }
  );
  const selectedShipping = shippingCalculation.defaultShippingOption;
  if (!selectedShipping) throw new Error("No safe shipping option is available for this cart. Use Request Invoice for manual review.");
  if (input.fulfillmentMethod === "shipping" && selectedShipping.id === "local_pickup") {
    throw new Error("Shipping is not available for one or more cart items.");
  }
  if (input.fulfillmentMethod === "pickup" && selectedShipping.id !== "local_pickup") {
    throw new Error("Local pickup is not available for one or more cart items.");
  }
  const shippingCharged = selectedShipping.amount;
  const total = subtotal + shippingCharged;
  const customer = await prisma.storefrontCustomer.upsert({
    where: { email: input.customerEmail },
    create: {
      email: input.customerEmail,
      name: input.customerName,
      phone: input.customerPhone || null,
      userId: cart[0]?.item.userId ?? null
    },
    update: {
      name: input.customerName,
      phone: input.customerPhone || undefined
    }
  });
  const noteLines = [
    "Public storefront invoice request.",
    "Confirm availability and payment manually before fulfillment.",
    input.customerPhone ? `Customer phone: ${input.customerPhone}` : null,
    input.customerNotes ? `Customer notes: ${input.customerNotes}` : null
  ].filter(Boolean);
  const order = await prisma.storefrontOrder.create({
    data: {
      orderNumber: orderNumber(),
      userId: cart[0]?.item.userId ?? null,
      customerId: customer.id,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      customerPhone: input.customerPhone || null,
      status: "invoice_requested",
      paymentStatus: "invoice_requested",
      fulfillmentStatus: "unfulfilled",
      subtotal,
      shippingCharged,
      shippingMethodLabel: selectedShipping.label,
      shippingRateSource: selectedShipping.rateSource,
      shippingPackageWeightOz: shippingCalculation.totalWeightOz,
      shippingPackageProfile: shippingCalculation.packageProfile,
      shippingWarnings: stringifyList(shippingCalculation.warnings),
      total,
      notes: noteLines.join("\n"),
      items: {
        create: cart.map(({ product, item, quantity }) => ({
          inventoryItemId: item.id,
          publicTitle: product.title,
          publicSlug: product.slug,
          imageUrl: product.imageUrl,
          quantity,
          unitPrice: product.price,
          lineTotal: product.price * quantity
        }))
      }
    },
    include: storefrontOrderInclude
  });
  await createStorefrontOrderAlert(order, {
    type: "invoice_request",
    title: "New invoice request",
    reason: `Customer requested an invoice for ${order.orderNumber}. Review availability and contact the customer.`,
    priority: "MEDIUM",
    score: 82
  });
  return { order: storefrontOrderToDTO(order) };
}

export async function createContactMessage(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
}) {
  const settings = await prisma.storefrontSettings.findFirst({ orderBy: { updatedAt: "desc" } });
  const contactEmail = storefrontContactEmail(settings?.contactEmail);
  const customer = await prisma.storefrontCustomer.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      userId: settings?.userId ?? null
    },
    update: {
      name: input.name
    }
  });
  const noteLines = [
    "Public storefront contact message.",
    `Subject: ${input.subject}`,
    `From: ${input.name} <${input.email}>`,
    "",
    input.message
  ];
  const order = await prisma.storefrontOrder.create({
    data: {
      orderNumber: inquiryNumber(),
      userId: settings?.userId ?? null,
      customerId: customer.id,
      customerEmail: input.email,
      customerName: input.name,
      status: "contact_message",
      paymentStatus: "not_applicable",
      fulfillmentStatus: "inquiry",
      notes: noteLines.join("\n")
    },
    include: storefrontOrderInclude
  });

  let emailSent = false;
  let emailError: string | null = null;
  if (contactEmail) {
    try {
      emailSent = await sendStorefrontEmail(
        contactEmail,
        `GameDayGrabs contact: ${input.subject}`,
        `${input.name} <${input.email}> sent a storefront message.\n\n${input.message}\n\nInquiry: ${order.orderNumber}`
      );
    } catch (error) {
      emailError = error instanceof Error ? error.message.slice(0, 240) : "SMTP send failed.";
      await prisma.storefrontOrder.update({
        where: { id: order.id },
        data: { notes: `${order.notes}\n\nEmail delivery failed: ${emailError}` }
      });
    }
  }

  return {
    order: storefrontOrderToDTO(order),
    emailSent,
    stored: true,
    delivery: emailSent ? "email_sent" : emailError ? "stored_email_failed" : contactEmail ? "stored_smtp_missing" : "stored_contact_email_missing",
    message: emailSent
      ? "Thanks. Your message was sent to GameDayGrabs."
      : "Thanks. Your message was saved and GameDayGrabs will review it."
  };
}

function lotUnitCost(lot: { costPerUnit: number; totalCost: number; quantity: number }) {
  if (lot.quantity > 0 && lot.totalCost > 0) return lot.totalCost / lot.quantity;
  return lot.costPerUnit;
}

async function createStorefrontOrderAlert(
  order: Pick<StorefrontOrderWithItems, "id" | "orderNumber" | "userId" | "customerEmail" | "customerName" | "total">,
  input: {
    type: "paid" | "invoice_request" | "payment_failed" | "checkout_expired" | "inventory_issue" | "sold_out_after_order" | "canceled" | "refunded" | "partially_refunded";
    title: string;
    reason: string;
    priority?: "LOW" | "MEDIUM" | "HIGH";
    score?: number;
  }
) {
  const dedupeKey = `storefront-order:${order.id}:${input.type}`;
  const existing = await prisma.alert.findFirst({ where: { dedupeKey } });
  if (existing) return existing;
  return prisma.alert.create({
    data: {
      title: input.title,
      reason: input.reason,
      priority: input.priority ?? "HIGH",
      entityType: "STOREFRONT_ORDER",
      entityId: order.id,
      actionUrl: "/?tab=orders",
      read: false,
      score: input.score ?? 90,
      dedupeKey,
      explanation: `Order ${order.orderNumber} for ${order.customerName || order.customerEmail || "customer"} totals $${order.total.toFixed(2)}.`,
      userId: order.userId
    }
  });
}

function canceledOrRefundedOrderAlertInput(order: Pick<StorefrontOrderWithItems, "orderNumber" | "status" | "paymentStatus" | "fulfillmentStatus">) {
  if (order.paymentStatus === "refunded" || order.status === "refunded") {
    return {
      type: "refunded" as const,
      title: "Order refunded",
      reason: `Storefront order ${order.orderNumber} was refunded and removed from active fulfillment alerts.`
    };
  }
  if (order.paymentStatus === "partially_refunded" || order.status === "partially_refunded") {
    return {
      type: "partially_refunded" as const,
      title: "Order partially refunded",
      reason: `Storefront order ${order.orderNumber} was partially refunded and removed from active fulfillment alerts.`
    };
  }
  if (order.status === "canceled" || order.fulfillmentStatus === "canceled") {
    return {
      type: "canceled" as const,
      title: "Order canceled",
      reason: `Storefront order ${order.orderNumber} was canceled and removed from active fulfillment alerts.`
    };
  }
  return null;
}

async function reconcileCanceledOrRefundedOrderAlerts(order: StorefrontOrderWithItems) {
  const statusAlert = canceledOrRefundedOrderAlertInput(order);
  if (!statusAlert) return;
  const now = new Date();
  await prisma.alert.updateMany({
    where: {
      dedupeKey: `storefront-order:${order.id}:paid`,
      suppressedAt: null
    },
    data: {
      read: true,
      suppressedAt: now,
      cooldownUntil: now,
      explanation: `Order ${order.orderNumber} is no longer an active paid fulfillment order.`
    }
  });
  await createStorefrontOrderAlert(order, {
    ...statusAlert,
    priority: "MEDIUM",
    score: 72
  });
}

async function createStorefrontSale(order: StorefrontOrderWithItems) {
  const paidAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.storefrontOrder.updateMany({
      where: { id: order.id, paymentStatus: { not: "paid" } },
      data: {
        status: "paid",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        paidAt
      }
    });
    if (claimed.count === 0) return { created: false, allocationIssues: [] as string[], inventoryReviewIssues: [] as string[], lateReservationWarnings: [] as string[] };

    let orderCostBasis = 0;
    const allocationIssues: string[] = [];
    const inventoryReviewIssues: string[] = [];
    const lateReservationWarnings: string[] = [];
    const reservationWasActiveAtPayment =
      order.reservations.length === 0 || order.reservations.some((reservation) => reservation.status === "reserved" && reservation.expiresAt > paidAt);

    for (const orderItem of order.items) {
      const inventory = await tx.inventoryItem.findUnique({
        where: { id: orderItem.inventoryItemId },
        include: { stockLots: true, sales: true }
      });
      if (!inventory) {
        inventoryReviewIssues.push(`${orderItem.publicTitle} is no longer present in inventory. Review before fulfillment.`);
        continue;
      }
      const availableForFinalization = inventory.stockLots.length
        ? inventory.stockLots.reduce((sum, lot) => sum + Math.max(0, lot.remainingQuantity), 0)
        : Math.max(0, inventory.quantity - inventory.sales.reduce((sum, sale) => sum + sale.quantitySold, 0));
      if (orderItem.quantity > availableForFinalization) {
        inventoryReviewIssues.push(
          `${orderItem.publicTitle} paid after the checkout hold was unavailable. Requested ${orderItem.quantity}, available ${availableForFinalization}.`
        );
      }
    }

    if (inventoryReviewIssues.length) {
      await tx.storefrontOrder.update({
        where: { id: order.id },
        data: {
          status: "inventory_review",
          paymentStatus: "paid",
          fulfillmentStatus: "review_required",
          paidAt,
          notes: [
            order.notes,
            "Payment completed, but stock could not be safely finalized without review. Do not fulfill until inventory is reconciled."
          ]
            .filter(Boolean)
            .join("\n")
        }
      });
      return { created: false, allocationIssues, inventoryReviewIssues, lateReservationWarnings };
    }

    if (!reservationWasActiveAtPayment) {
      lateReservationWarnings.push(
        `Storefront order ${order.orderNumber} completed payment after the 15-minute reservation window. Stock was still available and was finalized.`
      );
    }

    for (const orderItem of order.items) {
      const inventory = await tx.inventoryItem.findUnique({
        where: { id: orderItem.inventoryItemId },
        include: { stockLots: { orderBy: { purchasedAt: "asc" } }, sales: true }
      });
      if (!inventory) continue;
      let remainingToAllocate = orderItem.quantity;
      let costBasis = 0;
      for (const lot of inventory.stockLots.filter((stockLot) => stockLot.remainingQuantity > 0)) {
        if (remainingToAllocate <= 0) break;
        const quantityFromLot = Math.min(remainingToAllocate, lot.remainingQuantity);
        costBasis += quantityFromLot * lotUnitCost(lot);
        remainingToAllocate -= quantityFromLot;
        await tx.inventoryStockLot.update({
          where: { id: lot.id },
          data: { remainingQuantity: lot.remainingQuantity - quantityFromLot }
        });
      }
      if (remainingToAllocate > 0) {
        costBasis += remainingToAllocate * inventory.cost;
        allocationIssues.push(
          `${remainingToAllocate} unit${remainingToAllocate === 1 ? "" : "s"} for ${orderItem.publicTitle} were sold without enough remaining stock lots. Review cost basis and stock immediately.`
        );
      }
      const allocatedShipping = order.subtotal > 0 ? (orderItem.lineTotal / order.subtotal) * order.shippingCharged : 0;
      const allocatedStripeFee = order.subtotal > 0 ? (orderItem.lineTotal / order.subtotal) * order.stripeFeeEstimate : 0;
      const netSale = orderItem.lineTotal + allocatedShipping - allocatedStripeFee;
      const profitLoss = netSale - costBasis;
      await tx.inventorySale.create({
        data: {
          inventoryItemId: inventory.id,
          userId: inventory.userId,
          quantitySold: orderItem.quantity,
          soldPricePerItem: orderItem.unitPrice,
          grossSale: orderItem.lineTotal,
          platform: "website",
          fees: allocatedStripeFee,
          shippingCost: 0,
          netSale,
          costBasis,
          profitLoss,
          roiPercent: costBasis > 0 ? (profitLoss / costBasis) * 100 : null,
          soldAt: paidAt,
          notes: [`Storefront order ${order.orderNumber}`, `Storefront order id: ${order.id}`].join("\n")
        }
      });
      await tx.storefrontOrderItem.update({
        where: { id: orderItem.id },
        data: { costBasis, profitLoss }
      });
      orderCostBasis += costBasis;
    }
    const netProfit = order.total - order.stripeFeeEstimate - order.shippingCost - orderCostBasis;
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: {
        status: "paid",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        costBasis: orderCostBasis,
        netProfit,
        roiPercent: orderCostBasis > 0 ? (netProfit / orderCostBasis) * 100 : null,
        paidAt
      }
    });
    await completeReservationsForSessionInTransaction(tx, order.stripeCheckoutSessionId, order.id);
    return { created: true, allocationIssues, inventoryReviewIssues, lateReservationWarnings };
  });

  for (const reason of result.inventoryReviewIssues) {
    await createStorefrontOrderAlert(order, {
      type: "inventory_issue",
      title: "Paid order needs inventory review",
      reason,
      priority: "HIGH",
      score: 98
    });
  }
  if (!result.created) return;
  for (const reason of result.allocationIssues) {
    await createStorefrontOrderAlert(order, {
      type: "inventory_issue",
      title: "Inventory allocation issue",
      reason,
      priority: "HIGH",
      score: 95
    });
  }
  for (const reason of result.lateReservationWarnings) {
    await createStorefrontOrderAlert(order, {
      type: "inventory_issue",
      title: "Late checkout completion",
      reason,
      priority: "MEDIUM",
      score: 82
    });
  }
  await createStorefrontOrderAlert(order, {
    type: "paid",
    title: "New paid order",
    reason: `Stripe Checkout paid order ${order.orderNumber} is ready for fulfillment.`,
    priority: "HIGH",
    score: 96
  });
}

async function releaseOrderReservations(orderId: string) {
  return releaseReservationsForSession(null, orderId);
}

async function markStorefrontOrderPaymentFailed(order: StorefrontOrderWithItems, paymentStatus: "failed" | "expired", note?: string) {
  if (order.paymentStatus === "paid") return { released: 0, skipped: "already_paid" as const };
  const released = await releaseReservationsForSession(order.stripeCheckoutSessionId, order.id);
  if (order.paymentStatus === paymentStatus) return { released: released.count, skipped: "already_marked" as const };
  await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: {
      status: "canceled",
      paymentStatus,
      canceledAt: new Date(),
      notes: note ? [order.notes, note].filter(Boolean).join("\n") : order.notes
    }
  });
  await createStorefrontOrderAlert(order, {
    type: paymentStatus === "expired" ? "checkout_expired" : "payment_failed",
    title: paymentStatus === "expired" ? "Checkout expired" : "Payment failed",
    reason: note || (paymentStatus === "expired" ? "Stripe Checkout expired before payment completed." : "Stripe payment failed."),
    priority: "MEDIUM",
    score: 75
  });
  return { released: released.count, skipped: null };
}

export async function expireOpenStripeSessionsForExpiredReservations(now = new Date()) {
  const expiredReservations = await prisma.stockReservation.findMany({
    where: { status: "reserved", expiresAt: { lte: now } },
    select: {
      orderId: true,
      stripeCheckoutSessionId: true,
      order: {
        select: {
          id: true,
          stripeCheckoutSessionId: true
        }
      }
    }
  });
  const groups = new Map<string, { orderId: string | null; stripeCheckoutSessionId: string | null }>();
  for (const reservation of expiredReservations) {
    const orderId = reservation.orderId ?? reservation.order?.id ?? null;
    const stripeCheckoutSessionId = reservation.stripeCheckoutSessionId ?? reservation.order?.stripeCheckoutSessionId ?? null;
    const key = stripeCheckoutSessionId ?? `order:${orderId ?? "unlinked"}`;
    groups.set(key, { orderId, stripeCheckoutSessionId });
  }

  const summary = {
    checkedReservations: expiredReservations.length,
    checkedSessions: groups.size,
    expiredStripeSessions: 0,
    releasedReservations: 0,
    completedSessionsSkipped: 0,
    errors: [] as string[]
  };
  let stripe: Stripe | null = null;

  for (const group of groups.values()) {
    const order = group.orderId
      ? await prisma.storefrontOrder.findUnique({ where: { id: group.orderId }, include: storefrontOrderInclude })
      : group.stripeCheckoutSessionId
        ? await prisma.storefrontOrder.findFirst({ where: { stripeCheckoutSessionId: group.stripeCheckoutSessionId }, include: storefrontOrderInclude })
        : null;

    if (order?.paymentStatus === "paid") {
      await completeReservationsForSession(group.stripeCheckoutSessionId, order.id);
      summary.completedSessionsSkipped += 1;
      continue;
    }

    if (!group.stripeCheckoutSessionId) {
      const released = await releaseReservationsForSession(null, group.orderId);
      summary.releasedReservations += released.count;
      continue;
    }

    try {
      stripe ??= stripeClient();
      const session = await stripe.checkout.sessions.retrieve(group.stripeCheckoutSessionId);
      if (session.status === "complete" || session.payment_status === "paid") {
        summary.completedSessionsSkipped += 1;
        continue;
      }
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(group.stripeCheckoutSessionId);
        summary.expiredStripeSessions += 1;
      }

      if (order) {
        const result = await markStorefrontOrderPaymentFailed(order, "expired", "GameDayGrabs 15-minute checkout reservation expired.");
        summary.releasedReservations += result.released;
      } else {
        const released = await releaseReservationsForSession(group.stripeCheckoutSessionId, group.orderId);
        summary.releasedReservations += released.count;
      }
    } catch (error) {
      summary.errors.push(
        `Could not expire Stripe Checkout Session ${group.stripeCheckoutSessionId}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return summary;
}

export async function releaseUnpaidCheckoutOrder(orderId: string | null | undefined) {
  if (!orderId) return { ok: false, released: false, reason: "missing_order_id" };
  const order = await prisma.storefrontOrder.findUnique({
    where: { id: orderId },
    include: storefrontOrderInclude
  });
  if (!order) return { ok: false, released: false, reason: "order_not_found" };
  if (!order.stripeCheckoutSessionId) return { ok: true, released: false, reason: "not_stripe_checkout" };
  if (order.paymentStatus === "paid") return { ok: true, released: false, reason: "already_paid" };

  if (order.status === "canceled" || order.paymentStatus === "failed" || order.paymentStatus === "expired") {
    const released = await releaseOrderReservations(order.id);
    return { ok: true, released: released.count > 0, reason: "already_canceled" };
  }

  await markStorefrontOrderPaymentFailed(order, "failed", "Stripe Checkout was canceled before payment completed.");
  return { ok: true, released: true, reason: "checkout_canceled" };
}

async function orderForStripeEvent(event: Stripe.Event) {
  const object = event.data.object;
  const metadata = "metadata" in object ? object.metadata : null;
  const orderId = typeof metadata?.orderId === "string" ? metadata.orderId : null;
  if (orderId) {
    return prisma.storefrontOrder.findUnique({ where: { id: orderId }, include: storefrontOrderInclude });
  }
  if (event.type.startsWith("checkout.session.") && "id" in object && typeof object.id === "string") {
    return prisma.storefrontOrder.findFirst({ where: { stripeCheckoutSessionId: object.id }, include: storefrontOrderInclude });
  }
  if (event.type === "payment_intent.payment_failed" && "id" in object && typeof object.id === "string") {
    return prisma.storefrontOrder.findFirst({ where: { stripePaymentIntentId: object.id }, include: storefrontOrderInclude });
  }
  return null;
}

type StripeAddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

type StripeShippingLike = {
  name?: string | null;
  phone?: string | null;
  address?: StripeAddressLike | null;
};

type StripeCheckoutSessionWithCollected = Stripe.Checkout.Session & {
  shipping_details?: StripeShippingLike | null;
  collected_information?: { shipping_details?: StripeShippingLike | null } | null;
};

type StripeCheckoutSessionWithShipping = Stripe.Checkout.Session & {
  shipping_cost?: {
    amount_total?: number | null;
    shipping_rate?: string | Stripe.ShippingRate | null;
  } | null;
  total_details?: {
    amount_shipping?: number | null;
  } | null;
};

type CheckoutCustomerSnapshot = {
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  shippingDetails: StripeShippingLike | null;
  shippingAddress: StripeAddressLike | null;
  billingAddress: StripeAddressLike | null;
};

type CheckoutShippingSnapshot = {
  shippingCharged: number | null;
  shippingMethodLabel: string | null;
  shippingRateSource: string | null;
  shippingPackageWeightOz: number | null;
  shippingPackageProfile: string | null;
  shippingWarnings: string[];
};

function stripeId(value: string | { id?: string | null } | null | undefined) {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function normalizedCustomerEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

function stripeAddressIsPresent(address: StripeAddressLike | null | undefined) {
  return Boolean(address?.line1 || address?.city || address?.postal_code || address?.country);
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stripeIdFromUnknown(value: unknown) {
  if (typeof value === "string") return value;
  const record = recordValue(value);
  return stringValue(record?.id);
}

function safeStripeEventPayload(event: Stripe.Event, orderId: string | null) {
  const object = event.data.object as unknown as Record<string, unknown>;
  const customerDetails = recordValue(object.customer_details);
  const safePayload = {
    provider: "stripe",
    eventId: event.id,
    eventType: event.type,
    objectId: stringValue(object.id),
    objectType: stringValue(object.object),
    orderId,
    checkoutSessionId: event.type.startsWith("checkout.session.") ? stringValue(object.id) : null,
    paymentIntentId: stripeIdFromUnknown(object.payment_intent) ?? stringValue(object.id),
    stripeCustomerId: stripeIdFromUnknown(object.customer),
    paymentStatus: stringValue(object.payment_status),
    checkoutStatus: stringValue(object.status),
    customerEmail: normalizedCustomerEmail(stringValue(customerDetails?.email) ?? stringValue(object.customer_email)),
    customerPhone: stringValue(customerDetails?.phone),
    amountTotal: numberValue(object.amount_total),
    amount: numberValue(object.amount),
    currency: stringValue(object.currency)?.toLowerCase() ?? null
  };
  return JSON.stringify(safePayload);
}

async function upsertSafePaymentEvent(event: Stripe.Event, orderId: string | null) {
  return prisma.paymentEvent.upsert({
    where: { eventId: event.id },
    create: {
      orderId,
      eventId: event.id,
      eventType: event.type,
      payload: safeStripeEventPayload(event, orderId)
    },
    update: {
      ...(orderId ? { orderId } : {}),
      eventType: event.type,
      payload: safeStripeEventPayload(event, orderId)
    }
  });
}

function checkoutCustomerSnapshot(session: Stripe.Checkout.Session, order: StorefrontOrderWithItems): CheckoutCustomerSnapshot {
  const sessionWithCollected = session as StripeCheckoutSessionWithCollected;
  const shippingDetails = sessionWithCollected.shipping_details ?? sessionWithCollected.collected_information?.shipping_details ?? null;
  const shippingAddress = shippingDetails?.address ?? null;
  const billingAddress = (session.customer_details?.address ?? null) as StripeAddressLike | null;
  const customerEmail = normalizedCustomerEmail(session.customer_details?.email ?? session.customer_email ?? order.customerEmail);
  const customerName = session.customer_details?.name ?? shippingDetails?.name ?? order.customerName;
  const customerPhone = session.customer_details?.phone ?? shippingDetails?.phone ?? order.customerPhone ?? null;
  return {
    customerEmail,
    customerName,
    customerPhone,
    stripeCustomerId: stripeId(session.customer),
    stripePaymentIntentId: stripeId(session.payment_intent),
    shippingDetails,
    shippingAddress,
    billingAddress
  };
}

function storefrontCustomerShippingSnapshot(snapshot: CheckoutCustomerSnapshot) {
  return {
    defaultShippingName: snapshot.shippingDetails?.name ?? snapshot.customerName ?? null,
    defaultShippingLine1: snapshot.shippingAddress?.line1 ?? null,
    defaultShippingLine2: snapshot.shippingAddress?.line2 ?? null,
    defaultShippingCity: snapshot.shippingAddress?.city ?? null,
    defaultShippingState: snapshot.shippingAddress?.state ?? null,
    defaultShippingPostalCode: snapshot.shippingAddress?.postal_code ?? null,
    defaultShippingCountry: snapshot.shippingAddress?.country ?? null
  };
}

function stripeShippingRateSnapshot(rate: Stripe.ShippingRate | null, fallback: CheckoutShippingSnapshot): CheckoutShippingSnapshot {
  if (!rate) return fallback;
  const metadata = rate.metadata ?? {};
  const weight = Number(metadata.shippingPackageWeightOz);
  const metadataWarnings = parseList(metadata.shippingWarnings);
  return {
    shippingCharged: fallback.shippingCharged,
    shippingMethodLabel: metadata.shippingOptionLabel || rate.display_name || fallback.shippingMethodLabel,
    shippingRateSource: "stripe_checkout",
    shippingPackageWeightOz: Number.isFinite(weight) ? weight : fallback.shippingPackageWeightOz,
    shippingPackageProfile: metadata.shippingPackageProfile || fallback.shippingPackageProfile,
    shippingWarnings: metadataWarnings.length ? metadataWarnings : fallback.shippingWarnings
  };
}

async function checkoutShippingSnapshot(session: Stripe.Checkout.Session, order: StorefrontOrderWithItems): Promise<CheckoutShippingSnapshot> {
  const sessionWithShipping = session as StripeCheckoutSessionWithShipping;
  const shippingCost = sessionWithShipping.shipping_cost ?? null;
  const shippingCents =
    typeof shippingCost?.amount_total === "number"
      ? shippingCost.amount_total
      : typeof sessionWithShipping.total_details?.amount_shipping === "number"
        ? sessionWithShipping.total_details.amount_shipping
        : null;
  let snapshot: CheckoutShippingSnapshot = {
    shippingCharged: shippingCents === null ? null : moneyFromCents(shippingCents),
    shippingMethodLabel: order.shippingMethodLabel,
    shippingRateSource: shippingCents === null ? order.shippingRateSource : "stripe_checkout",
    shippingPackageWeightOz: order.shippingPackageWeightOz,
    shippingPackageProfile: order.shippingPackageProfile,
    shippingWarnings: parseList(order.shippingWarnings)
  };

  const shippingRate = shippingCost?.shipping_rate ?? null;
  if (shippingRate && typeof shippingRate !== "string") {
    return stripeShippingRateSnapshot(shippingRate, snapshot);
  }
  if (typeof shippingRate === "string") {
    try {
      const rate = await stripeClient().shippingRates.retrieve(shippingRate);
      snapshot = stripeShippingRateSnapshot(rate, snapshot);
    } catch {
      snapshot = {
        ...snapshot,
        shippingRateSource: "stripe_checkout",
        shippingWarnings: [...snapshot.shippingWarnings, "Stripe shipping rate details were not retrieved; using the checkout shipping amount."]
      };
    }
  }
  return snapshot;
}

async function syncStorefrontCustomerTotals(customerId: string, customerEmail: string) {
  const paidOrders = await prisma.storefrontOrder.findMany({
    where: { customerEmail, paymentStatus: { in: activeRevenuePaymentStatuses } },
    select: { total: true, refundedAmount: true, paidAt: true, createdAt: true }
  });
  const paidDates = paidOrders
    .map((order) => order.paidAt ?? order.createdAt)
    .sort((left, right) => left.getTime() - right.getTime());
  await prisma.storefrontCustomer.update({
    where: { id: customerId },
    data: {
      totalOrders: paidOrders.filter((order) => storefrontOrderNetRevenue(order) > 0).length,
      totalSpent: paidOrders.reduce((sum, order) => sum + storefrontOrderNetRevenue(order), 0),
      firstOrderAt: paidDates[0] ?? null,
      lastOrderAt: paidDates.at(-1) ?? null
    }
  });
}

async function persistPaidCheckoutSession(order: StorefrontOrderWithItems, session: Stripe.Checkout.Session) {
  const snapshot = checkoutCustomerSnapshot(session, order);
  const shippingSnapshot = await checkoutShippingSnapshot(session, order);
  const shippingCharged = shippingSnapshot.shippingCharged ?? order.shippingCharged;
  const total = typeof session.amount_total === "number" ? moneyFromCents(session.amount_total) : order.subtotal + shippingCharged + order.tax;
  const customer = snapshot.customerEmail
    ? await prisma.storefrontCustomer.upsert({
        where: { email: snapshot.customerEmail },
        create: {
          email: snapshot.customerEmail,
          name: snapshot.customerName,
          phone: snapshot.customerPhone,
          stripeCustomerId: snapshot.stripeCustomerId,
          userId: order.userId,
          ...storefrontCustomerShippingSnapshot(snapshot)
        },
        update: {
          name: snapshot.customerName ?? undefined,
          phone: snapshot.customerPhone ?? undefined,
          stripeCustomerId: snapshot.stripeCustomerId ?? undefined,
          ...(stripeAddressIsPresent(snapshot.shippingAddress) ? storefrontCustomerShippingSnapshot(snapshot) : {})
        }
      })
    : null;
  const updated = await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: {
      customerId: customer?.id ?? order.customerId,
      customerEmail: snapshot.customerEmail,
      customerName: snapshot.customerName,
      customerPhone: snapshot.customerPhone,
      shippingName: snapshot.shippingDetails?.name ?? snapshot.customerName ?? null,
      shippingLine1: snapshot.shippingAddress?.line1 ?? null,
      shippingLine2: snapshot.shippingAddress?.line2 ?? null,
      shippingCity: snapshot.shippingAddress?.city ?? null,
      shippingState: snapshot.shippingAddress?.state ?? null,
      shippingPostalCode: snapshot.shippingAddress?.postal_code ?? null,
      shippingCountry: snapshot.shippingAddress?.country ?? null,
      billingName: session.customer_details?.name ?? snapshot.customerName ?? null,
      billingLine1: snapshot.billingAddress?.line1 ?? null,
      billingLine2: snapshot.billingAddress?.line2 ?? null,
      billingCity: snapshot.billingAddress?.city ?? null,
      billingState: snapshot.billingAddress?.state ?? null,
      billingPostalCode: snapshot.billingAddress?.postal_code ?? null,
      billingCountry: snapshot.billingAddress?.country ?? null,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: snapshot.stripePaymentIntentId ?? order.stripePaymentIntentId,
      shippingCharged,
      shippingMethodLabel: shippingSnapshot.shippingMethodLabel,
      shippingRateSource: shippingSnapshot.shippingRateSource ?? "stripe_checkout",
      shippingPackageWeightOz: shippingSnapshot.shippingPackageWeightOz,
      shippingPackageProfile: shippingSnapshot.shippingPackageProfile,
      shippingWarnings: stringifyList(shippingSnapshot.shippingWarnings),
      total,
      stripeFeeEstimate: estimateStripeFee(total)
    },
    include: storefrontOrderInclude
  });
  return { customer, order: updated, customerEmail: snapshot.customerEmail };
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const secret = envValue("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signature) throw new Error("Missing Stripe webhook signature.");
  const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  let order = await orderForStripeEvent(event);
  await upsertSafePaymentEvent(event, order?.id ?? null);
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!order) return { ok: true, skipped: "order_not_found" };
    if (session.payment_status !== "paid") return { ok: true, skipped: "checkout_session_not_paid" };
    const wasPaid = order.paymentStatus === "paid";
    const persisted = await persistPaidCheckoutSession(order, session);
    order = persisted.order;
    if (!wasPaid && order.paymentStatus !== "paid") await createStorefrontSale(order);
    if (persisted.customer && persisted.customerEmail) await syncStorefrontCustomerTotals(persisted.customer.id, persisted.customerEmail);
    return { ok: true };
  }
  if (event.type === "checkout.session.expired" && order) {
    await markStorefrontOrderPaymentFailed(order, "expired", "Stripe Checkout session expired before payment completed.");
  }
  if ((event.type === "checkout.session.async_payment_failed" || event.type === "payment_intent.payment_failed") && order) {
    const failureMessage =
      event.type === "payment_intent.payment_failed"
        ? ((event.data.object as Stripe.PaymentIntent).last_payment_error?.message ?? "Stripe payment failed.")
        : "Stripe asynchronous payment failed.";
    await markStorefrontOrderPaymentFailed(order, "failed", failureMessage);
  }
  return { ok: true };
}

export async function updateInventoryStoreListing(
  currentUser: SessionUser,
  itemId: string,
  input: {
    publishToStore: boolean;
    publicSlug?: string;
    publicTitle?: string;
    publicDescription?: string;
    publicPrice?: number;
    compareAtPrice?: number;
    publicImages?: unknown;
    availableForSale?: number;
    maxQuantityPerOrder: number;
    shippingProfile: string;
    packageWeightOz?: number | null;
    packageLengthIn?: number | null;
    packageWidthIn?: number | null;
    packageHeightIn?: number | null;
    freeShippingEligible?: boolean;
    requiresBox?: boolean;
    insuranceRecommended?: boolean;
    storeStatus: "draft" | "active" | "hidden" | "sold_out";
    localPickupAvailable: boolean;
    shippingAvailable: boolean;
    storefrontCategory?: string;
    storefrontTags?: unknown;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: storefrontInventoryInclude
  });
  if (!item) throw new Error("Inventory item not found");
  const publicTitle = cleanStorefrontTitle(input.publicTitle || item.publicTitle || item.itemName);
  const publicSlug = input.publicSlug ? await uniqueSlug(input.publicSlug, item.id) : item.publicSlug || (input.publishToStore ? await uniqueSlug(publicTitle, item.id) : null);
  const publicImageList = stringifyList(input.publicImages) ?? stringifyList(publicImages(item));
  const storefrontCategory = input.storefrontCategory || item.storefrontCategory || publicCategoryForItem(item);
  const publicDescription = cleanStorefrontDescription({
    title: publicTitle,
    itemName: item.itemName,
    brand: item.brand,
    category: storefrontCategory,
    setName: item.setName,
    publicDescription: input.publicDescription ?? item.publicDescription,
    description: item.description,
    status: input.storeStatus,
    availableQuantity: input.availableForSale ?? item.availableForSale
  });
  const publicPrice = input.publicPrice ?? publicListingPrice(item) ?? undefined;
  const availableForSale = input.availableForSale === undefined ? item.availableForSale ?? sellableQuantity(item) : input.availableForSale;
  const normalizedStoreStatus = input.publishToStore && availableForSale <= 0 ? "sold_out" : input.storeStatus;
  const isPublicStatus = ["active", "sold_out"].includes(normalizedStoreStatus);
  const shouldStampPublishedAt = input.publishToStore && isPublicStatus && !item.publishedAt;

  if (isPublicStatus && (!publicPrice || publicPrice <= 0)) {
    throw new Error("Set a public price before activating a store listing.");
  }

  return prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      publishToStore: input.publishToStore,
      publicSlug,
      publicTitle,
      publicDescription,
      publicPrice,
      compareAtPrice: input.compareAtPrice,
      publicImages: publicImageList,
      availableForSale,
      maxQuantityPerOrder: input.maxQuantityPerOrder,
      shippingProfile: input.shippingProfile,
      packageWeightOz: input.packageWeightOz,
      packageLengthIn: input.packageLengthIn,
      packageWidthIn: input.packageWidthIn,
      packageHeightIn: input.packageHeightIn,
      freeShippingEligible: input.freeShippingEligible,
      requiresBox: input.requiresBox,
      insuranceRecommended: input.insuranceRecommended,
      storeStatus: normalizedStoreStatus,
      localPickupAvailable: input.localPickupAvailable,
      shippingAvailable: input.shippingAvailable,
      storefrontCategory,
      storefrontTags: stringifyList(input.storefrontTags),
      publishedAt: shouldStampPublishedAt ? new Date() : item.publishedAt
    },
    include: storefrontInventoryInclude
  });
}

export async function bulkPublishInventoryStoreListings(
  currentUser: SessionUser,
  input: { mode: "selected" | "eligible"; itemIds?: string[] }
) {
  if (input.mode === "selected" && !input.itemIds?.length) {
    throw new Error("Select at least one inventory product to publish.");
  }
  const scope: Prisma.InventoryItemWhereInput = { OR: [{ userId: null }, { userId: currentUser.id }] };
  const items = await prisma.inventoryItem.findMany({
    where: input.mode === "selected" ? { ...scope, id: { in: input.itemIds ?? [] } } : scope,
    include: storefrontInventoryInclude,
    orderBy: { updatedAt: "desc" },
    take: 250
  });
  const updated: Array<{ id: string; itemName: string; publicSlug: string | null }> = [];
  const skipped: Array<{ id: string; itemName: string; reason: string }> = [];

  for (const item of items) {
    const availableForSale = sellableQuantity(item);
    const price = publicListingPrice(item);
    const images = publicImages(item);
    if (!price || price <= 0) {
      skipped.push({ id: item.id, itemName: item.itemName, reason: "Public price missing" });
      continue;
    }
    if (!images.length) {
      skipped.push({ id: item.id, itemName: item.itemName, reason: "Product image missing" });
      continue;
    }
    const publicTitle = cleanStorefrontTitle(item.publicTitle || item.itemName);
    const publicSlug = item.publicSlug || await uniqueSlug(publicTitle, item.id);
    const storeStatus = availableForSale > 0 ? "active" : "sold_out";
    const storefrontCategory = item.storefrontCategory || publicCategoryForItem(item);
    const result = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        publishToStore: true,
        publicSlug,
        publicTitle,
        publicDescription: cleanStorefrontDescription({
          title: publicTitle,
          itemName: item.itemName,
          brand: item.brand,
          category: storefrontCategory,
          setName: item.setName,
          publicDescription: item.publicDescription,
          description: item.description,
          status: storeStatus,
          availableQuantity: availableForSale
        }),
        publicPrice: price,
        publicImages: stringifyList(images),
        availableForSale,
        maxQuantityPerOrder: item.maxQuantityPerOrder || 4,
        shippingProfile: item.shippingProfile || "standard",
        packageWeightOz: item.packageWeightOz,
        packageLengthIn: item.packageLengthIn,
        packageWidthIn: item.packageWidthIn,
        packageHeightIn: item.packageHeightIn,
        freeShippingEligible: item.freeShippingEligible,
        requiresBox: item.requiresBox,
        insuranceRecommended: item.insuranceRecommended,
        storeStatus,
        localPickupAvailable: item.localPickupAvailable,
        shippingAvailable: item.shippingAvailable,
        storefrontCategory,
        storefrontTags: item.storefrontTags || stringifyList([storefrontCategory, item.setName || "", item.brand || ""].filter(Boolean)),
        publishedAt: item.publishedAt ?? new Date()
      },
      select: { id: true, itemName: true, publicSlug: true }
    });
    updated.push(result);
  }

  return {
    updatedCount: updated.length,
    skippedCount: skipped.length,
    updated,
    skipped
  };
}

export async function listStorefrontOrders(currentUser: SessionUser) {
  const orders = await prisma.storefrontOrder.findMany({
    where: currentUser.role === "ADMIN" ? {} : { userId: currentUser.id },
    include: storefrontOrderInclude,
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return orders.map(storefrontOrderToDTO);
}

export async function storefrontSummary(currentUser: SessionUser): Promise<StorefrontSummaryDTO> {
  const where = currentUser.role === "ADMIN" ? {} : { userId: currentUser.id };
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [productCount, activeProductCount, pendingOrderCount, inquiryCount, newPaidOrderCount, ordersToShipCount, paidOrders, todayPaidOrders, lastPaidOrder, lastWebhook] = await Promise.all([
    prisma.inventoryItem.count({ where: { ...(where as Prisma.InventoryItemWhereInput), publishToStore: true } }),
    prisma.inventoryItem.count({
      where: {
        ...(where as Prisma.InventoryItemWhereInput),
        publishToStore: true,
        storeStatus: { in: ["active", "sold_out"] }
      }
    }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), status: "pending_payment" } }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), status: { in: ["invoice_requested", "contact_message"] } } }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid", fulfillmentStatus: "unfulfilled" } }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid", fulfillmentStatus: { in: ["unfulfilled", "packing", "pickup_ready"] } } }),
    prisma.storefrontOrder.findMany({
      where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: { in: activeRevenuePaymentStatuses } },
      select: { total: true, refundedAmount: true, stripeFeeEstimate: true, shippingCost: true, costBasis: true, netProfit: true, paidAt: true }
    }),
    prisma.storefrontOrder.findMany({
      where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: { in: activeRevenuePaymentStatuses }, paidAt: { gte: todayStart } },
      select: { total: true, refundedAmount: true }
    }),
    prisma.storefrontOrder.findFirst({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: { in: activeRevenuePaymentStatuses } }, orderBy: { paidAt: "desc" }, select: { paidAt: true } }),
    prisma.paymentEvent.findFirst({
      where: currentUser.role === "ADMIN" ? {} : { order: { userId: currentUser.id } },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true }
    })
  ]);
  return {
    productCount,
    activeProductCount,
    pendingOrderCount,
    inquiryCount,
    paidOrderCount: paidOrders.filter((order) => storefrontOrderNetRevenue(order) > 0).length,
    newPaidOrderCount,
    ordersToShipCount,
    todaySales: todayPaidOrders.reduce((sum, order) => sum + storefrontOrderNetRevenue(order), 0),
    todayPaidOrderCount: todayPaidOrders.filter((order) => storefrontOrderNetRevenue(order) > 0).length,
    lastPaidOrderAt: lastPaidOrder?.paidAt?.toISOString() ?? null,
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
    totalRevenue: paidOrders.reduce((sum, order) => sum + storefrontOrderNetRevenue(order), 0),
    netProfit: paidOrders.reduce((sum, order) => sum + storefrontOrderNetProfitAfterRefund(order), 0)
  };
}

async function returnOrderInventory(tx: Prisma.TransactionClient, order: StorefrontOrderWithItems) {
  let returnedQuantity = 0;
  for (const orderItem of order.items) {
    const inventory = await tx.inventoryItem.findUnique({
      where: { id: orderItem.inventoryItemId },
      include: { stockLots: { orderBy: { purchasedAt: "asc" } } }
    });
    if (!inventory) continue;
    if (inventory.stockLots.length) {
      await tx.inventoryStockLot.update({
        where: { id: inventory.stockLots[0].id },
        data: { remainingQuantity: { increment: orderItem.quantity } }
      });
    } else {
      await tx.inventoryItem.update({
        where: { id: inventory.id },
        data: { quantity: { increment: orderItem.quantity } }
      });
    }
    returnedQuantity += orderItem.quantity;
  }
  await tx.stockReservation.updateMany({
    where: { orderId: order.id, status: "completed" },
    data: { status: "returned", releasedAt: new Date() }
  });
  return returnedQuantity;
}

export async function cancelOrRefundStorefrontOrder(currentUser: SessionUser, orderId: string, input: StorefrontCancelRefundInput) {
  const requestEventId = `admin.cancel_refund:${input.idempotencyKey}`;
  const existingRequest = await prisma.paymentEvent.findUnique({ where: { eventId: requestEventId } });
  if (existingRequest) {
    const existingOrder = await prisma.storefrontOrder.findFirst({
      where: { id: orderId, ...(currentUser.role === "ADMIN" ? {} : { userId: currentUser.id }) },
      include: storefrontOrderInclude
    });
    if (!existingOrder) throw new Error("Order not found");
    return storefrontOrderToDTO(existingOrder);
  }

  const order = await prisma.storefrontOrder.findFirst({
    where: { id: orderId, ...(currentUser.role === "ADMIN" ? {} : { userId: currentUser.id }) },
    include: storefrontOrderInclude
  });
  if (!order) throw new Error("Order not found");
  if (!orderCanCancelOrRefund(order)) throw new Error("This order is already canceled, refunded, or refunding.");

  const isPaidStripeOrder = order.paymentStatus === "paid" && Boolean(order.stripePaymentIntentId);
  if (input.refundType === "none" && isPaidStripeOrder) {
    throw new Error("Paid Stripe orders must use a full or partial refund.");
  }
  if (input.refundType !== "none" && !isPaidStripeOrder) {
    throw new Error("Stripe refund is only available for paid Stripe orders with a stored PaymentIntent.");
  }

  const remainingRefundableCents = orderRemainingRefundableCents(order);
  const refundCents =
    input.refundType === "full"
      ? remainingRefundableCents
      : input.refundType === "partial"
        ? centsFromMoney(input.partialRefundAmount ?? 0)
        : 0;
  if (input.refundType !== "none" && refundCents <= 0) throw new Error("No refundable balance remains for this order.");
  if (refundCents > remainingRefundableCents) throw new Error("Refund amount exceeds the remaining refundable order total.");

  const stripeRefund =
    refundCents > 0
      ? await stripeClient().refunds.create(
          {
            payment_intent: order.stripePaymentIntentId ?? undefined,
            amount: refundCents,
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              reason: input.reason
            }
          },
          { idempotencyKey: `storefront-cancel-refund:${input.idempotencyKey}` }
        )
      : null;
  const stripeRefundStatus = stripeRefund?.status ?? null;
  const totalCents = orderTotalCents(order);
  const newRefundedCents = orderRefundedCents(order) + refundCents;
  const paymentStatus =
    refundCents > 0 ? refundPaymentStatus(stripeRefundStatus, newRefundedCents, totalCents) : "not_applicable";
  const refundStatus = refundCents > 0 ? paymentStatus : "not_applicable";
  const refundedAt = refundCents > 0 && paymentStatus !== "refund_pending" && paymentStatus !== "refund_failed" ? new Date() : null;
  const reasonLabel = cancellationReasonLabels[input.reason];
  const requestedEmailStatus = input.sendCustomerEmail ? "pending" : "not_requested";

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.paymentEvent.findUnique({ where: { eventId: requestEventId } });
    if (duplicate) {
      const current = await tx.storefrontOrder.findUnique({ where: { id: order.id }, include: storefrontOrderInclude });
      if (!current) throw new Error("Order not found");
      return current;
    }

    const current = await tx.storefrontOrder.findUnique({ where: { id: order.id }, include: storefrontOrderInclude });
    if (!current) throw new Error("Order not found");
    if (!orderCanCancelOrRefund(current)) throw new Error("This order is already canceled, refunded, or refunding.");
    if (refundCents > orderRemainingRefundableCents(current)) {
      throw new Error("Refund amount exceeds the remaining refundable order total.");
    }

    const shouldReturnStock = input.returnItemsToStock && orderInventoryWasFinalized(current) && !current.stockReturnedAt;
    const returnedQuantity = shouldReturnStock ? await returnOrderInventory(tx, current) : 0;
    const stockReturnStatus = input.returnItemsToStock
      ? current.stockReturnedAt
        ? "already_returned"
        : shouldReturnStock
          ? "returned"
          : "not_applicable"
      : "not_returned";
    const cancellationNote = [
      `Cancellation reason: ${reasonLabel}`,
      input.adminNote ? `Admin note: ${input.adminNote}` : null,
      refundCents > 0 ? `Refund requested: $${moneyFromCents(refundCents).toFixed(2)}` : "Refund requested: none",
      `Inventory handling: ${stockReturnStatus}`,
      `Customer email: ${requestedEmailStatus}`
    ]
      .filter(Boolean)
      .join("\n");
    const updated = await tx.storefrontOrder.update({
      where: { id: current.id },
      data: {
        status: paymentStatus === "not_applicable" ? "canceled" : paymentStatus,
        paymentStatus,
        fulfillmentStatus: "canceled",
        canceledAt: current.canceledAt ?? new Date(),
        refundedAt,
        refundStatus,
        refundedAmount: moneyFromCents(newRefundedCents),
        refundCurrency: "usd",
        stripeRefundId: stripeRefund?.id ?? current.stripeRefundId,
        refundReason: reasonLabel,
        refundNote: input.adminNote,
        stockReturnStatus,
        stockReturnedAt: shouldReturnStock ? new Date() : current.stockReturnedAt,
        customerCancellationEmailStatus: requestedEmailStatus,
        notes: [current.notes, cancellationNote].filter(Boolean).join("\n\n")
      },
      include: storefrontOrderInclude
    });

    const payload = refundEventPayload({
      order: current,
      reason: input.reason,
      adminNote: input.adminNote,
      refundType: input.refundType,
      refundAmount: moneyFromCents(refundCents),
      stripeRefundId: stripeRefund?.id ?? null,
      stripeRefundStatus,
      returnItemsToStock: input.returnItemsToStock,
      stockReturnStatus,
      customerEmailStatus: requestedEmailStatus
    });
    await tx.paymentEvent.create({
      data: {
        orderId: current.id,
        provider: "admin",
        eventId: requestEventId,
        eventType: "admin.cancel_refund.started",
        payload
      }
    });
    if (refundCents > 0) {
      await tx.paymentEvent.create({
        data: {
          orderId: current.id,
          provider: "stripe",
          eventId: `admin.refund:${input.idempotencyKey}`,
          eventType: "admin.refund.created",
          payload
        }
      });
    }
    if (returnedQuantity > 0) {
      await tx.paymentEvent.create({
        data: {
          orderId: current.id,
          provider: "admin",
          eventId: `admin.inventory_return:${input.idempotencyKey}`,
          eventType: "admin.inventory.returned",
          payload: JSON.stringify({ orderId: current.id, orderNumber: current.orderNumber, returnedQuantity })
        }
      });
    }
    return updated;
  });

  let finalOrder = updatedOrder;
  if (input.sendCustomerEmail) {
    const settings = await getStorefrontSettings();
    const emailStatus = await sendStorefrontCancellationEmail({
      order: updatedOrder,
      reason: input.reason,
      adminNote: input.adminNote,
      refundAmount: moneyFromCents(refundCents),
      contactEmail: settings.contactEmail || "gamedaygrabs@outlook.com"
    });
    finalOrder = await prisma.storefrontOrder.update({
      where: { id: updatedOrder.id },
      data: {
        customerCancellationEmailStatus: emailStatus,
        customerCancellationEmailSentAt: emailStatus === "sent" ? new Date() : updatedOrder.customerCancellationEmailSentAt
      },
      include: storefrontOrderInclude
    });
    await prisma.paymentEvent.upsert({
      where: { eventId: `admin.cancellation_email:${input.idempotencyKey}` },
      create: {
        orderId: updatedOrder.id,
        provider: "admin",
        eventId: `admin.cancellation_email:${input.idempotencyKey}`,
        eventType: `admin.cancellation_email.${emailStatus}`,
        payload: JSON.stringify({ orderId: updatedOrder.id, orderNumber: updatedOrder.orderNumber, emailStatus })
      },
      update: {
        eventType: `admin.cancellation_email.${emailStatus}`,
        payload: JSON.stringify({ orderId: updatedOrder.id, orderNumber: updatedOrder.orderNumber, emailStatus })
      }
    });
  }
  const customerEmail = finalOrder.customerEmail ?? finalOrder.customer?.email ?? null;
  if (finalOrder.customer && customerEmail) await syncStorefrontCustomerTotals(finalOrder.customer.id, customerEmail);
  await reconcileCanceledOrRefundedOrderAlerts(finalOrder);
  const refreshed = await prisma.storefrontOrder.findUnique({
    where: { id: finalOrder.id },
    include: storefrontOrderInclude
  });
  return storefrontOrderToDTO(refreshed ?? finalOrder);
}

export async function updateStorefrontOrder(
  currentUser: SessionUser,
  orderId: string,
  input: {
    status?: string;
    fulfillmentStatus?: string;
    trackingNumber?: string;
    carrier?: string;
    shippingCost?: number;
    notes?: string;
  }
) {
  const order = await prisma.storefrontOrder.findFirst({
    where: { id: orderId, ...(currentUser.role === "ADMIN" ? {} : { userId: currentUser.id }) }
  });
  if (!order) throw new Error("Order not found");
  const updated = await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: {
      status: input.status,
      fulfillmentStatus: input.fulfillmentStatus,
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
      shippingCost: input.shippingCost,
      notes: input.notes,
      netProfit: input.shippingCost !== undefined ? order.total - order.stripeFeeEstimate - input.shippingCost - order.costBasis : undefined
    },
    include: storefrontOrderInclude
  });
  await prisma.fulfillment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      status: input.fulfillmentStatus ?? order.fulfillmentStatus,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      notes: input.notes,
      shippedAt: input.fulfillmentStatus === "shipped" ? new Date() : undefined
    },
    update: {
      status: input.fulfillmentStatus,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      notes: input.notes,
      shippedAt: input.fulfillmentStatus === "shipped" ? new Date() : undefined
    }
  });
  return storefrontOrderToDTO(updated);
}
