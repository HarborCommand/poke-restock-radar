import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import { cleanStorefrontDescription, cleanStorefrontTitle } from "@/lib/storefront-copy";
import { isStorefrontDisplayImageUrl } from "@/lib/product-image-quality";
import { getSavedProductImageUrls } from "@/lib/product-images";
import { emailProviderConfigured, sendEmailViaProvider, type EmailMessage, type EmailSendOptions } from "@/lib/email-provider";
import {
  calculateCartShipping,
  explainCartShippingCalculation,
  effectiveShippingPackageData,
  itemNeedsShippingProfile,
  shippingFallbackProfileVersion,
  shippingFormulaVersion,
  shippingRatePackageFromCalculation,
  type ShippingCalculation,
  type ShippingOption,
  type ShippingProfileDefinition
} from "@/lib/shipping";
import {
  fetchShippoUspsQuote,
  shippingRateProviderConfig,
  shippingQuoteExpiresAt,
  type NormalizedShippingQuote
} from "@/lib/shipping-rate-provider";
import { applyMerchantShippingPolicyToCarrierQuote } from "@/lib/shipping-policy";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { awardRewardsForPaidOrder, releasePendingRewardsForOrder, reverseRewardsForOrder, rewardSummaryForOrder } from "@/lib/customer-rewards";
import { shippingProfileDefinitionsForCheckout } from "@/lib/shipping-profiles";
import { resolveTaxLocation, taxLocationAddress, taxLocationSnapshot } from "@/lib/tax-location";
import {
  buildCheckoutExpiredEmail,
  buildLocalPickupEmail,
  buildOrderConfirmationEmail,
  buildRefundCancellationEmail,
  buildShippingConfirmationEmail,
  type StorefrontEmailAddress,
  type StorefrontEmailItem
} from "@/lib/storefront-email-templates";
import {
  DEFAULT_STOREFRONT_PURCHASE_LIMIT,
  storefrontConfiguredPurchaseLimit,
  storefrontEffectiveMaxQuantity
} from "@/lib/storefront-purchase-limits";
import { storefrontContactEmail, storefrontSportsCardsUrl } from "@/lib/storefront-routing";
import {
  cumulativeRefundedTaxCents,
  normalizeStripeTaxCode,
  safeTaxBreakdownJson,
  taxFeatureConfig
} from "@/lib/tax";
import {
  abandonProviderEvent,
  claimProviderEvent,
  completeProviderEvent,
  lockStorefrontOrderForRefund,
  runTaxRefundTransaction,
  TaxRefundAmountError,
  TaxRefundConflictError
} from "@/lib/tax-refund-concurrency";
import type {
  PublicOrderStatusLookupDTO,
  PublicStoreProductDTO,
  SessionUser,
  StorefrontCustomerRewardSummaryDTO,
  StorefrontOrderDTO,
  StorefrontOrderItemDTO,
  StorefrontSettingsDTO,
  StorefrontSummaryDTO,
  StorefrontTestOrderReason
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
  customerAccount: {
    select: {
      rewardBalance: true,
      rewardLedgerEntries: {
        select: {
          id: true,
          points: true,
          type: true,
          status: true,
          reason: true,
          availableAt: true,
          settledAt: true,
          createdAt: true,
          order: {
            select: {
              orderNumber: true
            }
          }
        },
        orderBy: { createdAt: "desc" as const },
        take: 8
      }
    }
  },
  reservations: true,
  paymentEvents: { orderBy: { receivedAt: "desc" } },
  rewardLedgerEntries: {
    select: {
      id: true,
      points: true,
      type: true,
      status: true,
      reason: true,
      availableAt: true,
      settledAt: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" as const }
  },
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

function quantitySold(item: { sales: Array<{ quantitySold: number }> }) {
  return item.sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
}

type StorefrontQuantityInput = {
  quantity: number;
  availableForSale: number | null;
  stockLots: Array<{ remainingQuantity: number }>;
  sales: Array<{ quantitySold: number }>;
};

type PublicStorefrontListingVisibilityInput = StorefrontQuantityInput & {
  publishToStore: boolean;
  publicSlug: string | null;
  publicPrice: number | null;
  storeStatus: string;
};

function quantityOwned(item: StorefrontQuantityInput) {
  const lotRemaining = item.stockLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  return item.stockLots.length ? lotRemaining : Math.max(0, item.quantity - quantitySold(item));
}

function sellableQuantity(item: StorefrontQuantityInput) {
  const owned = quantityOwned(item);
  const publicCap = item.availableForSale === null || item.availableForSale === undefined ? owned : Math.max(0, item.availableForSale);
  return Math.min(owned, publicCap);
}

export function isPublicStorefrontListingVisible(item: PublicStorefrontListingVisibilityInput) {
  return Boolean(
    item.publishToStore &&
      item.publicSlug &&
      item.publicPrice !== null &&
      item.publicPrice !== undefined &&
      ["active", "sold_out"].includes(item.storeStatus)
  );
}

export function isPublicStorefrontListingSellable(item: PublicStorefrontListingVisibilityInput) {
  return isPublicStorefrontListingVisible(item) && item.storeStatus === "active" && sellableQuantity(item) > 0;
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

function publicAvailabilityLevel(quantity: number, storeStatus: string): PublicStoreProductDTO["availabilityLevel"] {
  if (storeStatus !== "active" || quantity <= 0) return "sold_out";
  if (quantity <= 2) return "almost_gone";
  if (quantity <= 5) return "low_stock";
  return "in_stock";
}

function publicMaxQuantityForItem(item: StorefrontInventoryItem, quantity: number) {
  if (quantity <= 0 || item.storeStatus !== "active") return 0;
  return storefrontConfiguredPurchaseLimit(item) ?? DEFAULT_STOREFRONT_PURCHASE_LIMIT;
}

function publicImages(item: StorefrontInventoryItem) {
  return getSavedProductImageUrls(item, { publicOnly: true }).filter(isStorefrontDisplayImageUrl);
}

export function publicProductToDTO(
  item: StorefrontInventoryItem,
  options: { profileDefinitions?: Record<string, ShippingProfileDefinition> } = {}
): PublicStoreProductDTO | null {
  const price = item.publicPrice;
  const rawAvailableQuantity = sellableQuantity(item);
  const slug = item.publicSlug;
  if (!isPublicStorefrontListingVisible(item)) return null;
  if (!slug || price === null || price === undefined) return null;
  const images = publicImages(item);
  const publicCategory = displayStorefrontCategory({
    category: item.storefrontCategory || item.category,
    title: item.publicTitle || item.itemName,
    itemName: item.itemName,
    setName: item.setName,
    tags: parseList(item.storefrontTags)
  });
  const publicTitle = cleanStorefrontTitle(item.publicTitle || item.itemName);
  const status = rawAvailableQuantity > 0 && item.storeStatus === "active" ? "active" : "sold_out";
  const availabilityLevel = publicAvailabilityLevel(rawAvailableQuantity, item.storeStatus);
  const primaryImageUrl = images[0] ?? null;
  const effectivePackage = effectiveShippingPackageData(item, options.profileDefinitions);
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
      availableQuantity: status === "active" ? 1 : 0
    }),
    price,
    compareAtPrice: item.compareAtPrice,
    imageUrl: primaryImageUrl,
    primaryImageUrl,
    images,
    category: publicCategory,
    tags: parseList(item.storefrontTags),
    condition: cleanStorefrontTitle(item.condition),
    brand: cleanStorefrontTitle(item.brand) || null,
    manufacturer: cleanStorefrontTitle(item.manufacturer) || null,
    sku: item.sku,
    upc: item.upc,
    publicMaxQuantity: publicMaxQuantityForItem(item, rawAvailableQuantity),
    availabilityLevel,
    maxQuantityPerOrder: storefrontConfiguredPurchaseLimit(item),
    status,
    localPickupAvailable: item.localPickupAvailable,
    localPickupEligible: item.localPickupAvailable,
    shippingAvailable: item.shippingAvailable,
    shippingProfile: item.shippingProfile,
    packageWeightOz: effectivePackage.packageWeightOz,
    packageLengthIn: effectivePackage.packageLengthIn,
    packageWidthIn: effectivePackage.packageWidthIn,
    packageHeightIn: effectivePackage.packageHeightIn,
    shippingMetadataSource: item.shippingMetadataSource,
    freeShippingEligible: item.freeShippingEligible,
    requiresBox: item.requiresBox,
    insuranceRecommended: item.insuranceRecommended,
    needsShippingProfile: itemNeedsShippingProfile(item, options.profileDefinitions),
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

export async function getStorefrontSettings(
  userId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<StorefrontSettingsDTO> {
  const settings = userId
    ? await client.storefrontSettings.findUnique({ where: { userId } })
    : await client.storefrontSettings.findFirst({ orderBy: { updatedAt: "desc" } });
  const defaultPosLocation = settings ? await resolveTaxLocation(settings.userId, "pos", client) : null;
  const shippingRates = shippingRateProviderConfig();
  const accountFeatures = customerAccountFeatureConfig();
  const taxFeatures = taxFeatureConfig();
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
    checkoutConfigured: storefrontCheckoutConfigured(),
    customerAccounts: {
      enabled: accountFeatures.customerAccountsEnabled,
      rewardsEnabled: accountFeatures.customerRewardsEnabled,
      redemptionEnabled: accountFeatures.customerRewardRedemptionEnabled
    },
    calculatedUspsShipping: {
      enabled: shippingRates.calculatedUspsEnabled,
      provider: shippingRates.provider,
      shippoConfigured: shippingRates.shippoConfigured,
      fallbackEnabled: shippingRates.fallbackEnabled
    },
    tax: {
      storeCountry: defaultPosLocation?.country ?? settings?.storeCountry ?? "US",
      storeState: defaultPosLocation?.state ?? settings?.storeState ?? "FL",
      storeCounty: defaultPosLocation?.county ?? settings?.storeCounty ?? null,
      storeAddressLine1: defaultPosLocation?.addressLine1 ?? settings?.storeAddressLine1 ?? null,
      storeAddressLine2: defaultPosLocation?.addressLine2 ?? settings?.storeAddressLine2 ?? null,
      storeCity: defaultPosLocation?.city ?? settings?.storeCity ?? null,
      storePostalCode: defaultPosLocation?.postalCode ?? settings?.storePostalCode ?? null,
      stateRateBasisPoints: settings?.stateTaxRateBasisPoints ?? 600,
      countyRateBasisPoints: settings?.countyTaxRateBasisPoints ?? 0,
      combinedRateBasisPoints: (settings?.stateTaxRateBasisPoints ?? 600) + (settings?.countyTaxRateBasisPoints ?? 0),
      effectiveAt: settings?.taxProfileEffectiveAt?.toISOString() ?? null,
      sourceNote: settings?.taxProfileSourceNote ?? null,
      posTaxEnabled: settings?.posTaxEnabled ?? false,
      taxExemptSalesEnabled: settings?.taxExemptSalesEnabled ?? false,
      defaultTaxCategory: settings?.defaultTaxCategory ?? "general_tangible_goods",
      defaultStripeTaxCode: settings?.defaultStripeTaxCode ?? "txcd_99999999",
      shippingStripeTaxCode: settings?.shippingStripeTaxCode ?? "txcd_92010001",
      legacyManualTaxFallbackEnabled: settings?.legacyManualTaxFallbackEnabled ?? false,
      legacyManualTaxFallbackIncidentReason: settings?.legacyManualTaxFallbackIncidentReason ?? null,
      legacyManualTaxFallbackAcknowledgedAt: settings?.legacyManualTaxFallbackAcknowledgedAt?.toISOString() ?? null,
      legacyManualTaxFallbackExpiresAt: settings?.legacyManualTaxFallbackExpiresAt?.toISOString() ?? null,
      features: taxFeatures
    }
  };
}

export async function listPublicStoreProducts(input?: { q?: string; category?: string; onlySellable?: boolean }) {
  const [products, profileDefinitions] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        publishToStore: true,
        storeStatus: input?.onlySellable ? "active" : { in: ["active", "sold_out"] },
        publicPrice: { not: null },
        publicSlug: { not: null }
      },
      include: storefrontInventoryInclude,
      orderBy: { updatedAt: "desc" }
    }),
    shippingProfileDefinitionsForCheckout()
  ]);
  const q = input?.q?.trim().toLowerCase();
  const category = input?.category?.trim().toLowerCase();
  return products
    .filter((item) => !input?.onlySellable || isPublicStorefrontListingSellable(item))
    .map((item) => publicProductToDTO(item, { profileDefinitions }))
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
  const [item, profileDefinitions] = await Promise.all([
    prisma.inventoryItem.findFirst({
      where: { publicSlug: slug, publishToStore: true, storeStatus: { in: ["active", "sold_out"] } },
      include: storefrontInventoryInclude
    }),
    shippingProfileDefinitionsForCheckout()
  ]);
  if (!item) return null;
  return publicProductToDTO(item, { profileDefinitions });
}

export async function getCartProducts(
  items: Array<{ id: string; quantity: number }>,
  options: { strict?: boolean; profileDefinitions?: Record<string, ShippingProfileDefinition> } = {}
) {
  const strict = options.strict ?? true;
  const requested = new Map(items.map((item) => [item.id, item.quantity]));
  const profileDefinitionsPromise = options.profileDefinitions ? Promise.resolve(options.profileDefinitions) : shippingProfileDefinitionsForCheckout();
  const [products, profileDefinitions] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { id: { in: [...requested.keys()] } },
      include: storefrontInventoryInclude
    }),
    profileDefinitionsPromise
  ]);
  if (products.length !== requested.size) {
    throw new Error("One or more cart items are no longer available.");
  }
  return products.map((item) => {
    const product = publicProductToDTO(item, { profileDefinitions });
    if (!product) throw new Error(`${item.publicTitle || item.itemName} is not available for checkout.`);
    const requestedQuantity = requested.get(item.id) ?? 0;
    const rawAvailableQuantity = sellableQuantity(item);
    const effectiveMaxQuantity = storefrontEffectiveMaxQuantity({ ...product, publicMaxQuantity: rawAvailableQuantity });
    if (strict && product.status !== "active") throw new Error(`${item.publicTitle || item.itemName} is not available for checkout.`);
    if (strict && requestedQuantity > rawAvailableQuantity) throw new Error(`Reduce the quantity for ${product.title} before checkout.`);
    if (strict && requestedQuantity > effectiveMaxQuantity) throw new Error(`Purchase limit reached for ${product.title}.`);
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
      throw new Error(`Reduce the quantity for ${product.title} before checkout.`);
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
  customer_return: "Customer return",
  damaged_in_transit: "Damaged in transit",
  lost_shipment: "Lost shipment",
  wrong_item: "Wrong item",
  support_adjustment: "Customer support adjustment",
  test_order_cleanup: "Test order cleanup",
  other: "Other"
} as const;

type StorefrontCancellationReason = keyof typeof cancellationReasonLabels;
type StorefrontRefundType = "full" | "partial" | "none";
type CustomerEmailStatus = "sent" | "not_configured" | "missing_customer_email" | "failed" | "skipped";
type CustomerEmailKind = "order_confirmation" | "refund_cancellation" | "shipment" | "checkout_expired" | "local_pickup";

const customerEmailKindLabels: Record<CustomerEmailKind, string> = {
  order_confirmation: "Order confirmation",
  refund_cancellation: "Refund/cancellation",
  shipment: "Shipping/tracking",
  checkout_expired: "Expired checkout",
  local_pickup: "Pickup instructions"
};

const defaultStorefrontContactEmail = "gamedaygrabs@outlook.com";

type StorefrontCancelRefundInput = {
  reason: StorefrontCancellationReason;
  adminNote?: string;
  refundType: StorefrontRefundType;
  partialRefundAmount?: number | null;
  returnItemsToStock: boolean;
  sendCustomerEmail: boolean;
  idempotencyKey: string;
};

export async function sendStorefrontEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
  html?: string,
  options: Omit<EmailSendOptions, "idempotencyKey"> & Pick<EmailMessage, "headers" | "tags"> = {}
) {
  const { headers, tags, ...sendOptions } = options;
  return sendEmailViaProvider({ to, subject, text, html, headers, tags }, { ...sendOptions, idempotencyKey });
}

function customerEmailEventType(kind: CustomerEmailKind, status: CustomerEmailStatus) {
  return `customer_email.${kind}.${status}`;
}

function customerEmailEventId(kind: CustomerEmailKind, orderId: string, key = "default") {
  return `customer_email.${kind}:${orderId}:${key}`;
}

function customerEmailRuntimeEnvironment() {
  return envValue("VERCEL_ENV") || process.env.NODE_ENV || "development";
}

function customerEmailProviderMetadata(order: StorefrontOrderWithItems, kind: CustomerEmailKind) {
  return {
    headers: {
      "X-Entity-Ref-ID": `gdd:${order.orderNumber}:${kind}`,
      "X-GDD-Notification-Type": kind,
      "X-GDD-Order-Number": order.orderNumber
    },
    tags: [
      { name: "orderNumber", value: order.orderNumber },
      { name: "notificationType", value: kind },
      { name: "environment", value: customerEmailRuntimeEnvironment() }
    ]
  } satisfies Pick<EmailMessage, "headers" | "tags">;
}

function absoluteStorefrontAssetUrl(path: string) {
  return `${storefrontCheckoutBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function storefrontEmailLogoUrl() {
  return absoluteStorefrontAssetUrl("/brand/gamedaygrabs-logo-horizontal.png");
}

function safeEmailImageUrl(url: string | null | undefined) {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return absoluteStorefrontAssetUrl(url);
  return null;
}

function orderEmailItems(order: StorefrontOrderWithItems): StorefrontEmailItem[] {
  return order.items.map((item) => {
    const imageUrl =
      safeEmailImageUrl(item.imageUrl) ??
      safeEmailImageUrl(getSavedProductImageUrls(item.inventoryItem, { publicOnly: true }).find(isStorefrontDisplayImageUrl));
    return {
      name: item.publicTitle,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      imageUrl
    };
  });
}

function orderShippingAddressForEmail(order: StorefrontOrderWithItems): StorefrontEmailAddress | null {
  const address = orderAddress({
    name: order.shippingName ?? order.customerName,
    line1: order.shippingLine1,
    line2: order.shippingLine2,
    city: order.shippingCity,
    state: order.shippingState,
    postalCode: order.shippingPostalCode,
    country: order.shippingCountry
  });
  return address;
}

function pickupInstructionLines(instructions: string | null | undefined) {
  return (
    instructions
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

function trackingUrlFor(carrier: string | null | undefined, trackingNumber: string | null | undefined) {
  const tracking = trackingNumber?.trim();
  if (!tracking) return null;
  const encoded = encodeURIComponent(tracking);
  const normalizedCarrier = (carrier || "").trim().toLowerCase();
  if (normalizedCarrier.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (normalizedCarrier.includes("ups")) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (normalizedCarrier.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  return null;
}

function customerEmailEventPayload(input: {
  order: StorefrontOrderWithItems;
  kind: CustomerEmailKind;
  status: CustomerEmailStatus;
  recipient: string | null;
  sentAt?: Date | null;
  failureReason?: string | null;
  detail?: string | null;
}) {
  return JSON.stringify({
    provider: "email",
    kind: input.kind,
    label: customerEmailKindLabels[input.kind],
    status: input.status,
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    recipient: input.recipient,
    sentAt: input.sentAt?.toISOString() ?? null,
    failureReason: input.failureReason ?? null,
    detail: input.detail ?? null
  });
}

function parseCustomerEmailEventStatus(event: { eventType: string; payload: string | null }): CustomerEmailStatus {
  const fallback = event.eventType.split(".").at(-1);
  try {
    const parsed = JSON.parse(event.payload || "{}") as { status?: unknown; emailStatus?: unknown };
    const status = typeof parsed.status === "string" ? parsed.status : typeof parsed.emailStatus === "string" ? parsed.emailStatus : fallback;
    if (["sent", "not_configured", "missing_customer_email", "failed", "skipped"].includes(status || "")) {
      return status as CustomerEmailStatus;
    }
  } catch {
    // Fall through to the event type suffix.
  }
  if (["sent", "not_configured", "missing_customer_email", "failed", "skipped"].includes(fallback || "")) {
    return fallback as CustomerEmailStatus;
  }
  return "skipped";
}

async function createCustomerEmailEventClaim(input: {
  eventId: string;
  order: StorefrontOrderWithItems;
  kind: CustomerEmailKind;
  recipient: string | null;
}) {
  try {
    await prisma.paymentEvent.create({
      data: {
        orderId: input.order.id,
        provider: "email",
        eventId: input.eventId,
        eventType: customerEmailEventType(input.kind, "skipped"),
        payload: customerEmailEventPayload({
          order: input.order,
          kind: input.kind,
          status: "skipped",
          recipient: input.recipient,
          detail: "Email notification queued."
        })
      }
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function completeCustomerEmailEvent(input: {
  eventId: string;
  order: StorefrontOrderWithItems;
  kind: CustomerEmailKind;
  status: CustomerEmailStatus;
  recipient: string | null;
  sentAt?: Date | null;
  failureReason?: string | null;
  detail?: string | null;
}) {
  await prisma.paymentEvent.update({
    where: { eventId: input.eventId },
    data: {
      eventType: customerEmailEventType(input.kind, input.status),
      payload: customerEmailEventPayload(input)
    }
  });
}

async function sendCustomerEmailNotificationOnce(input: {
  order: StorefrontOrderWithItems;
  kind: CustomerEmailKind;
  eventId: string;
  subject?: string;
  text?: string;
  html?: string;
  recipient?: string | null;
  skippedDetail?: string;
}) {
  const existing = await prisma.paymentEvent.findUnique({ where: { eventId: input.eventId } });
  if (existing) return parseCustomerEmailEventStatus(existing);

  const recipient = input.recipient ?? input.order.customerEmail ?? input.order.customer?.email ?? null;
  const claimed = await createCustomerEmailEventClaim({ eventId: input.eventId, order: input.order, kind: input.kind, recipient });
  if (!claimed) {
    const current = await prisma.paymentEvent.findUnique({ where: { eventId: input.eventId } });
    return current ? parseCustomerEmailEventStatus(current) : "skipped";
  }

  if (input.skippedDetail) {
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status: "skipped",
      recipient,
      detail: input.skippedDetail
    });
    return "skipped";
  }
  if (!recipient) {
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status: "missing_customer_email",
      recipient,
      detail: "No customer email is saved for this order."
    });
    return "missing_customer_email";
  }
  if (!emailProviderConfigured()) {
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status: "not_configured",
      recipient,
      detail: "Email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM, or configure SMTP fallback."
    });
    return "not_configured";
  }
  if (!input.html) {
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status: "failed",
      recipient,
      failureReason: "Customer email template HTML missing.",
      detail: "Customer email HTML template was missing, so no customer email was sent."
    });
    return "failed";
  }
  try {
    const result = await sendStorefrontEmail(
      recipient,
      input.subject || "GameDayGrabs order update",
      input.text || "GameDayGrabs order update",
      input.eventId,
      input.html,
      customerEmailProviderMetadata(input.order, input.kind)
    );
    const status: CustomerEmailStatus = result.status === "sent" ? "sent" : result.status === "failed" ? "failed" : "not_configured";
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status,
      recipient,
      sentAt: result.sentAt,
      failureReason: result.failureReason,
      detail: result.detail
    });
    return status;
  } catch {
    await completeCustomerEmailEvent({
      eventId: input.eventId,
      order: input.order,
      kind: input.kind,
      status: "failed",
      recipient,
      failureReason: "Email provider send failed.",
      detail: "Email delivery failed without blocking the order workflow."
    });
    return "failed";
  }
}

async function sendStorefrontOrderConfirmationEmail(order: StorefrontOrderWithItems) {
  const settings = await getStorefrontSettings();
  const contactEmail = settings.contactEmail || defaultStorefrontContactEmail;
  const accountFeatures = customerAccountFeatureConfig();
  const email = buildOrderConfirmationEmail({
    orderNumber: order.orderNumber,
    supportEmail: contactEmail,
    logoUrl: storefrontEmailLogoUrl(),
    items: orderEmailItems(order),
    subtotal: order.subtotal,
    discount: moneyFromCents(order.discountCents ?? 0),
    shippingCharged: order.shippingCharged,
    tax: order.taxCents === null ? null : order.tax,
    totalPaid: order.total,
    shippingMethod: order.shippingMethodLabel,
    isLocalPickup: orderIsLocalPickup(order),
    pickupStatus: order.fulfillmentStatus,
    accountCtaEnabled: accountFeatures.customerAccountsEnabled,
    rewardsCtaEnabled: accountFeatures.customerAccountsEnabled && accountFeatures.customerRewardsEnabled
  });
  return sendCustomerEmailNotificationOnce({
    order,
    kind: "order_confirmation",
    eventId: customerEmailEventId("order_confirmation", order.id),
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

async function sendStorefrontCheckoutExpiredEmail(order: StorefrontOrderWithItems, reason: string) {
  const settings = await getStorefrontSettings();
  const contactEmail = settings.contactEmail || defaultStorefrontContactEmail;
  const email = buildCheckoutExpiredEmail({
    orderNumber: order.orderNumber,
    supportEmail: contactEmail,
    logoUrl: storefrontEmailLogoUrl(),
    items: orderEmailItems(order),
    reason
  });
  return sendCustomerEmailNotificationOnce({
    order,
    kind: "checkout_expired",
    eventId: customerEmailEventId("checkout_expired", order.id),
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

function moneyFromCents(cents: number) {
  return Math.round(cents) / 100;
}

function centsFromMoney(amount: number) {
  return Math.round(amount * 100);
}

function requiredStripeTaxCode(input: { explicitCode: string | null | undefined; defaultCode: string; taxableOverride: boolean | null | undefined }, productTitle: string) {
  if (input.taxableOverride === false && !input.explicitCode) {
    throw new Error(`A non-taxable override for ${productTitle} requires an owner-approved Stripe tax code.`);
  }
  const taxCode = normalizeStripeTaxCode(input.explicitCode ?? input.defaultCode);
  if (!taxCode) throw new Error(`No approved Stripe tax code is configured for ${productTitle}.`);
  return taxCode;
}

function stripeShippingOptions(shippingCalculation: ShippingCalculation): Stripe.Checkout.SessionCreateParams.ShippingOption[] {
  return stripeShippingOptionsWithTaxBehavior(shippingCalculation, false);
}

function stripeShippingOptionsWithTaxBehavior(shippingCalculation: ShippingCalculation, automaticTaxEnabled: boolean): Stripe.Checkout.SessionCreateParams.ShippingOption[] {
  return shippingCalculation.shippingOptions.map((option) => ({
    shipping_rate_data: {
      type: "fixed_amount",
      display_name: option.label,
      fixed_amount: {
        amount: centsFromMoney(option.amount),
        currency: "usd"
      },
      ...(automaticTaxEnabled ? { tax_behavior: "exclusive" as const } : {}),
      metadata: {
        shippingOptionId: option.id,
        shippingOptionLabel: option.label,
        shippingRateSource: option.rateSource,
        shippingPackageProfile: option.profile,
        shippingPackageWeightOz: String(shippingCalculation.actualWeightOz),
        shippingWarnings: stringifyList(shippingCalculation.warnings) ?? ""
      }
    }
  }));
}

type StoredShippingQuote = Prisma.ShippingQuoteGetPayload<object>;

type StorefrontShippingQuoteResponse = {
  quoteId: string;
  carrier: string;
  service: string;
  amount: number;
  amountCents: number;
  currency: string;
  destinationZip: string;
  expiresAt: string;
  fallbackUsed: boolean;
  warning: string | null;
  packageWeightOz: number | null;
  packageProfile: string | null;
};

function shippingQuoteToken() {
  return `ship_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function shippingCartHash(
  cart: CheckoutCartEntry[],
  destinationZip?: string | null,
  profileDefinitions?: Record<string, ShippingProfileDefinition>
) {
  const shippingAudit = explainCartShippingCalculation(cart.map(({ item, quantity }) => ({ ...item, quantity })), { profileDefinitions });
  const payload = {
    formulaVersion: shippingFormulaVersion,
    fallbackProfileVersion: shippingFallbackProfileVersion,
    fulfillmentMethod: "shipping",
    destinationZip: String(destinationZip || "").replace(/\D/g, "").slice(0, 5),
    parcel: {
      tier: shippingAudit.selectedPackageTier,
      weightOz: shippingAudit.actualPackedWeightOz,
      dimensionalWeightOz: shippingAudit.dimensionalWeightOz,
      billableWeightOz: shippingAudit.billableWeightOz,
      lengthIn: shippingAudit.selectedPackageDimensions.lengthIn,
      widthIn: shippingAudit.selectedPackageDimensions.widthIn,
      heightIn: shippingAudit.selectedPackageDimensions.heightIn,
      cubicFeet: shippingAudit.selectedPackageCubicFeet,
      shippo: shippingAudit.shippoParcelPayload
    },
    items: cart
      .map(({ item, product, quantity }) => ({
        id: item.id,
        quantity,
        price: product.price,
        title: product.title,
        category: product.category,
        shippingProfile: item.shippingProfile,
        packageWeightOz: item.packageWeightOz,
        packageLengthIn: item.packageLengthIn,
        packageWidthIn: item.packageWidthIn,
        packageHeightIn: item.packageHeightIn,
        shippingMetadataSource: item.shippingMetadataSource,
        shippingAvailable: item.shippingAvailable,
        localPickupAvailable: item.localPickupAvailable,
        freeShippingEligible: item.freeShippingEligible,
        requiresBox: item.requiresBox,
        insuranceRecommended: item.insuranceRecommended
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function calculatedQuotePackage(shippingCalculation: ShippingCalculation) {
  return shippingRatePackageFromCalculation(shippingCalculation);
}

function shippingQuoteToResponse(quote: StoredShippingQuote): StorefrontShippingQuoteResponse {
  return {
    quoteId: quote.quoteToken,
    carrier: quote.carrier,
    service: quote.service,
    amount: moneyFromCents(quote.amountCents),
    amountCents: quote.amountCents,
    currency: quote.currency,
    destinationZip: quote.destinationZip,
    expiresAt: quote.expiresAt.toISOString(),
    fallbackUsed: quote.fallbackUsed,
    warning: quote.warning,
    packageWeightOz: quote.packageWeightOz,
    packageProfile: quote.packageProfileKey
  };
}

function fallbackShippingQuote(
  shippingCalculation: ShippingCalculation,
  destinationZip: string,
  reason: string,
  now = new Date()
): NormalizedShippingQuote {
  const selectedShipping = shippingCalculation.shippingOptions.find((option) => option.id !== "local_pickup") ?? shippingCalculation.defaultShippingOption;
  if (!selectedShipping || selectedShipping.id === "local_pickup") {
    throw new Error("Shipping is not available for this cart. Use Request Invoice for manual review.");
  }
  return {
    provider: "internal_profile",
    carrier: "STANDARD",
    service: selectedShipping.label,
    amountCents: centsFromMoney(selectedShipping.amount),
    currency: "USD",
    estimatedDays: null,
    rateProviderRef: null,
    shipmentProviderRef: null,
    expiresAt: shippingQuoteExpiresAt(now),
    fallbackUsed: true,
    warning: reason || "USPS quote is temporarily unavailable. A safe standard shipping estimate is shown."
  };
}

function normalizedQuoteFromStoredQuote(quote: StoredShippingQuote): NormalizedShippingQuote {
  return {
    provider: quote.provider === "shippo" ? "shippo" : "internal_profile",
    carrier: quote.carrier === "USPS" ? "USPS" : "STANDARD",
    service: quote.service,
    amountCents: quote.amountCents,
    currency: "USD",
    estimatedDays: null,
    rateProviderRef: quote.rateProviderRef,
    shipmentProviderRef: quote.shipmentProviderRef,
    expiresAt: quote.expiresAt,
    fallbackUsed: quote.fallbackUsed,
    warning: quote.warning
  };
}

function applyMerchantShippingPolicyToStoredQuote(
  quote: StoredShippingQuote,
  shippingCalculation: ShippingCalculation
): StoredShippingQuote {
  const result = applyMerchantShippingPolicyToCarrierQuote(normalizedQuoteFromStoredQuote(quote), shippingCalculation);
  if (!result.policyApplied) return quote;
  return { ...quote, amountCents: result.quote.amountCents };
}

async function quoteForCalculatedShipping(
  shippingCalculation: ShippingCalculation,
  destinationZip: string,
  state: string | null | undefined,
  options: { fetchImpl?: typeof fetch; now?: Date } = {}
) {
  const config = shippingRateProviderConfig();
  const packageSnapshot = calculatedQuotePackage(shippingCalculation);
  const missingPackageData = !packageSnapshot.weightOz || !packageSnapshot.lengthIn || !packageSnapshot.widthIn || !packageSnapshot.heightIn;
  if (!config.calculatedUspsEnabled) {
    return fallbackShippingQuote(shippingCalculation, destinationZip, "Calculated USPS shipping is disabled. A safe standard shipping estimate is shown.", options.now);
  }
  if (missingPackageData) {
    return fallbackShippingQuote(shippingCalculation, destinationZip, "USPS quote needs complete package weight and dimensions. A safe standard shipping estimate is shown.", options.now);
  }
  try {
    const quote = await fetchShippoUspsQuote(
      {
        destination: { zip: destinationZip, state, country: "US" },
        package: packageSnapshot
      },
      { fetchImpl: options.fetchImpl, now: options.now }
    );
    if (quote) return applyMerchantShippingPolicyToCarrierQuote(quote, shippingCalculation).quote;
  } catch {
    // Provider failures intentionally fall through to the safe internal estimate.
  }
  return fallbackShippingQuote(shippingCalculation, destinationZip, "USPS quote is temporarily unavailable. A safe standard shipping estimate is shown.", options.now);
}

export async function createStorefrontShippingQuote(
  input: {
    items: Array<{ id: string; quantity: number }>;
    destinationZip: string;
    state?: string | null;
    country?: "US";
  },
  options: { fetchImpl?: typeof fetch; now?: Date } = {}
) {
  const config = shippingRateProviderConfig();
  if (!config.calculatedUspsEnabled && !config.fallbackEnabled) {
    throw new Error("Calculated shipping is not enabled. Use Request Invoice for manual review.");
  }
  const [settings, profileDefinitions] = await Promise.all([getStorefrontSettings(), shippingProfileDefinitionsForCheckout()]);
  const cart = await getCartProducts(input.items, { profileDefinitions });
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCalculation = calculateCartShipping(
    cart.map(({ item, quantity }) => ({ ...item, quantity })),
    { subtotal, freeShippingThreshold: settings.freeShippingThreshold, fulfillmentMethod: "shipping", profileDefinitions }
  );
  const selectedShipping = shippingCalculation.shippingOptions.find((option) => option.id !== "local_pickup") ?? null;
  if (!selectedShipping) throw new Error("Shipping is not available for this cart. Use Request Invoice for manual review.");

  const normalizedQuote =
    config.calculatedUspsEnabled
      ? await quoteForCalculatedShipping(shippingCalculation, input.destinationZip, input.state, options)
      : fallbackShippingQuote(shippingCalculation, input.destinationZip, "Calculated USPS shipping is disabled. A safe standard shipping estimate is shown.", options.now);
  if (normalizedQuote.fallbackUsed && !config.fallbackEnabled) {
    throw new Error("USPS quote is unavailable and fallback shipping is disabled. Use Request Invoice for manual review.");
  }

  const quote = await prisma.shippingQuote.create({
    data: {
      quoteToken: shippingQuoteToken(),
      userId: cart[0]?.item.userId ?? null,
      provider: normalizedQuote.provider,
      carrier: normalizedQuote.carrier,
      service: normalizedQuote.service,
      amountCents: normalizedQuote.amountCents,
      currency: normalizedQuote.currency,
      destinationZip: input.destinationZip,
      country: input.country ?? "US",
      packageWeightOz: shippingCalculation.actualWeightOz,
      packageLengthIn: shippingCalculation.packageLengthIn,
      packageWidthIn: shippingCalculation.packageWidthIn,
      packageHeightIn: shippingCalculation.packageHeightIn,
      packageProfileKey: shippingCalculation.packageProfile,
      rateProviderRef: normalizedQuote.rateProviderRef,
      shipmentProviderRef: normalizedQuote.shipmentProviderRef,
      fallbackUsed: normalizedQuote.fallbackUsed,
      warning: normalizedQuote.warning,
      expiresAt: normalizedQuote.expiresAt,
      cartHash: shippingCartHash(cart, input.destinationZip, profileDefinitions)
    }
  });
  return {
    quote: shippingQuoteToResponse(quote),
    shippingOptions: [
      shippingQuoteToResponse(quote),
      ...(shippingCalculation.localPickupEligible
        ? [
            {
              quoteId: "local_pickup",
              carrier: "LOCAL",
              service: "Local Pickup",
              amount: 0,
              amountCents: 0,
              currency: "USD",
              destinationZip: input.destinationZip,
              expiresAt: quote.expiresAt.toISOString(),
              fallbackUsed: false,
              warning: null,
              packageWeightOz: 0,
              packageProfile: "local_pickup"
            }
          ]
        : [])
    ]
  };
}

function shippingOptionFromQuote(quote: StoredShippingQuote): ShippingOption {
  return {
    id: "calculated_usps",
    label: quote.service,
    amount: moneyFromCents(quote.amountCents),
    profile: quote.packageProfileKey || "small_box",
    rateSource: quote.provider === "shippo" ? "shippo" : "internal_profile",
    requiresManualReview: false
  };
}

function stripeShippingOptionsForCheckout(
  shippingCalculation: ShippingCalculation,
  calculatedQuote?: StoredShippingQuote | null,
  automaticTaxEnabled = false
): Stripe.Checkout.SessionCreateParams.ShippingOption[] {
  if (!calculatedQuote) return automaticTaxEnabled
    ? stripeShippingOptionsWithTaxBehavior(shippingCalculation, true)
    : stripeShippingOptions(shippingCalculation);
  const pickupOption = shippingCalculation.shippingOptions.find((option) => option.id === "local_pickup");
  const quoteOption = shippingOptionFromQuote(calculatedQuote);
  const options = [quoteOption, pickupOption].filter((option): option is ShippingOption => Boolean(option));
  return options.map((option) => ({
    shipping_rate_data: {
      type: "fixed_amount",
      display_name: option.label,
      fixed_amount: {
        amount: centsFromMoney(option.amount),
        currency: "usd"
      },
      ...(automaticTaxEnabled ? { tax_behavior: "exclusive" as const } : {}),
      metadata: {
        shippingOptionId: option.id,
        shippingOptionLabel: option.label,
        shippingRateSource: option.rateSource,
        shippingPackageProfile: option.profile,
        shippingPackageWeightOz: String(option.id === "local_pickup" ? 0 : shippingCalculation.actualWeightOz),
        shippingPackageLengthIn: String(shippingCalculation.packageLengthIn ?? ""),
        shippingPackageWidthIn: String(shippingCalculation.packageWidthIn ?? ""),
        shippingPackageHeightIn: String(shippingCalculation.packageHeightIn ?? ""),
        shippingWarnings: stringifyList(shippingCalculation.warnings) ?? "",
        shippingQuoteId: calculatedQuote.quoteToken,
        shippingQuoteProvider: calculatedQuote.provider,
        shippingCarrier: calculatedQuote.carrier,
        shippingService: calculatedQuote.service,
        shippingQuotedAmountCents: String(calculatedQuote.amountCents),
        shippingQuoteFallbackUsed: String(calculatedQuote.fallbackUsed)
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
const storefrontTestOrderReasons = new Set<StorefrontTestOrderReason>([
  "stripe_test_mode",
  "live_checkout_smoke",
  "email_smoke_test",
  "shipping_smoke_test",
  "refund_smoke_test",
  "other"
]);

function storefrontRealBusinessOrderWhere(): Prisma.StorefrontOrderWhereInput {
  return { isTestOrder: false };
}

function storefrontOrderNetRevenue(order: Pick<StorefrontOrderWithItems, "total" | "totalCents" | "tax" | "taxCents" | "refundedAmount" | "refundedTaxCents">) {
  const totalCents = order.totalCents ?? centsFromMoney(order.total);
  const taxCents = order.taxCents ?? centsFromMoney(order.tax);
  const refundedCents = centsFromMoney(order.refundedAmount || 0);
  const refundedTaxCents = order.refundedTaxCents ?? 0;
  return moneyFromCents(Math.max(0, totalCents - taxCents - Math.max(0, refundedCents - refundedTaxCents)));
}

function storefrontOrderNetProfitAfterRefund(order: Pick<StorefrontOrderWithItems, "total" | "totalCents" | "tax" | "taxCents" | "refundedAmount" | "refundedTaxCents" | "stripeFeeEstimate" | "shippingCost" | "costBasis" | "netProfit">) {
  if (!order.refundedAmount) return order.netProfit;
  const netRevenue = storefrontOrderNetRevenue(order);
  if (netRevenue <= 0) return 0;
  return netRevenue - order.stripeFeeEstimate - order.shippingCost - order.costBasis;
}

function orderCanCancelOrRefund(order: StorefrontOrderWithItems) {
  if (["canceled", "refunded", "refund_pending"].includes(order.status)) return false;
  if (["refunded", "refund_pending"].includes(order.paymentStatus)) return false;
  if (order.canceledAt && order.refundStatus) return false;
  if (order.status === "partially_refunded" || order.paymentStatus === "partially_refunded") {
    return order.fulfillmentStatus === "shipped" && orderRemainingRefundableCents(order) > 0;
  }
  return true;
}

function orderIsClosedForFulfillment(order: Pick<StorefrontOrderWithItems, "status" | "paymentStatus" | "fulfillmentStatus">) {
  return (
    ["canceled", "refunded", "partially_refunded", "refund_pending", "refund_failed"].includes(order.status) ||
    ["failed", "expired", "refunded", "partially_refunded", "refund_pending", "refund_failed"].includes(order.paymentStatus) ||
    order.fulfillmentStatus === "canceled"
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
  refundedTax: number | null;
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
    refundedTax: input.refundedTax,
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
  refundedTax: number | null;
  contactEmail: string;
  idempotencyKey: string;
}) {
  const to = input.order.customerEmail ?? input.order.customer?.email ?? null;
  const reasonLabel = cancellationReasonLabels[input.reason];
  const statusLabel =
    input.refundAmount > 0
      ? input.order.paymentStatus === "partially_refunded" || input.order.status === "partially_refunded"
        ? "Partially refunded"
        : "Order refunded"
      : "Order canceled";
  const email = buildRefundCancellationEmail({
    orderNumber: input.order.orderNumber,
    supportEmail: input.contactEmail,
    logoUrl: storefrontEmailLogoUrl(),
    statusLabel,
    refundAmount: input.refundAmount,
    refundedTax: input.refundedTax,
    remainingTotal: Math.max(0, input.order.total - input.order.refundedAmount),
    reasonLabel
  });
  return sendCustomerEmailNotificationOnce({
    order: input.order,
    kind: "refund_cancellation",
    eventId: customerEmailEventId("refund_cancellation", input.order.id, input.idempotencyKey),
    subject: email.subject,
    text: email.text,
    html: email.html,
    recipient: to
  });
}

async function sendStorefrontShipmentEmail(order: StorefrontOrderWithItems) {
  if (orderIsLocalPickup(order)) {
    return sendCustomerEmailNotificationOnce({
      order,
      kind: "shipment",
      eventId: customerEmailEventId("shipment", order.id),
      skippedDetail: "Local Pickup orders use pickup instructions instead of shipping confirmation."
    });
  }
  const settings = await getStorefrontSettings();
  const contactEmail = settings.contactEmail || defaultStorefrontContactEmail;
  const trackingUrl = trackingUrlFor(order.carrier, order.trackingNumber);
  const email = buildShippingConfirmationEmail({
    orderNumber: order.orderNumber,
    supportEmail: contactEmail,
    logoUrl: storefrontEmailLogoUrl(),
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    trackingUrl,
    shippingAddress: orderShippingAddressForEmail(order)
  });
  return sendCustomerEmailNotificationOnce({
    order,
    kind: "shipment",
    eventId: customerEmailEventId("shipment", order.id),
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

async function sendStorefrontLocalPickupEmail(order: StorefrontOrderWithItems) {
  const settings = await getStorefrontSettings();
  const contactEmail = settings.contactEmail || defaultStorefrontContactEmail;
  const pickupInstructions = pickupInstructionLines(settings.localPickupInstructions);
  const email = buildLocalPickupEmail({
    orderNumber: order.orderNumber,
    supportEmail: contactEmail,
    logoUrl: storefrontEmailLogoUrl(),
    pickupLocationLines: pickupInstructions.length ? ["GameDayGrabs", ...pickupInstructions] : ["GameDayGrabs", "Please contact GameDayGrabs to coordinate pickup timing."],
    pickupNotes: ["Please bring a valid ID.", "We'll confirm your order details when you arrive."]
  });
  return sendCustomerEmailNotificationOnce({
    order,
    kind: "local_pickup",
    eventId: customerEmailEventId("local_pickup", order.id),
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

async function recordExpiredCheckoutEmailSkipped(order: StorefrontOrderWithItems, detail: string) {
  return sendCustomerEmailNotificationOnce({
    order,
    kind: "checkout_expired",
    eventId: customerEmailEventId("checkout_expired", order.id),
    skippedDetail: detail
  });
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

function orderIsLocalPickup(order: Pick<StorefrontOrderWithItems, "shippingMethodLabel" | "shippingPackageProfile">) {
  return order.shippingPackageProfile === "local_pickup" || String(order.shippingMethodLabel || "").trim().toLowerCase() === "local pickup";
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
  if (order.paymentStatus === "paid" && orderIsLocalPickup(order) && ["unfulfilled", "pickup_ready"].includes(order.fulfillmentStatus)) return "Ready for Pickup";
  if (order.paymentStatus === "paid" && orderIsLocalPickup(order) && order.fulfillmentStatus === "picked_up") return "Picked Up";
  if (order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled") return "Needs Shipping";
  if (order.paymentStatus === "paid") return "Paid";
  if (order.paymentStatus === "pending") return "New";
  return order.status;
}

function customerEmailNotifications(order: StorefrontOrderWithItems): StorefrontOrderDTO["customerEmailNotifications"] {
  const notifications = order.paymentEvents
    .filter((event) => event.eventType.startsWith("customer_email.") || event.eventType.startsWith("admin.cancellation_email."))
    .map((event) => {
      const record = (() => {
        try {
          return JSON.parse(event.payload || "{}") as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      const inferredKind = event.eventType.startsWith("admin.cancellation_email.")
        ? "refund_cancellation"
        : event.eventType.split(".")[1] || "order_update";
      const kind = typeof record.kind === "string" ? record.kind : inferredKind;
      const status = customerEmailEventStatusFromRecord(record, event);
      const sentAt = typeof record.sentAt === "string" ? record.sentAt : status === "sent" ? event.receivedAt.toISOString() : null;
      const failureReason =
        typeof record.failureReason === "string" && record.failureReason.trim() ? record.failureReason.trim().slice(0, 160) : null;
      const detail = typeof record.detail === "string" && record.detail.trim() ? record.detail.trim().slice(0, 200) : null;
      return {
        id: event.id,
        kind,
        label:
          typeof record.label === "string" && record.label.trim()
            ? record.label
            : customerEmailKindLabels[kind as CustomerEmailKind] ?? "Customer email",
        status,
        recipient: typeof record.recipient === "string" && record.recipient.trim() ? record.recipient.trim() : null,
        sentAt,
        updatedAt: event.receivedAt.toISOString(),
        failureReason,
        detail
      };
    });

  if (order.customerCancellationEmailStatus && !notifications.some((notification) => notification.kind === "refund_cancellation")) {
    notifications.push({
      id: `legacy-cancellation-email-${order.id}`,
      kind: "refund_cancellation",
      label: customerEmailKindLabels.refund_cancellation,
      status: order.customerCancellationEmailStatus,
      recipient: order.customerEmail ?? order.customer?.email ?? null,
      sentAt: order.customerCancellationEmailSentAt?.toISOString() ?? null,
      updatedAt: order.customerCancellationEmailSentAt?.toISOString() ?? order.updatedAt.toISOString(),
      failureReason: null,
      detail: null
    });
  }
  return notifications.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function customerRewardSummaryForOrder(order: StorefrontOrderWithItems): StorefrontCustomerRewardSummaryDTO | null {
  const account = order.customerAccount;
  if (!account) return null;
  const balance = account.rewardBalance;
  return {
    availablePoints: balance?.availablePoints ?? 0,
    lifetimeEarnedPoints: balance?.lifetimeEarnedPoints ?? 0,
    pendingPoints: balance?.pendingPoints ?? 0,
    recentLedgerEntries: account.rewardLedgerEntries.map((entry) => ({
      id: entry.id,
      points: entry.points,
      type: entry.type,
      status: entry.status ?? (entry.points < 0 || entry.type === "reverse" ? "reversed" : "available"),
      reason: entry.reason,
      orderNumber: entry.order?.orderNumber ?? null,
      availableAt: entry.availableAt?.toISOString() ?? null,
      settledAt: entry.settledAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString()
    })),
    adminAdjustmentsEnabled: false
  };
}

function customerEmailEventStatusFromRecord(record: Record<string, unknown>, event: { eventType: string; payload: string | null }) {
  const status = typeof record.status === "string" ? record.status : typeof record.emailStatus === "string" ? record.emailStatus : null;
  if (status && ["sent", "not_configured", "missing_customer_email", "failed", "skipped"].includes(status)) return status;
  return parseCustomerEmailEventStatus(event);
}

function orderTimeline(order: StorefrontOrderWithItems): StorefrontOrderDTO["timeline"] {
  const completedEvent = order.paymentEvents.find((event) => event.eventType === "checkout.session.completed");
  const cancellationStarted = order.paymentEvents.find((event) => event.eventType === "admin.cancel_refund.started");
  const refundCreated = order.paymentEvents.find((event) => event.eventType === "admin.refund.created");
  const emailNotifications = customerEmailNotifications(order);
  const confirmationEmail = emailNotifications.find((notification) => notification.kind === "order_confirmation");
  const cancellationEmail = emailNotifications.find((notification) => notification.kind === "refund_cancellation");
  const shipmentEmail = emailNotifications.find((notification) => notification.kind === "shipment");
  return [
    { label: "Order created", at: order.createdAt.toISOString(), detail: "Storefront order was created." },
    { label: "Checkout started", at: order.stripeCheckoutSessionId ? order.createdAt.toISOString() : null, detail: order.stripeCheckoutSessionId ? "Stripe Checkout session was created." : "No Stripe Checkout session for this order." },
    { label: "Payment completed", at: completedEvent?.receivedAt.toISOString() ?? order.paidAt?.toISOString() ?? null, detail: completedEvent ? "Stripe webhook checkout.session.completed was received." : "Payment completion webhook has not been stored." },
    { label: "Inventory reduced", at: order.reservations.some((reservation) => reservation.status === "completed") ? order.paidAt?.toISOString() ?? null : null, detail: order.reservations.some((reservation) => reservation.status === "completed") ? "Stock reservation completed after payment." : "Inventory has not been finalized for this order." },
    { label: "Sale created", at: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? order.paidAt?.toISOString() ?? null : null, detail: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? "Inventory sale/profit values are attached to order items." : "No sale/profit allocation stored yet." },
    { label: "Cancel/refund workflow", at: cancellationStarted?.receivedAt.toISOString() ?? order.canceledAt?.toISOString() ?? null, detail: order.refundReason ? `Reason: ${order.refundReason}.` : "No cancel/refund workflow has been started." },
    { label: "Refund created", at: refundCreated?.receivedAt.toISOString() ?? order.refundedAt?.toISOString() ?? null, detail: order.refundedAmount > 0 ? `Refund total recorded: $${order.refundedAmount.toFixed(2)}.` : "No Stripe refund recorded." },
    { label: "Refund status", at: order.refundedAt?.toISOString() ?? null, detail: order.refundStatus ? `Refund status: ${order.refundStatus}.` : "No refund status recorded." },
    { label: "Inventory returned", at: order.stockReturnedAt?.toISOString() ?? null, detail: order.stockReturnStatus ? `Stock return status: ${order.stockReturnStatus}.` : "Stock has not been returned for this order." },
    { label: "Order confirmation email", at: confirmationEmail?.sentAt ?? confirmationEmail?.updatedAt ?? null, detail: confirmationEmail ? `Email status: ${confirmationEmail.status}.` : "No order confirmation email recorded." },
    { label: "Customer notified", at: order.customerCancellationEmailSentAt?.toISOString() ?? cancellationEmail?.sentAt ?? cancellationEmail?.updatedAt ?? null, detail: order.customerCancellationEmailStatus ? `Email status: ${order.customerCancellationEmailStatus}.` : cancellationEmail ? `Email status: ${cancellationEmail.status}.` : "No refund/cancellation email recorded." },
    { label: "Admin note/reason", at: cancellationStarted?.receivedAt.toISOString() ?? null, detail: [order.refundReason ? `Reason: ${order.refundReason}` : null, order.refundNote ? `Note: ${order.refundNote}` : null].filter(Boolean).join(" - ") || "No admin refund/cancellation note recorded." },
    { label: "Packing", at: order.fulfillmentStatus === "packing" || order.status === "packing" ? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "packing" || order.status === "packing" ? "Order is marked packing." : "Not marked packing yet." },
    { label: "Shipped", at: order.fulfillmentStatus === "shipped" ? order.fulfillment?.shippedAt?.toISOString() ?? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "shipped" ? "Order is marked shipped." : "Not shipped yet." },
    { label: "Shipping email", at: shipmentEmail?.sentAt ?? shipmentEmail?.updatedAt ?? null, detail: shipmentEmail ? `Email status: ${shipmentEmail.status}.` : "No shipping email recorded." },
    { label: "Test / smoke marker", at: order.testMarkedAt?.toISOString() ?? null, detail: order.isTestOrder ? `Marked as test/smoke: ${order.testOrderReason ?? "reason not recorded"}.` : "Not marked as a test/smoke order." }
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
  const isLocalPickup = orderIsLocalPickup(order);
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
    isLocalPickup,
    itemCount,
    needsFulfillment,
    isNewPaidOrder,
    statusBadge: orderStatusBadge(order),
    subtotal: order.subtotal,
    shippingCharged: order.shippingCharged,
    shippingMethodLabel: order.shippingMethodLabel,
    shippingRateSource: order.shippingRateSource,
    shippingPackageWeightOz: order.shippingPackageWeightOz,
    shippingPackageLengthIn: order.shippingPackageLengthIn,
    shippingPackageWidthIn: order.shippingPackageWidthIn,
    shippingPackageHeightIn: order.shippingPackageHeightIn,
    shippingPackageProfile: order.shippingPackageProfile,
    shippingWarnings: parseList(order.shippingWarnings),
    shippingQuoteId: order.shippingQuoteId,
    shippingQuoteProvider: order.shippingQuoteProvider,
    shippingCarrier: order.shippingCarrier,
    shippingService: order.shippingService,
    shippingQuotedAmountCents: order.shippingQuotedAmountCents,
    shippingQuotedZip: order.shippingQuotedZip,
    shippingQuoteFallbackUsed: order.shippingQuoteFallbackUsed,
    shippingQuoteExpiresAt: order.shippingQuoteExpiresAt?.toISOString() ?? null,
    shippingZipMismatchReview: order.shippingZipMismatchReview,
    shippingLabelProvider: order.shippingLabelProvider,
    shippingLabelProviderId: order.shippingLabelProviderId,
    shippingLabelUrl: order.shippingLabelUrl,
    shippingLabelFileType: order.shippingLabelFileType,
    shippingTrackingNumber: order.shippingTrackingNumber,
    shippingTrackingUrl: order.shippingTrackingUrl,
    shippingLabelCostCents: order.shippingLabelCostCents,
    shippingLabelCurrency: order.shippingLabelCurrency,
    shippingLabelPurchasedAt: order.shippingLabelPurchasedAt?.toISOString() ?? null,
    shippingLabelVoidedAt: order.shippingLabelVoidedAt?.toISOString() ?? null,
    shippingLabelStatus: order.shippingLabelStatus,
    tax: order.tax,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxableSubtotalCents: order.taxableSubtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    taxProvider: order.taxProvider,
    taxCalculationId: order.taxCalculationId,
    taxJurisdictionCountry: order.taxJurisdictionCountry,
    taxJurisdictionState: order.taxJurisdictionState,
    taxJurisdictionCounty: order.taxJurisdictionCounty,
    taxRateBasisPoints: order.taxRateBasisPoints,
    taxInclusive: order.taxInclusive,
    taxStatus: order.taxStatus,
    taxExemptReason: order.taxExemptReason,
    taxCalculatedAt: order.taxCalculatedAt?.toISOString() ?? null,
    refundedTaxCents: order.refundedTaxCents,
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
    isTestOrder: order.isTestOrder,
    testOrderReason: storefrontTestOrderReasons.has(order.testOrderReason as StorefrontTestOrderReason) ? (order.testOrderReason as StorefrontTestOrderReason) : null,
    testMarkedAt: order.testMarkedAt?.toISOString() ?? null,
    testMarkedBy: order.testMarkedBy ?? null,
    canCancelOrRefund: orderCanCancelOrRefund(order),
    paidAt: order.paidAt?.toISOString() ?? null,
    shippedAt: order.fulfillment?.shippedAt?.toISOString() ?? null,
    canceledAt: order.canceledAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
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
    customerEmailNotifications: customerEmailNotifications(order),
    rewardSummary: rewardSummaryForOrder(order),
    customerRewardSummary: customerRewardSummaryForOrder(order),
    timeline: orderTimeline(order)
  };
}

export async function createCheckoutSession(input: {
  items: Array<{ id: string; quantity: number }>;
  fulfillmentMethod: "shipping" | "pickup";
  customerEmail?: string;
  customerName?: string;
  shippingQuoteToken?: string;
}, options: { requestUrl?: string | null } = {}) {
  const readiness = storefrontStripeReadiness();
  if (!readiness.configured) {
    throw new Error(`Stripe Checkout is not ready. Missing: ${readiness.missing.join(", ")}. Use Request Invoice until these are configured.`);
  }
  const checkoutBaseUrl = storefrontCheckoutBaseUrl(options.requestUrl);
  const [settings, profileDefinitions] = await Promise.all([getStorefrontSettings(), shippingProfileDefinitionsForCheckout()]);
  const onlineTaxEnabled = settings.tax.features.onlineStripeTaxEnabled;
  if (onlineTaxEnabled && input.fulfillmentMethod === "pickup") {
    throw new Error("Tax-enabled Local Pickup requires an approved store-location tax policy before Checkout can continue.");
  }
  const checkoutStartedAt = new Date();
  const reservationExpiresAt = checkoutReservationExpiresAt(checkoutStartedAt);
  await cleanupExpiredReservationsForCheckoutOnly(checkoutStartedAt);
  const cart = await getCartProducts(input.items, { profileDefinitions });
  validateCheckoutReservationAvailability(cart, checkoutStartedAt);
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCalculation = calculateCartShipping(
    cart.map(({ item, quantity }) => ({ ...item, quantity })),
    { subtotal, freeShippingThreshold: settings.freeShippingThreshold, fulfillmentMethod: input.fulfillmentMethod, profileDefinitions }
  );
  let selectedShipping = shippingCalculation.defaultShippingOption;
  if (!selectedShipping) throw new Error("No safe shipping option is available for this cart. Use Request Invoice for manual review.");
  if (input.fulfillmentMethod === "shipping" && selectedShipping.id === "local_pickup") {
    throw new Error("Shipping is not available for one or more cart items. Use Request Invoice for manual review.");
  }
  if (input.fulfillmentMethod === "pickup" && selectedShipping.id !== "local_pickup") {
    throw new Error("Local pickup is not available for one or more cart items.");
  }
  let calculatedQuote: StoredShippingQuote | null = null;
  const shippingRates = shippingRateProviderConfig();
  if (input.fulfillmentMethod === "shipping" && shippingRates.calculatedUspsEnabled) {
    if (!input.shippingQuoteToken) {
      throw new Error("Enter ZIP code to calculate USPS shipping before checkout.");
    }
    calculatedQuote = await prisma.shippingQuote.findUnique({ where: { quoteToken: input.shippingQuoteToken } });
    if (!calculatedQuote) throw new Error("Shipping quote was not found. Recalculate USPS shipping.");
    if (calculatedQuote.expiresAt.getTime() <= checkoutStartedAt.getTime()) {
      throw new Error("Shipping quote expired. Recalculate USPS shipping.");
    }
    if (calculatedQuote.usedAt) {
      throw new Error("Shipping quote was already used. Recalculate USPS shipping.");
    }
    if (calculatedQuote.cartHash !== shippingCartHash(cart, calculatedQuote.destinationZip, profileDefinitions)) {
      throw new Error("Cart changed after shipping was calculated. Recalculate USPS shipping.");
    }
    calculatedQuote = applyMerchantShippingPolicyToStoredQuote(calculatedQuote, shippingCalculation);
    selectedShipping = shippingOptionFromQuote(calculatedQuote);
  }
  const checkoutShippingOptions = stripeShippingOptionsForCheckout(shippingCalculation, calculatedQuote);
  if (onlineTaxEnabled) {
    for (const option of checkoutShippingOptions) {
      if (option.shipping_rate_data) {
        option.shipping_rate_data.tax_behavior = "exclusive";
        option.shipping_rate_data.tax_code = settings.tax.shippingStripeTaxCode ?? "txcd_92010001";
      }
    }
  }
  if (!checkoutShippingOptions.length) throw new Error("No safe shipping option is available for this cart. Use Request Invoice for manual review.");
  const shippingCharged = selectedShipping.amount;
  const total = subtotal + shippingCharged;
  const subtotalCents = centsFromMoney(subtotal);
  const shippingCents = centsFromMoney(shippingCharged);
  const totalCents = subtotalCents + shippingCents;
  const stripeTaxCodeByInventoryId = onlineTaxEnabled
    ? new Map(
        cart.map(({ item, product }) => [
          item.id,
          requiredStripeTaxCode(
            {
              explicitCode: item.stripeTaxCode,
              defaultCode: settings.tax.defaultStripeTaxCode,
              taxableOverride: item.taxableOverride
            },
            product.title
          )
        ])
      )
    : null;
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.storefrontOrder.create({
      data: {
        orderNumber: orderNumber(),
        userId: cart[0]?.item.userId ?? null,
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        subtotal,
        subtotalCents,
        shippingCents,
        totalCents,
        taxProvider: onlineTaxEnabled ? "stripe_tax" : null,
        taxStatus: onlineTaxEnabled ? "calculated" : "not_recorded",
        taxInclusive: onlineTaxEnabled ? false : null,
        shippingCharged,
        shippingMethodLabel: selectedShipping.label,
        shippingRateSource: selectedShipping.rateSource,
        shippingPackageWeightOz: shippingCalculation.actualWeightOz,
        shippingPackageLengthIn: shippingCalculation.packageLengthIn,
        shippingPackageWidthIn: shippingCalculation.packageWidthIn,
        shippingPackageHeightIn: shippingCalculation.packageHeightIn,
        shippingPackageProfile: shippingCalculation.packageProfile,
        shippingWarnings: stringifyList(shippingCalculation.warnings),
        shippingQuoteId: calculatedQuote?.quoteToken ?? null,
        shippingQuoteProvider: calculatedQuote?.provider ?? null,
        shippingCarrier: calculatedQuote?.carrier ?? null,
        shippingService: calculatedQuote?.service ?? null,
        shippingQuotedAmountCents: calculatedQuote?.amountCents ?? null,
        shippingQuotedZip: calculatedQuote?.destinationZip ?? null,
        shippingQuoteFallbackUsed: calculatedQuote?.fallbackUsed ?? false,
        shippingQuoteRateProviderRef: calculatedQuote?.rateProviderRef ?? null,
        shippingQuoteShipmentProviderRef: calculatedQuote?.shipmentProviderRef ?? null,
        shippingQuoteExpiresAt: calculatedQuote?.expiresAt ?? null,
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
    shippingQuoteId: calculatedQuote?.quoteToken ?? "",
    shippingQuoteProvider: calculatedQuote?.provider ?? "",
    internalReservationExpiresAt: reservationExpiresAt.toISOString(),
    internalReservationMinutes: String(reservationMinutes)
  };
  const stripe = stripeClient();
  let createdSession: Stripe.Checkout.Session | null = null;
  let createdPickupCustomerId: string | null = null;
  try {
    const localPickupUsesStripeTax = onlineTaxEnabled && selectedShipping.id === "local_pickup";
    const pickupLocation = localPickupUsesStripeTax && order.userId
      ? await resolveTaxLocation(order.userId, "local_pickup")
      : null;
    const pickupAddress = pickupLocation ? taxLocationAddress(pickupLocation) : {
      line1: settings.tax.storeAddressLine1 ?? "",
      line2: settings.tax.storeAddressLine2,
      city: settings.tax.storeCity ?? "",
      state: settings.tax.storeState,
      postalCode: settings.tax.storePostalCode ?? "",
      country: settings.tax.storeCountry
    };
    const pickupSnapshot = taxLocationSnapshot(pickupLocation);
    if (localPickupUsesStripeTax && (!pickupAddress.line1 || !pickupAddress.city || !pickupAddress.postalCode)) {
      throw new Error("Local Pickup tax requires a complete verified store address.");
    }
    const localPickupTaxCustomer = localPickupUsesStripeTax
      ? await stripe.customers.create({
          email: input.customerEmail,
          name: input.customerName,
          shipping: {
            name: input.customerName || input.customerEmail || "Customer",
            address: {
              line1: pickupAddress.line1,
              line2: pickupAddress.line2 ?? undefined,
              city: pickupAddress.city,
              state: pickupAddress.state,
              postal_code: pickupAddress.postalCode,
              country: pickupAddress.country
            }
          },
          metadata: { channel: "online_local_pickup", order_id: order.id }
        }, { idempotencyKey: `tax-pickup-customer:${order.id}` })
      : null;
    createdPickupCustomerId = localPickupTaxCustomer?.id ?? null;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(onlineTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
      ...(localPickupTaxCustomer ? { customer: localPickupTaxCustomer.id } : { customer_email: input.customerEmail, customer_creation: "always" as const }),
      phone_number_collection: { enabled: true },
      billing_address_collection: "auto",
      ...(onlineTaxEnabled ? { billing_address_collection: "required" as const } : {}),
      ...(localPickupTaxCustomer ? {} : { shipping_address_collection: { allowed_countries: stripeShippingAllowedCountries } }),
      shipping_options: checkoutShippingOptions,
      expires_at: stripeCheckoutSessionExpiresAt(checkoutStartedAt),
      line_items: [
        ...order.items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(item.unitPrice * 100),
            ...(onlineTaxEnabled ? { tax_behavior: "exclusive" as const } : {}),
            product_data: {
              name: item.publicTitle,
              images: stripeImage(item.imageUrl),
              ...(onlineTaxEnabled
                ? {
                    tax_code: stripeTaxCodeByInventoryId?.get(item.inventoryItemId)
                  }
                : {})
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
      if (calculatedQuote) {
        await tx.shippingQuote.update({
          where: { id: calculatedQuote.id },
          data: { orderId: order.id, usedAt: new Date(), amountCents: calculatedQuote.amountCents }
        });
      }
      return tx.storefrontOrder.update({
        where: { id: order.id },
        data: {
          stripeCheckoutSessionId: session.id,
          taxLocationId: pickupSnapshot.id,
          taxLocationNameSnapshot: pickupSnapshot.name,
          taxLocationSnapshotJson: pickupSnapshot.json
        },
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
    if (createdPickupCustomerId) {
      await stripe.customers.del(createdPickupCustomerId).catch(() => null);
    }
    await releaseReservationsForSession(createdSession?.id ?? null, order.id);
    try {
      await prisma.storefrontOrder.delete({ where: { id: order.id } });
    } catch {
      await prisma.storefrontOrder.updateMany({
        where: { id: order.id, stripeCheckoutSessionId: null },
        data: {
          status: "canceled",
          paymentStatus: "failed",
          canceledAt: new Date(),
          notes: "Secure Checkout could not start. No payment was created."
        }
      });
    }
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
  const [settings, profileDefinitions] = await Promise.all([getStorefrontSettings(), shippingProfileDefinitionsForCheckout()]);
  const cart = await getCartProducts(input.items, { profileDefinitions });
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCalculation = calculateCartShipping(
    cart.map(({ item, quantity }) => ({ ...item, quantity })),
    { subtotal, freeShippingThreshold: settings.freeShippingThreshold, fulfillmentMethod: input.fulfillmentMethod, profileDefinitions }
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
      shippingPackageWeightOz: shippingCalculation.actualWeightOz,
      shippingPackageLengthIn: shippingCalculation.packageLengthIn,
      shippingPackageWidthIn: shippingCalculation.packageWidthIn,
      shippingPackageHeightIn: shippingCalculation.packageHeightIn,
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
      const result = await sendStorefrontEmail(
        contactEmail,
        `GameDayGrabs contact: ${input.subject}`,
        `${input.name} <${input.email}> sent a storefront message.\n\n${input.message}\n\nInquiry: ${order.orderNumber}`
      );
      emailSent = result.status === "sent";
      emailError = result.status === "failed" ? result.failureReason : null;
    } catch (error) {
      emailError = error instanceof Error ? error.message.slice(0, 240) : "Email provider send failed.";
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
    delivery: emailSent ? "email_sent" : emailError ? "stored_email_failed" : contactEmail ? "stored_email_provider_missing" : "stored_contact_email_missing",
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
    const netProfit = Math.max(0, order.total - order.tax) - order.stripeFeeEstimate - order.shippingCost - orderCostBasis;
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
  if (paymentStatus === "expired") {
    await sendStorefrontCheckoutExpiredEmail(order, "Stripe Checkout expired before payment completed.");
  } else {
    await recordExpiredCheckoutEmailSkipped(order, "Failed unpaid checkout sessions are not emailed automatically.");
  }
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
  if (event.type.startsWith("refund.") && "payment_intent" in object) {
    const paymentIntentId = stripeIdFromUnknown(object.payment_intent);
    if (paymentIntentId) {
      return prisma.storefrontOrder.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, include: storefrontOrderInclude });
    }
  }
  return null;
}

async function loadFreshStorefrontOrder(orderId: string) {
  return prisma.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, include: storefrontOrderInclude });
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
    amount_discount?: number | null;
    amount_tax?: number | null;
    breakdown?: unknown;
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
  shippingPackageLengthIn: number | null;
  shippingPackageWidthIn: number | null;
  shippingPackageHeightIn: number | null;
  shippingPackageProfile: string | null;
  shippingWarnings: string[];
  shippingQuoteId: string | null;
  shippingQuoteProvider: string | null;
  shippingCarrier: string | null;
  shippingService: string | null;
  shippingQuotedAmountCents: number | null;
  shippingQuotedZip: string | null;
  shippingQuoteFallbackUsed: boolean;
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
    amountTax: numberValue(recordValue(object.total_details)?.amount_tax),
    amount: numberValue(object.amount),
    currency: stringValue(object.currency)?.toLowerCase() ?? null
  };
  return JSON.stringify(safePayload);
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
  const length = Number(metadata.shippingPackageLengthIn);
  const width = Number(metadata.shippingPackageWidthIn);
  const height = Number(metadata.shippingPackageHeightIn);
  const quotedAmountCents = Number(metadata.shippingQuotedAmountCents);
  const metadataWarnings = parseList(metadata.shippingWarnings);
  return {
    shippingCharged: fallback.shippingCharged,
    shippingMethodLabel: metadata.shippingOptionLabel || rate.display_name || fallback.shippingMethodLabel,
    shippingRateSource: "stripe_checkout",
    shippingPackageWeightOz: Number.isFinite(weight) ? weight : fallback.shippingPackageWeightOz,
    shippingPackageLengthIn: Number.isFinite(length) && length > 0 ? length : fallback.shippingPackageLengthIn,
    shippingPackageWidthIn: Number.isFinite(width) && width > 0 ? width : fallback.shippingPackageWidthIn,
    shippingPackageHeightIn: Number.isFinite(height) && height > 0 ? height : fallback.shippingPackageHeightIn,
    shippingPackageProfile: metadata.shippingPackageProfile || fallback.shippingPackageProfile,
    shippingWarnings: metadataWarnings.length ? metadataWarnings : fallback.shippingWarnings,
    shippingQuoteId: metadata.shippingQuoteId || fallback.shippingQuoteId,
    shippingQuoteProvider: metadata.shippingQuoteProvider || fallback.shippingQuoteProvider,
    shippingCarrier: metadata.shippingCarrier || fallback.shippingCarrier,
    shippingService: metadata.shippingService || fallback.shippingService,
    shippingQuotedAmountCents: Number.isFinite(quotedAmountCents) ? quotedAmountCents : fallback.shippingQuotedAmountCents,
    shippingQuotedZip: metadata.shippingQuotedZip || fallback.shippingQuotedZip,
    shippingQuoteFallbackUsed: metadata.shippingQuoteFallbackUsed === "true" || fallback.shippingQuoteFallbackUsed
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
    shippingPackageLengthIn: order.shippingPackageLengthIn,
    shippingPackageWidthIn: order.shippingPackageWidthIn,
    shippingPackageHeightIn: order.shippingPackageHeightIn,
    shippingPackageProfile: order.shippingPackageProfile,
    shippingWarnings: parseList(order.shippingWarnings),
    shippingQuoteId: order.shippingQuoteId,
    shippingQuoteProvider: order.shippingQuoteProvider,
    shippingCarrier: order.shippingCarrier,
    shippingService: order.shippingService,
    shippingQuotedAmountCents: order.shippingQuotedAmountCents,
    shippingQuotedZip: order.shippingQuotedZip,
    shippingQuoteFallbackUsed: order.shippingQuoteFallbackUsed
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

export function checkoutTaxSnapshot(session: Stripe.Checkout.Session, order: StorefrontOrderWithItems, customer: CheckoutCustomerSnapshot) {
  const withTotals = session as StripeCheckoutSessionWithShipping;
  const automaticTaxEnabled = Boolean(session.automatic_tax?.enabled || order.taxProvider === "stripe_tax");
  const automaticTaxStatus = session.automatic_tax?.status ?? null;
  if (order.taxProvider === "stripe_tax" && (!session.automatic_tax?.enabled || automaticTaxStatus !== "complete")) {
    throw new Error("Stripe Tax did not return a complete authoritative calculation for this checkout.");
  }
  if (
    automaticTaxEnabled &&
    (typeof session.amount_subtotal !== "number" ||
      typeof withTotals.total_details?.amount_discount !== "number" ||
      typeof withTotals.total_details?.amount_shipping !== "number" ||
      typeof withTotals.total_details?.amount_tax !== "number" ||
      typeof session.amount_total !== "number")
  ) {
    throw new Error("Stripe Tax did not return complete authoritative checkout totals.");
  }
  const subtotalCents = typeof session.amount_subtotal === "number" ? session.amount_subtotal : centsFromMoney(order.subtotal);
  const discountCents = typeof withTotals.total_details?.amount_discount === "number" ? withTotals.total_details.amount_discount : 0;
  const shippingCents = typeof withTotals.total_details?.amount_shipping === "number"
    ? withTotals.total_details.amount_shipping
    : centsFromMoney(order.shippingCharged);
  const taxCents = automaticTaxEnabled && typeof withTotals.total_details?.amount_tax === "number"
    ? withTotals.total_details.amount_tax
    : null;
  const totalCents = typeof session.amount_total === "number" ? session.amount_total : subtotalCents - discountCents + shippingCents + (taxCents ?? 0);
  const taxableSubtotalCents = automaticTaxEnabled ? Math.max(0, subtotalCents - discountCents) : null;
  const jurisdictionAddress = customer.shippingAddress ?? customer.billingAddress;
  const country = jurisdictionAddress?.country?.toUpperCase() ?? null;
  const state = jurisdictionAddress?.state?.toUpperCase() ?? null;
  const rateBasisPoints = taxableSubtotalCents !== null && taxableSubtotalCents > 0 && taxCents !== null
    ? Math.round((taxCents * 10_000) / taxableSubtotalCents)
    : null;
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    taxableSubtotalCents,
    taxCents,
    totalCents,
    taxProvider: automaticTaxEnabled ? "stripe_tax" : null,
    taxCalculationId: automaticTaxEnabled ? session.id : null,
    taxJurisdictionCountry: country,
    taxJurisdictionState: state,
    taxJurisdictionCounty: null,
    taxRateBasisPoints: rateBasisPoints,
    taxInclusive: automaticTaxEnabled ? false : null,
    taxStatus: automaticTaxEnabled ? "collected" : "not_recorded",
    taxCalculatedAt: automaticTaxEnabled ? new Date() : null,
    taxBreakdownJson: automaticTaxEnabled
      ? safeTaxBreakdownJson({ country, state, county: null, jurisdiction: "Stripe Tax Checkout", rateBasisPoints, amountCents: taxCents })
      : null
  };
}

async function syncStorefrontCustomerTotals(customerId: string, customerEmail: string) {
  const paidOrders = await prisma.storefrontOrder.findMany({
    where: { customerEmail, paymentStatus: { in: activeRevenuePaymentStatuses }, ...storefrontRealBusinessOrderWhere() },
    select: { total: true, totalCents: true, tax: true, taxCents: true, refundedAmount: true, refundedTaxCents: true, paidAt: true, createdAt: true }
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
  const taxSnapshot = checkoutTaxSnapshot(session, order, snapshot);
  const shippingCharged = shippingSnapshot.shippingCharged ?? order.shippingCharged;
  const subtotal = moneyFromCents(taxSnapshot.subtotalCents);
  const tax = taxSnapshot.taxCents === null ? order.tax : moneyFromCents(taxSnapshot.taxCents);
  const total = moneyFromCents(taxSnapshot.totalCents);
  const collectedZip = String(snapshot.shippingAddress?.postal_code || "").replace(/\D/g, "").slice(0, 5);
  const quotedZip = String(shippingSnapshot.shippingQuotedZip || order.shippingQuotedZip || "").replace(/\D/g, "").slice(0, 5);
  const shippingZipMismatchReview = Boolean(quotedZip && collectedZip && quotedZip !== collectedZip);
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
  const claimed = await prisma.storefrontOrder.updateMany({
    where: {
      id: order.id,
      paymentStatus: { notIn: ["paid", "partially_refunded", "refunded", "refund_pending"] },
      status: { notIn: ["canceled", "refunded", "partially_refunded", "refund_pending"] }
    },
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
      subtotal,
      tax,
      shippingCharged,
      ...taxSnapshot,
      shippingMethodLabel: shippingSnapshot.shippingMethodLabel,
      shippingRateSource: shippingSnapshot.shippingRateSource ?? "stripe_checkout",
      shippingPackageWeightOz: shippingSnapshot.shippingPackageWeightOz,
      shippingPackageLengthIn: shippingSnapshot.shippingPackageLengthIn,
      shippingPackageWidthIn: shippingSnapshot.shippingPackageWidthIn,
      shippingPackageHeightIn: shippingSnapshot.shippingPackageHeightIn,
      shippingPackageProfile: shippingSnapshot.shippingPackageProfile,
      shippingWarnings: stringifyList(shippingSnapshot.shippingWarnings),
      shippingQuoteId: shippingSnapshot.shippingQuoteId,
      shippingQuoteProvider: shippingSnapshot.shippingQuoteProvider,
      shippingCarrier: shippingSnapshot.shippingCarrier,
      shippingService: shippingSnapshot.shippingService,
      shippingQuotedAmountCents: shippingSnapshot.shippingQuotedAmountCents,
      shippingQuotedZip: shippingSnapshot.shippingQuotedZip,
      shippingQuoteFallbackUsed: shippingSnapshot.shippingQuoteFallbackUsed,
      shippingZipMismatchReview,
      total,
      stripeFeeEstimate: estimateStripeFee(total)
    }
  });
  const updated = await loadFreshStorefrontOrder(order.id);
  return { customer, order: updated, customerEmail: snapshot.customerEmail, persisted: claimed.count === 1 };
}

async function completePaidCheckoutSideEffects(order: StorefrontOrderWithItems) {
  if (order.paymentStatus !== "paid") return;
  await awardRewardsForPaidOrder(order);
  await sendStorefrontOrderConfirmationEmail(order);
  const customerEmail = order.customerEmail ?? order.customer?.email ?? null;
  if (order.customer && customerEmail) await syncStorefrontCustomerTotals(order.customer.id, customerEmail);
}

export async function applyStripeRefundSnapshot(input: {
  orderId: string;
  providerRefundId: string;
  amountCents: number;
  status: string | null;
}) {
  if (input.status !== "succeeded") return { applied: false, reason: "provider_refund_not_succeeded" as const };
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TaxRefundAmountError("Stripe returned an invalid refund amount.");
  }

  return runTaxRefundTransaction(async (tx) => {
    await lockStorefrontOrderForRefund(tx, input.orderId);
    const duplicate = await tx.taxAdjustment.findFirst({
      where: {
        storefrontOrderId: input.orderId,
        channel: "online",
        providerReference: input.providerRefundId
      },
      select: { id: true }
    });
    if (duplicate) return { applied: false, reason: "duplicate_provider_refund" as const };

    const current = await tx.storefrontOrder.findUnique({
      where: { id: input.orderId },
      include: storefrontOrderInclude
    });
    if (!current) throw new Error("Order not found");
    if (!["paid", "partially_refunded", "refund_pending", "refunded"].includes(current.paymentStatus)) {
      throw new TaxRefundConflictError("The payment snapshot is not finalized yet. Retry the provider refund event.");
    }

    const totalCents = orderTotalCents(current);
    const previousRefundedCents = orderRefundedCents(current);
    const remainingRefundableCents = Math.max(0, totalCents - previousRefundedCents);
    if (remainingRefundableCents <= 0) return { applied: false, reason: "order_already_fully_refunded" as const };
    const refundCents = Math.min(input.amountCents, remainingRefundableCents);
    const nextRefundedCents = previousRefundedCents + refundCents;
    const hasTaxSnapshot = current.taxCents !== null;
    const nextRefundedTaxCents = hasTaxSnapshot
      ? cumulativeRefundedTaxCents({
          originalTaxCents: current.taxCents,
          originalTotalCents: current.totalCents ?? totalCents,
          cumulativeRefundedAmountCents: nextRefundedCents
        })
      : null;
    const refundedTaxDeltaCents = Math.max(0, (nextRefundedTaxCents ?? 0) - (current.refundedTaxCents ?? 0));
    const fullyRefunded = nextRefundedCents >= totalCents;
    const paymentStatus = fullyRefunded ? "refunded" : "partially_refunded";
    const updated = await tx.storefrontOrder.update({
      where: { id: current.id },
      data: {
        status: paymentStatus,
        paymentStatus,
        refundStatus: paymentStatus,
        refundedAmount: moneyFromCents(nextRefundedCents),
        refundedTaxCents: nextRefundedTaxCents,
        refundedAt: new Date(),
        taxStatus: nextRefundedTaxCents === null
          ? current.taxStatus
          : fullyRefunded && nextRefundedTaxCents >= (current.taxCents ?? 0)
            ? "refunded"
            : refundedTaxDeltaCents > 0
              ? "partially_refunded"
              : current.taxStatus,
        stripeRefundId: input.providerRefundId,
        refundCurrency: "usd"
      },
      include: storefrontOrderInclude
    });

    await tx.taxAdjustment.create({
      data: {
        idempotencyKey: `tax:stripe-refund:${input.providerRefundId}`,
        channel: "online",
        adjustmentType: fullyRefunded ? "full_refund" : "partial_refund",
        storefrontOrderId: current.id,
        providerReference: input.providerRefundId,
        refundedAmountCents: refundCents,
        refundedTaxCents: refundedTaxDeltaCents,
        reason: "stripe_provider_refund",
        metadataJson: JSON.stringify({
          originalTaxCents: current.taxCents,
          previousRefundedTaxCents: current.refundedTaxCents,
          cumulativeRefundedTaxCents: nextRefundedTaxCents,
          providerAmountCents: input.amountCents,
          appliedAmountCents: refundCents,
          allocation: current.taxCents === null ? "historical_unknown" : "proportional_original_snapshot"
        })
      }
    });

    await reverseRewardsForOrder(
      updated,
      {
        reason: "refund",
        idempotencyKey: `stripe:${input.providerRefundId}`,
        refundedAmount: moneyFromCents(Math.max(0, nextRefundedCents - (nextRefundedTaxCents ?? 0)))
      },
      tx
    );
    return {
      applied: true,
      reason: "provider_refund_applied" as const,
      refundedAmountCents: refundCents,
      refundedTaxCents: refundedTaxDeltaCents,
      paymentStatus
    };
  });
}

async function processStripeWebhookEvent(event: Stripe.Event, initialOrder: StorefrontOrderWithItems | null) {
  let order = initialOrder;
  if (event.type === "checkout.session.completed") {
    const receivedSession = event.data.object as Stripe.Checkout.Session;
    if (!order) return { ok: true, skipped: "order_not_found" };
    if (receivedSession.payment_status !== "paid") return { ok: true, skipped: "checkout_session_not_paid" };
    if (order.paymentStatus === "paid") {
      await completePaidCheckoutSideEffects(order);
      return { ok: true, skipped: "checkout_session_already_finalized" };
    }
    if (["partially_refunded", "refunded"].includes(order.paymentStatus)) {
      return { ok: true, skipped: "checkout_session_already_finalized" };
    }
    const session = await stripeClient().checkout.sessions.retrieve(receivedSession.id);
    if (session.payment_status !== "paid") return { ok: true, skipped: "checkout_session_not_paid" };
    order = await loadFreshStorefrontOrder(order.id);
    if (order.paymentStatus === "paid") {
      await completePaidCheckoutSideEffects(order);
      return { ok: true, skipped: "checkout_session_already_finalized" };
    }
    if (
      ["partially_refunded", "refunded"].includes(order.paymentStatus) ||
      ["canceled", "refunded", "partially_refunded", "refund_pending"].includes(order.status)
    ) {
      return { ok: true, skipped: "checkout_session_already_finalized" };
    }
    const persisted = await persistPaidCheckoutSession(order, session);
    order = persisted.order;
    if (!persisted.persisted) return { ok: true, skipped: "checkout_session_state_changed" };
    if (order.paymentStatus !== "paid") {
      await createStorefrontSale(order);
      order = await loadFreshStorefrontOrder(order.id);
    }
    await completePaidCheckoutSideEffects(order);
    return { ok: true };
  }
  if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = event.data.object as Stripe.Refund;
    if (!order) return { ok: true, skipped: "order_not_found" };
    const result = await applyStripeRefundSnapshot({
      orderId: order.id,
      providerRefundId: refund.id,
      amountCents: refund.amount,
      status: refund.status
    });
    return { ok: true, ...result };
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

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const secret = envValue("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signature) throw new Error("Missing Stripe webhook signature.");
  const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  const order = await orderForStripeEvent(event);
  const orderId = order?.id ?? null;
  const payload = safeStripeEventPayload(event, orderId);
  const claim = await claimProviderEvent({
    eventId: event.id,
    eventType: event.type,
    orderId,
    provider: "stripe",
    payload
  });
  if (claim !== "claimed") return { ok: true, skipped: claim === "duplicate" ? "duplicate_event" : "event_processing" };
  try {
    const result = await processStripeWebhookEvent(event, order);
    await completeProviderEvent({ eventId: event.id, eventType: event.type, orderId, payload });
    return result;
  } catch (error) {
    await abandonProviderEvent({ eventId: event.id, eventType: event.type }).catch(() => null);
    throw error;
  }
}

export async function updateInventoryStoreListing(
  currentUser: SessionUser,
  itemId: string,
  input: {
    publishToStore?: boolean;
    publicSlug?: string;
    publicTitle?: string;
    publicDescription?: string;
    publicPrice?: number;
    compareAtPrice?: number;
    publicImages?: unknown;
    availableForSale?: number;
    purchaseLimitEnabled?: boolean;
    maxQuantityPerOrder?: number | null;
    shippingProfile?: string;
    packageWeightOz?: number | null;
    packageLengthIn?: number | null;
    packageWidthIn?: number | null;
    packageHeightIn?: number | null;
    shippingMetadataSource?: string | null;
    freeShippingEligible?: boolean;
    requiresBox?: boolean;
    insuranceRecommended?: boolean;
    storeStatus?: "draft" | "active" | "hidden" | "sold_out";
    localPickupAvailable?: boolean;
    shippingAvailable?: boolean;
    storefrontCategory?: string;
    storefrontTags?: unknown;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: storefrontInventoryInclude
  });
  if (!item) throw new Error("Inventory item not found");
  const publishToStore = input.publishToStore ?? item.publishToStore;
  const publicTitle = cleanStorefrontTitle(input.publicTitle || item.publicTitle || item.itemName);
  const shouldEnsurePublicSlug = input.publicSlug !== undefined || (input.publishToStore === true && !item.publicSlug);
  const publicSlug =
    input.publicSlug !== undefined
      ? input.publicSlug
        ? await uniqueSlug(input.publicSlug, item.id)
        : null
      : item.publicSlug || (shouldEnsurePublicSlug ? await uniqueSlug(publicTitle, item.id) : null);
  const publicImageList = input.publicImages !== undefined ? stringifyList(input.publicImages) : undefined;
  const storefrontCategory = input.storefrontCategory || item.storefrontCategory || publicCategoryForItem(item);
  const onHandQuantity = Math.max(0, quantityOwned(item));
  const requestedAvailableForSale =
    input.availableForSale === undefined ? item.availableForSale ?? onHandQuantity : Math.max(0, input.availableForSale);
  const availableForSale = Math.min(onHandQuantity, requestedAvailableForSale);
  const requestedStoreStatus = input.storeStatus ?? item.storeStatus;
  const normalizedStoreStatus = publishToStore && availableForSale <= 0 ? "sold_out" : requestedStoreStatus;
  const enteredPurchaseLimit = input.maxQuantityPerOrder ?? null;
  const purchaseLimitEnabled = Boolean(
    input.purchaseLimitEnabled ?? (input.maxQuantityPerOrder !== undefined ? enteredPurchaseLimit !== null : item.purchaseLimitEnabled)
  );
  const maxQuantityPerOrder = purchaseLimitEnabled
    ? enteredPurchaseLimit ?? item.maxQuantityPerOrder ?? DEFAULT_STOREFRONT_PURCHASE_LIMIT
    : DEFAULT_STOREFRONT_PURCHASE_LIMIT;
  const shouldUpdatePublicDescription =
    input.publicDescription !== undefined ||
    input.publicTitle !== undefined ||
    input.storefrontCategory !== undefined ||
    input.storeStatus !== undefined ||
    input.availableForSale !== undefined ||
    input.publishToStore !== undefined;
  const publicDescription = shouldUpdatePublicDescription ? cleanStorefrontDescription({
    title: publicTitle,
    itemName: item.itemName,
    brand: item.brand,
    category: storefrontCategory,
    setName: item.setName,
    publicDescription: input.publicDescription ?? item.publicDescription,
    description: item.description,
    status: normalizedStoreStatus,
    availableQuantity: availableForSale
  }) : undefined;
  const publicPrice = input.publicPrice ?? item.publicPrice;
  const isPublicStatus = ["active", "sold_out"].includes(normalizedStoreStatus);
  const shouldStampPublishedAt = publishToStore && isPublicStatus && !item.publishedAt;
  const publicStatusTouched = input.publishToStore !== undefined || input.storeStatus !== undefined || input.publicPrice !== undefined;

  if (publicStatusTouched && isPublicStatus && (!publicPrice || publicPrice <= 0)) {
    throw new Error("Set a public price before activating a store listing.");
  }

  return prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      publishToStore: input.publishToStore,
      publicSlug: shouldEnsurePublicSlug ? publicSlug : input.publicSlug !== undefined ? publicSlug : undefined,
      publicTitle: input.publicTitle !== undefined ? publicTitle : undefined,
      publicDescription,
      publicPrice: input.publicPrice,
      compareAtPrice: input.compareAtPrice,
      publicImages: publicImageList,
      availableForSale: input.availableForSale !== undefined ? availableForSale : undefined,
      maxQuantityPerOrder: input.purchaseLimitEnabled !== undefined || input.maxQuantityPerOrder !== undefined ? maxQuantityPerOrder : undefined,
      purchaseLimitEnabled: input.purchaseLimitEnabled !== undefined || input.maxQuantityPerOrder !== undefined ? purchaseLimitEnabled : undefined,
      shippingProfile: input.shippingProfile,
      packageWeightOz: input.packageWeightOz,
      packageLengthIn: input.packageLengthIn,
      packageWidthIn: input.packageWidthIn,
      packageHeightIn: input.packageHeightIn,
      shippingMetadataSource: input.shippingMetadataSource,
      freeShippingEligible: input.freeShippingEligible,
      requiresBox: input.requiresBox,
      insuranceRecommended: input.insuranceRecommended,
      storeStatus: input.storeStatus !== undefined || input.publishToStore !== undefined || input.availableForSale !== undefined ? normalizedStoreStatus : undefined,
      localPickupAvailable: input.localPickupAvailable,
      shippingAvailable: input.shippingAvailable,
      storefrontCategory: input.storefrontCategory !== undefined ? storefrontCategory : undefined,
      storefrontTags: input.storefrontTags !== undefined ? stringifyList(input.storefrontTags) : undefined,
      publishedAt: shouldStampPublishedAt ? new Date() : undefined
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
        purchaseLimitEnabled: item.purchaseLimitEnabled,
        shippingProfile: item.shippingProfile || "standard",
        packageWeightOz: item.packageWeightOz,
        packageLengthIn: item.packageLengthIn,
        packageWidthIn: item.packageWidthIn,
        packageHeightIn: item.packageHeightIn,
        shippingMetadataSource: item.shippingMetadataSource,
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

const publicOrderLookupMiss = "We could not find an order with that order number and email.";

function publicPickupStatus(order: StorefrontOrderWithItems) {
  if (!orderIsLocalPickup(order)) return null;
  if (order.fulfillmentStatus === "picked_up") return "Picked up";
  if (order.fulfillmentStatus === "pickup_ready") return "Ready for pickup";
  return "Pickup pending";
}

export async function lookupPublicOrderStatus(input: { orderNumber: string; email: string }): Promise<PublicOrderStatusLookupDTO> {
  const orderNumber = input.orderNumber.trim().toUpperCase();
  const email = normalizedCustomerEmail(input.email);
  if (!orderNumber || !email) return { found: false, message: publicOrderLookupMiss };

  const order = await prisma.storefrontOrder.findFirst({
    where: { orderNumber },
    include: storefrontOrderInclude
  });
  if (!order) return { found: false, message: publicOrderLookupMiss };
  if (normalizedCustomerEmail(order.customerEmail ?? order.customer?.email) !== email) {
    return { found: false, message: publicOrderLookupMiss };
  }

  const settings = await getStorefrontSettings();
  const isLocalPickup = orderIsLocalPickup(order);
  return {
    found: true,
    order: {
      orderNumber: order.orderNumber,
      orderDate: order.createdAt.toISOString(),
      status: orderStatusBadge(order),
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      fulfillmentMethod: isLocalPickup ? "local_pickup" : "shipping",
      merchandiseSubtotal: order.subtotalCents === null ? order.subtotal : moneyFromCents(order.subtotalCents),
      discount: order.discountCents === null ? 0 : moneyFromCents(order.discountCents),
      shippingMethodLabel: order.shippingMethodLabel,
      shippingCharged: order.shippingCents === null ? order.shippingCharged : moneyFromCents(order.shippingCents),
      tax: order.taxCents === null ? null : moneyFromCents(order.taxCents),
      totalPaid: order.totalCents === null ? order.total : moneyFromCents(order.totalCents),
      carrier: isLocalPickup ? null : order.carrier,
      trackingNumber: isLocalPickup ? null : order.trackingNumber,
      trackingUrl: isLocalPickup ? null : trackingUrlFor(order.carrier, order.trackingNumber),
      pickupStatus: publicPickupStatus(order),
      refundStatus: order.refundStatus ?? (order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded" ? order.paymentStatus : null),
      refundedAmount: order.refundedAmount,
      refundedTax: order.taxCents === null ? null : moneyFromCents(order.refundedTaxCents ?? 0),
      canceledAt: order.canceledAt?.toISOString() ?? null,
      refundedAt: order.refundedAt?.toISOString() ?? null,
      supportEmail: settings.contactEmail || defaultStorefrontContactEmail,
      items: order.items.map((item) => ({
        title: item.publicTitle,
        quantity: item.quantity,
        imageUrl: item.imageUrl ?? getSavedProductImageUrls(item.inventoryItem, { publicOnly: true }).find(isStorefrontDisplayImageUrl) ?? null
      }))
    }
  };
}

export async function storefrontSummary(currentUser: SessionUser): Promise<StorefrontSummaryDTO> {
  const where = currentUser.role === "ADMIN" ? {} : { userId: currentUser.id };
  const realBusinessOrderWhere = storefrontRealBusinessOrderWhere();
  const localPickupOrderWhere: Prisma.StorefrontOrderWhereInput = {
    OR: [{ shippingMethodLabel: "Local Pickup" }, { shippingPackageProfile: "local_pickup" }]
  };
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [productCount, activeProductCount, pendingOrderCount, inquiryCount, newPaidOrderCount, ordersToShipCount, pickupOrderCount, paidOrders, todayPaidOrders, lastPaidOrder, lastWebhook, testOrderCount] = await Promise.all([
    prisma.inventoryItem.count({ where: { ...(where as Prisma.InventoryItemWhereInput), publishToStore: true } }),
    prisma.inventoryItem.count({
      where: {
        ...(where as Prisma.InventoryItemWhereInput),
        publishToStore: true,
        storeStatus: { in: ["active", "sold_out"] }
      }
    }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), status: "pending_payment", ...realBusinessOrderWhere } }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), status: { in: ["invoice_requested", "contact_message"] }, ...realBusinessOrderWhere } }),
    prisma.storefrontOrder.count({
      where: {
        ...(where as Prisma.StorefrontOrderWhereInput),
        ...realBusinessOrderWhere,
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        NOT: localPickupOrderWhere
      }
    }),
    prisma.storefrontOrder.count({
      where: {
        ...(where as Prisma.StorefrontOrderWhereInput),
        ...realBusinessOrderWhere,
        paymentStatus: "paid",
        fulfillmentStatus: { in: ["unfulfilled", "packing"] },
        NOT: localPickupOrderWhere
      }
    }),
    prisma.storefrontOrder.count({
      where: {
        ...(where as Prisma.StorefrontOrderWhereInput),
        ...realBusinessOrderWhere,
        paymentStatus: "paid",
        fulfillmentStatus: { in: ["unfulfilled", "pickup_ready"] },
        ...localPickupOrderWhere
      }
    }),
    prisma.storefrontOrder.findMany({
      where: { ...(where as Prisma.StorefrontOrderWhereInput), ...realBusinessOrderWhere, paymentStatus: { in: activeRevenuePaymentStatuses } },
      select: { total: true, totalCents: true, tax: true, taxCents: true, refundedAmount: true, refundedTaxCents: true, stripeFeeEstimate: true, shippingCost: true, costBasis: true, netProfit: true, paidAt: true }
    }),
    prisma.storefrontOrder.findMany({
      where: { ...(where as Prisma.StorefrontOrderWhereInput), ...realBusinessOrderWhere, paymentStatus: { in: activeRevenuePaymentStatuses }, paidAt: { gte: todayStart } },
      select: { total: true, totalCents: true, tax: true, taxCents: true, refundedAmount: true, refundedTaxCents: true }
    }),
    prisma.storefrontOrder.findFirst({ where: { ...(where as Prisma.StorefrontOrderWhereInput), ...realBusinessOrderWhere, paymentStatus: { in: activeRevenuePaymentStatuses } }, orderBy: { paidAt: "desc" }, select: { paidAt: true } }),
    prisma.paymentEvent.findFirst({
      where: currentUser.role === "ADMIN" ? {} : { order: { userId: currentUser.id } },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true }
    }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), isTestOrder: true } })
  ]);
  return {
    productCount,
    activeProductCount,
    pendingOrderCount,
    inquiryCount,
    paidOrderCount: paidOrders.filter((order) => storefrontOrderNetRevenue(order) > 0).length,
    newPaidOrderCount,
    ordersToShipCount,
    pickupOrderCount,
    todaySales: todayPaidOrders.reduce((sum, order) => sum + storefrontOrderNetRevenue(order), 0),
    todayPaidOrderCount: todayPaidOrders.filter((order) => storefrontOrderNetRevenue(order) > 0).length,
    lastPaidOrderAt: lastPaidOrder?.paidAt?.toISOString() ?? null,
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
    totalRevenue: paidOrders.reduce((sum, order) => sum + storefrontOrderNetRevenue(order), 0),
    netProfit: paidOrders.reduce((sum, order) => sum + storefrontOrderNetProfitAfterRefund(order), 0),
    testOrderCount
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

type StorefrontRefundProviderResult = { id: string; status: string | null };

export type StorefrontRefundDependencies = {
  createRefund?: (input: {
    paymentIntentId: string;
    amountCents: number;
    orderId: string;
    orderNumber: string;
    reason: string;
    idempotencyKey: string;
  }) => Promise<StorefrontRefundProviderResult>;
};

export async function cancelOrRefundStorefrontOrder(
  currentUser: SessionUser,
  orderId: string,
  input: StorefrontCancelRefundInput,
  dependencies: StorefrontRefundDependencies = {}
) {
  const requestEventId = `admin.cancel_refund:${orderId}:${input.idempotencyKey}`;
  const legacyRequestEventId = `admin.cancel_refund:${input.idempotencyKey}`;
  const existingRequest = await prisma.paymentEvent.findFirst({
    where: { orderId, eventId: { in: [requestEventId, legacyRequestEventId] } }
  });
  if (existingRequest) {
    const existingOrder = await prisma.storefrontOrder.findFirst({
      where: { id: orderId, userId: currentUser.id },
      include: storefrontOrderInclude
    });
    if (!existingOrder) throw new Error("Order not found");
    return storefrontOrderToDTO(existingOrder);
  }

  const order = await prisma.storefrontOrder.findFirst({
    where: { id: orderId, userId: currentUser.id },
    include: storefrontOrderInclude
  });
  if (!order) throw new Error("Order not found");
  if (!orderCanCancelOrRefund(order)) throw new Error("This order is already canceled, refunded, or refunding.");

  const isShippedRefundWorkflow = order.fulfillmentStatus === "shipped";
  const isRefundableStripeOrder = ["paid", "partially_refunded"].includes(order.paymentStatus) && Boolean(order.stripePaymentIntentId);
  if (isShippedRefundWorkflow && input.refundType === "none") {
    throw new Error("Shipped orders cannot be canceled without a refund. Use Refund / Return for shipped orders.");
  }
  if (isShippedRefundWorkflow && !input.adminNote?.trim()) {
    throw new Error("Add an admin note for shipped refund/return handling.");
  }
  if (input.refundType === "none" && isRefundableStripeOrder) {
    throw new Error("Paid Stripe orders must use a full or partial refund.");
  }
  if (input.refundType !== "none" && !isRefundableStripeOrder) {
    throw new Error("Stripe refund is only available for paid Stripe orders with a stored PaymentIntent.");
  }

  const remainingRefundableCents = orderRemainingRefundableCents(order);
  const preflightRefundCents =
    input.refundType === "full"
      ? remainingRefundableCents
      : input.refundType === "partial"
        ? centsFromMoney(input.partialRefundAmount ?? 0)
        : 0;
  if (input.refundType !== "none" && preflightRefundCents <= 0) throw new Error("No refundable balance remains for this order.");
  if (preflightRefundCents > remainingRefundableCents) {
    throw new TaxRefundAmountError("Refund amount exceeds the remaining refundable order total.");
  }

  const transactionResult = await runTaxRefundTransaction(async (tx) => {
    await lockStorefrontOrderForRefund(tx, order.id);
    const duplicate = await tx.paymentEvent.findFirst({
      where: { orderId: order.id, eventId: { in: [requestEventId, legacyRequestEventId] } }
    });
    if (duplicate) {
      const current = await tx.storefrontOrder.findUnique({ where: { id: order.id }, include: storefrontOrderInclude });
      if (!current) throw new Error("Order not found");
      return {
        order: current,
        duplicate: true,
        refundCents: 0,
        hasTaxSnapshot: current.taxCents !== null,
        refundedTaxDeltaCents: 0
      };
    }

    const current = await tx.storefrontOrder.findUnique({ where: { id: order.id }, include: storefrontOrderInclude });
    if (!current) throw new Error("Order not found");
    if (!orderCanCancelOrRefund(current)) throw new Error("This order is already canceled, refunded, or refunding.");
    const currentIsShippedRefundWorkflow = current.fulfillmentStatus === "shipped";
    const currentIsRefundableStripeOrder = ["paid", "partially_refunded"].includes(current.paymentStatus) && Boolean(current.stripePaymentIntentId);
    if (currentIsShippedRefundWorkflow && input.refundType === "none") {
      throw new Error("Shipped orders cannot be canceled without a refund. Use Refund / Return for shipped orders.");
    }
    if (currentIsShippedRefundWorkflow && !input.adminNote?.trim()) {
      throw new Error("Add an admin note for shipped refund/return handling.");
    }
    if (input.refundType === "none" && currentIsRefundableStripeOrder) {
      throw new Error("Paid Stripe orders must use a full or partial refund.");
    }
    if (input.refundType !== "none" && !currentIsRefundableStripeOrder) {
      throw new Error("Stripe refund is only available for paid Stripe orders with a stored PaymentIntent.");
    }
    const currentRemainingRefundableCents = orderRemainingRefundableCents(current);
    const refundCents = input.refundType === "full"
      ? currentRemainingRefundableCents
      : input.refundType === "partial"
        ? centsFromMoney(input.partialRefundAmount ?? 0)
        : 0;
    if (input.refundType !== "none" && refundCents <= 0) throw new Error("No refundable balance remains for this order.");
    if (refundCents > currentRemainingRefundableCents) {
      throw new TaxRefundConflictError("The refundable order balance changed. Refresh the order and try again.");
    }
    const stripeRefund = refundCents > 0
      ? await (dependencies.createRefund ?? (async (providerInput) => {
          const refund = await stripeClient().refunds.create(
            {
              payment_intent: providerInput.paymentIntentId,
              amount: providerInput.amountCents,
              metadata: {
                orderId: providerInput.orderId,
                orderNumber: providerInput.orderNumber,
                reason: providerInput.reason
              }
            },
            { idempotencyKey: providerInput.idempotencyKey }
          );
          return { id: refund.id, status: refund.status };
        }))({
          paymentIntentId: current.stripePaymentIntentId!,
          amountCents: refundCents,
          orderId: current.id,
          orderNumber: current.orderNumber,
          reason: input.reason,
          idempotencyKey: `storefront-cancel-refund:${current.id}:${input.idempotencyKey}`
        })
      : null;
    const stripeRefundStatus = stripeRefund?.status ?? null;
    const totalCents = orderTotalCents(current);
    const newRefundedCents = orderRefundedCents(current) + refundCents;
    const hasTaxSnapshot = current.taxCents !== null;
    const newRefundedTaxCents = hasTaxSnapshot
      ? cumulativeRefundedTaxCents({
          originalTaxCents: current.taxCents,
          originalTotalCents: current.totalCents ?? totalCents,
          cumulativeRefundedAmountCents: newRefundedCents
        })
      : null;
    const refundedTaxDeltaCents = Math.max(0, (newRefundedTaxCents ?? 0) - (current.refundedTaxCents ?? 0));
    const paymentStatus = refundCents > 0
      ? refundPaymentStatus(stripeRefundStatus, newRefundedCents, totalCents)
      : "not_applicable";
    const refundStatus = refundCents > 0 ? paymentStatus : "not_applicable";
    const refundedAt = refundCents > 0 && paymentStatus !== "refund_pending" && paymentStatus !== "refund_failed" ? new Date() : null;
    const reasonLabel = cancellationReasonLabels[input.reason];
    const requestedEmailStatus = "skipped";

    const shouldReturnStock = input.returnItemsToStock && orderInventoryWasFinalized(current) && !current.stockReturnedAt;
    const returnedQuantity = shouldReturnStock ? await returnOrderInventory(tx, current) : 0;
    const stockReturnStatus = input.returnItemsToStock
      ? current.stockReturnedAt
        ? "already_returned"
        : shouldReturnStock
          ? "returned"
          : "not_applicable"
      : "not_returned";
    const workflowReasonLabel = currentIsShippedRefundWorkflow ? "Refund/return reason" : "Cancellation reason";
    const cancellationNote = [
      `${workflowReasonLabel}: ${reasonLabel}`,
      input.adminNote ? `Admin note: ${input.adminNote}` : null,
      refundCents > 0 ? `Refund requested: $${moneyFromCents(refundCents).toFixed(2)}` : "Refund requested: none",
      hasTaxSnapshot ? `Tax refund allocated from original snapshot: $${moneyFromCents(refundedTaxDeltaCents).toFixed(2)}` : "Tax refund allocation: historical tax not recorded",
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
        fulfillmentStatus: currentIsShippedRefundWorkflow ? current.fulfillmentStatus : "canceled",
        canceledAt: currentIsShippedRefundWorkflow ? current.canceledAt : current.canceledAt ?? new Date(),
        refundedAt,
        refundStatus,
        refundedAmount: moneyFromCents(newRefundedCents),
        refundedTaxCents: newRefundedTaxCents,
        taxStatus:
          newRefundedTaxCents === null
            ? current.taxStatus
            : newRefundedTaxCents >= (current.taxCents ?? 0) && paymentStatus === "refunded"
              ? "refunded"
              : refundedTaxDeltaCents > 0
                ? "partially_refunded"
                : current.taxStatus,
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
      refundedTax: hasTaxSnapshot ? moneyFromCents(refundedTaxDeltaCents) : null,
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
          eventId: `admin.refund:${current.id}:${input.idempotencyKey}`,
          eventType: "admin.refund.created",
          payload
        }
      });
      await tx.taxAdjustment.create({
        data: {
          idempotencyKey: `tax:storefront-refund:${current.id}:${input.idempotencyKey}`,
          channel: "online",
          adjustmentType: "refund",
          storefrontOrderId: current.id,
          providerReference: stripeRefund?.id ?? null,
          refundedAmountCents: refundCents,
          refundedTaxCents: refundedTaxDeltaCents,
          reason: input.reason,
          createdByUserId: currentUser.id,
          metadataJson: JSON.stringify({
            originalTaxCents: current.taxCents,
            previousRefundedTaxCents: current.refundedTaxCents,
            cumulativeRefundedTaxCents: newRefundedTaxCents,
            allocation: current.taxCents === null ? "historical_unknown" : "proportional_original_snapshot"
          })
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
    if (refundCents > 0 || updated.status === "canceled" || updated.paymentStatus === "refunded" || updated.paymentStatus === "partially_refunded") {
      await reverseRewardsForOrder(
        updated,
        {
          reason: refundCents > 0 ? "refund" : "cancel",
          idempotencyKey: input.idempotencyKey,
          refundedAmount: moneyFromCents(Math.max(0, newRefundedCents - (newRefundedTaxCents ?? 0)))
        },
        tx
      );
    }
    return {
      order: updated,
      duplicate: false,
      refundCents,
      hasTaxSnapshot,
      refundedTaxDeltaCents
    };
  });

  const { order: updatedOrder, duplicate, refundCents, hasTaxSnapshot, refundedTaxDeltaCents } = transactionResult;
  if (duplicate) return storefrontOrderToDTO(updatedOrder);

  let finalOrder = updatedOrder;
  if (refundCents > 0 || updatedOrder.status === "canceled" || updatedOrder.paymentStatus === "refunded" || updatedOrder.paymentStatus === "partially_refunded") {
    finalOrder = await prisma.storefrontOrder.findUnique({
      where: { id: updatedOrder.id },
      include: storefrontOrderInclude
    }) ?? updatedOrder;
  }
  if (input.sendCustomerEmail) {
    const settings = await getStorefrontSettings();
    const emailStatus = await sendStorefrontCancellationEmail({
      order: updatedOrder,
      reason: input.reason,
      adminNote: input.adminNote,
      refundAmount: moneyFromCents(refundCents),
      refundedTax: hasTaxSnapshot ? moneyFromCents(refundedTaxDeltaCents) : null,
      contactEmail: settings.contactEmail || defaultStorefrontContactEmail,
      idempotencyKey: input.idempotencyKey
    });
    finalOrder = await prisma.storefrontOrder.update({
      where: { id: updatedOrder.id },
      data: {
        customerCancellationEmailStatus: emailStatus,
        customerCancellationEmailSentAt: emailStatus === "sent" ? updatedOrder.customerCancellationEmailSentAt ?? new Date() : updatedOrder.customerCancellationEmailSentAt
      },
      include: storefrontOrderInclude
    });
  } else {
    await sendCustomerEmailNotificationOnce({
      order: updatedOrder,
      kind: "refund_cancellation",
      eventId: customerEmailEventId("refund_cancellation", updatedOrder.id, input.idempotencyKey),
      skippedDetail: "Admin chose not to send a cancellation email."
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
    isTestOrder?: boolean;
    testOrderReason?: StorefrontTestOrderReason;
  }
) {
  const order = await prisma.storefrontOrder.findFirst({
    where: { id: orderId, ...(currentUser.role === "ADMIN" ? {} : { userId: currentUser.id }) }
  });
  if (!order) throw new Error("Order not found");
  const requestsTestOrderChange = input.isTestOrder !== undefined;
  if (input.isTestOrder === true && !input.testOrderReason) {
    throw new Error("Select a test/smoke reason before marking this order.");
  }
  if (input.testOrderReason && !storefrontTestOrderReasons.has(input.testOrderReason)) {
    throw new Error("Select a valid test/smoke reason.");
  }
  const requestsActiveFulfillment =
    ["packing", "shipped", "pickup_ready", "picked_up"].includes(input.status ?? "") ||
    ["packing", "shipped", "pickup_ready", "picked_up"].includes(input.fulfillmentStatus ?? "");
  if (requestsActiveFulfillment && orderIsClosedForFulfillment(order)) {
    throw new Error("Canceled, refunded, or expired orders cannot be marked packing, shipped, ready for pickup, or picked up.");
  }
  if (requestsActiveFulfillment && order.paymentStatus !== "paid") {
    throw new Error("Only paid orders can be marked packing, shipped, ready for pickup, or picked up.");
  }
  const requestsShippedStatus = input.status === "shipped" || input.fulfillmentStatus === "shipped";
  const requestsPickupStatus = ["pickup_ready", "picked_up"].includes(input.status ?? "") || ["pickup_ready", "picked_up"].includes(input.fulfillmentStatus ?? "");
  if (requestsPickupStatus && !orderIsLocalPickup(order)) {
    throw new Error("Pickup statuses are only available for local pickup orders.");
  }
  if (requestsShippedStatus && orderIsLocalPickup(order)) {
    throw new Error("Local pickup orders do not require shipping. Mark them ready for pickup or picked up instead.");
  }
  const nextCarrier = input.carrier !== undefined ? input.carrier?.trim() ?? "" : order.carrier?.trim() ?? "";
  const nextTrackingNumber = input.trackingNumber !== undefined ? input.trackingNumber?.trim() ?? "" : order.trackingNumber?.trim() ?? "";
  if (requestsShippedStatus && (!nextCarrier || !nextTrackingNumber)) {
    throw new Error("Carrier and tracking number are required before marking an order shipped.");
  }
  const nextFulfillmentStatus =
    input.fulfillmentStatus ??
    (["packing", "shipped", "pickup_ready", "picked_up"].includes(input.status ?? "") ? input.status : undefined);
  const nextOrderStatus = input.status ?? (input.fulfillmentStatus === "packing" || input.fulfillmentStatus === "shipped" ? input.fulfillmentStatus : undefined);
  const testOrderData =
    input.isTestOrder === true
      ? {
          isTestOrder: true,
          testOrderReason: input.testOrderReason,
          testMarkedAt: new Date(),
          testMarkedBy: currentUser.email ?? currentUser.id
        }
      : input.isTestOrder === false
        ? {
            isTestOrder: false,
            testOrderReason: null,
            testMarkedAt: null,
            testMarkedBy: null
          }
        : {};
  const updated = await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: {
      status: nextOrderStatus,
      fulfillmentStatus: nextFulfillmentStatus,
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
      shippingCost: input.shippingCost,
      notes: input.notes,
      netProfit: input.shippingCost !== undefined ? Math.max(0, order.total - order.tax) - order.stripeFeeEstimate - input.shippingCost - order.costBasis : undefined,
      ...testOrderData
    },
    include: storefrontOrderInclude
  });
  const requestsFulfillmentRecordUpdate =
    input.status !== undefined ||
    input.fulfillmentStatus !== undefined ||
    input.trackingNumber !== undefined ||
    input.carrier !== undefined ||
    input.shippingCost !== undefined ||
    input.notes !== undefined;
  if (requestsFulfillmentRecordUpdate) {
    await prisma.fulfillment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        status: nextFulfillmentStatus ?? order.fulfillmentStatus,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        notes: input.notes,
        shippedAt: nextFulfillmentStatus === "shipped" ? new Date() : undefined
      },
      update: {
        status: nextFulfillmentStatus,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        notes: input.notes,
        shippedAt: nextFulfillmentStatus === "shipped" ? new Date() : undefined
      }
    });
  }
  const refreshed = await prisma.storefrontOrder.findUnique({
    where: { id: order.id },
    include: storefrontOrderInclude
  });
  let finalOrder = refreshed ?? updated;
  if (nextFulfillmentStatus === "shipped") {
    await sendStorefrontShipmentEmail(finalOrder);
  }
  if (nextFulfillmentStatus === "pickup_ready") {
    await sendStorefrontLocalPickupEmail(finalOrder);
  }
  if (!finalOrder.isTestOrder && finalOrder.paymentStatus === "paid" && (nextFulfillmentStatus === "shipped" || nextFulfillmentStatus === "picked_up")) {
    await releasePendingRewardsForOrder(finalOrder.id, nextFulfillmentStatus);
  }
  if (requestsTestOrderChange && finalOrder.customerId && finalOrder.customerEmail) {
    await syncStorefrontCustomerTotals(finalOrder.customerId, finalOrder.customerEmail);
  }
  if (requestsTestOrderChange && input.isTestOrder === true) {
    await reverseRewardsForOrder(finalOrder, {
      reason: "test_order",
      idempotencyKey: `test-order:${finalOrder.testMarkedAt?.toISOString() ?? Date.now()}`
    });
  }
  const withEmailEvents = await prisma.storefrontOrder.findUnique({
    where: { id: order.id },
    include: storefrontOrderInclude
  });
  finalOrder = withEmailEvents ?? finalOrder;
  return storefrontOrderToDTO(finalOrder);
}
