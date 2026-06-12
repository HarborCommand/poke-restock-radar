import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import { cleanStorefrontDescription, cleanStorefrontTitle } from "@/lib/storefront-copy";
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

const storefrontInventoryInclude = {
  stockLots: true,
  sales: true,
  stockReservations: true,
  productImages: {
    orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }, { createdAt: "asc" as const }]
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
          exactProductUrl: true
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

function activeReservedQuantity(item: Pick<StorefrontInventoryItem, "stockReservations">) {
  const now = new Date();
  return item.stockReservations
    .filter((reservation) => reservation.status === "reserved" && reservation.expiresAt > now)
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
}

function sellableQuantity(item: StorefrontInventoryItem) {
  const owned = Math.max(0, quantityOwned(item) - activeReservedQuantity(item));
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
  const galleryImages = item.productImages
    .filter((image) => image.showInStore)
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.createdAt.getTime() - right.createdAt.getTime();
    })
    .map((image) => image.url);
  const seen = new Set<string>();
  return [...galleryImages, ...parseList(item.publicImages), item.imageUrl]
    .map((image) => image?.trim())
    .filter((image): image is string => Boolean(image))
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    });
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
    imageUrl: images[0] ?? item.imageUrl,
    images,
    category: publicCategory,
    tags: parseList(item.storefrontTags),
    condition: cleanStorefrontTitle(item.condition),
    availableQuantity,
    maxQuantityPerOrder: item.maxQuantityPerOrder,
    status,
    localPickupAvailable: item.localPickupAvailable,
    shippingAvailable: item.shippingAvailable,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

export async function releaseExpiredReservations() {
  await prisma.stockReservation.updateMany({
    where: { status: "reserved", expiresAt: { lte: new Date() } },
    data: { status: "released", releasedAt: new Date() }
  });
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
  await releaseExpiredReservations();
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
    .map(publicProductToDTO)
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
  await releaseExpiredReservations();
  const item = await prisma.inventoryItem.findFirst({
    where: { publicSlug: slug, publishToStore: true, storeStatus: { in: ["active", "sold_out"] } },
    include: storefrontInventoryInclude
  });
  return item ? publicProductToDTO(item) : null;
}

export async function getCartProducts(items: Array<{ id: string; quantity: number }>, options: { strict?: boolean } = {}) {
  const strict = options.strict ?? true;
  await releaseExpiredReservations();
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

function stripeImage(imageUrl: string | null | undefined) {
  return imageUrl && /^https?:\/\//i.test(imageUrl) ? [imageUrl] : undefined;
}

function orderItemToDTO(item: StorefrontOrderItemWithInventory): StorefrontOrderItemDTO {
  return {
    id: item.id,
    inventoryItemId: item.inventoryItemId,
    publicTitle: item.publicTitle,
    publicSlug: item.publicSlug,
    imageUrl: item.imageUrl,
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
  if (order.paymentStatus === "expired" || order.status === "canceled") return "Expired";
  if (order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled") return "Needs Shipping";
  if (order.paymentStatus === "paid") return "Paid";
  if (order.paymentStatus === "pending") return "New";
  return order.status;
}

function orderTimeline(order: StorefrontOrderWithItems): StorefrontOrderDTO["timeline"] {
  const completedEvent = order.paymentEvents.find((event) => event.eventType === "checkout.session.completed");
  return [
    { label: "Order created", at: order.createdAt.toISOString(), detail: "Storefront order was created." },
    { label: "Checkout started", at: order.stripeCheckoutSessionId ? order.createdAt.toISOString() : null, detail: order.stripeCheckoutSessionId ? "Stripe Checkout session was created." : "No Stripe Checkout session for this order." },
    { label: "Payment completed", at: completedEvent?.receivedAt.toISOString() ?? order.paidAt?.toISOString() ?? null, detail: completedEvent ? "Stripe webhook checkout.session.completed was received." : "Payment completion webhook has not been stored." },
    { label: "Inventory reduced", at: order.reservations.some((reservation) => reservation.status === "completed") ? order.paidAt?.toISOString() ?? null : null, detail: order.reservations.some((reservation) => reservation.status === "completed") ? "Stock reservation completed after payment." : "Inventory has not been finalized for this order." },
    { label: "Sale created", at: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? order.paidAt?.toISOString() ?? null : null, detail: order.items.some((item) => item.costBasis > 0 || item.profitLoss !== 0) ? "Inventory sale/profit values are attached to order items." : "No sale/profit allocation stored yet." },
    { label: "Packing", at: order.fulfillmentStatus === "packing" || order.status === "packing" ? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "packing" || order.status === "packing" ? "Order is marked packing." : "Not marked packing yet." },
    { label: "Shipped", at: order.fulfillmentStatus === "shipped" ? order.fulfillment?.shippedAt?.toISOString() ?? order.updatedAt.toISOString() : null, detail: order.fulfillmentStatus === "shipped" ? "Order is marked shipped." : "Not shipped yet." }
  ];
}

export function storefrontOrderToDTO(order: StorefrontOrderWithItems): StorefrontOrderDTO {
  const source = orderSource(order);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const needsFulfillment = order.paymentStatus === "paid" && !["shipped", "picked_up", "canceled"].includes(order.fulfillmentStatus);
  const isNewPaidOrder = order.paymentStatus === "paid" && order.fulfillmentStatus === "unfulfilled";
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail ?? order.customer?.email ?? null,
    customerName: order.customerName ?? order.customer?.name ?? null,
    customerPhone: order.customer?.phone ?? null,
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
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(orderItemToDTO),
    reservations: order.reservations.map((reservation) => ({
      id: reservation.id,
      inventoryItemId: reservation.inventoryItemId,
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
  const cart = await getCartProducts(input.items);
  const subtotal = cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
  const shippingCharged =
    input.fulfillmentMethod === "pickup" || (settings.freeShippingThreshold !== null && subtotal >= settings.freeShippingThreshold)
      ? 0
      : settings.defaultShippingPrice;
  const total = subtotal + shippingCharged;
  const order = await prisma.storefrontOrder.create({
    data: {
      orderNumber: orderNumber(),
      userId: cart[0]?.item.userId ?? null,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      subtotal,
      shippingCharged,
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
      },
      reservations: {
        create: cart.map(({ item, quantity }) => ({
          inventoryItemId: item.id,
          quantity,
          expiresAt: new Date(Date.now() + reservationMinutes * 60 * 1000)
        }))
      }
    },
    include: storefrontOrderInclude
  });
  const metadata = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    inventoryProductIds: order.items.map((item) => item.inventoryItemId).join(","),
    quantities: order.items.map((item) => item.quantity).join(",")
  };
  try {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.customerEmail,
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
        })),
        ...(shippingCharged > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: Math.round(shippingCharged * 100),
                  product_data: { name: "Shipping" }
                }
              }
            ]
          : [])
      ],
      metadata,
      payment_intent_data: {
        metadata
      },
      success_url: `${checkoutBaseUrl}/checkout/success?order=${order.id}&number=${encodeURIComponent(order.orderNumber)}`,
      cancel_url: `${checkoutBaseUrl}/checkout/cancel?order=${order.id}`
    });
    const updated = await prisma.storefrontOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
      include: storefrontOrderInclude
    });
    return { order: storefrontOrderToDTO(updated), checkoutUrl: session.url };
  } catch (error) {
    await prisma.stockReservation.updateMany({
      where: { orderId: order.id, status: "reserved" },
      data: { status: "released", releasedAt: new Date() }
    });
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
  const shippingCharged =
    input.fulfillmentMethod === "pickup" || (settings.freeShippingThreshold !== null && subtotal >= settings.freeShippingThreshold)
      ? 0
      : settings.defaultShippingPrice;
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
      status: "invoice_requested",
      paymentStatus: "invoice_requested",
      fulfillmentStatus: "unfulfilled",
      subtotal,
      shippingCharged,
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
    type: "paid" | "invoice_request" | "payment_failed" | "checkout_expired" | "inventory_issue" | "sold_out_after_order";
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

async function createStorefrontSale(order: StorefrontOrderWithItems) {
  let orderCostBasis = 0;
  for (const orderItem of order.items) {
    const inventory = await prisma.inventoryItem.findUnique({
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
      await prisma.inventoryStockLot.update({
        where: { id: lot.id },
        data: { remainingQuantity: lot.remainingQuantity - quantityFromLot }
      });
    }
    if (remainingToAllocate > 0) {
      costBasis += remainingToAllocate * inventory.cost;
      await createStorefrontOrderAlert(order, {
        type: "inventory_issue",
        title: "Inventory allocation issue",
        reason: `${remainingToAllocate} unit${remainingToAllocate === 1 ? "" : "s"} for ${orderItem.publicTitle} were sold without enough remaining stock lots. Review cost basis and stock immediately.`,
        priority: "HIGH",
        score: 95
      });
    }
    const allocatedShipping = order.subtotal > 0 ? (orderItem.lineTotal / order.subtotal) * order.shippingCharged : 0;
    const allocatedStripeFee = order.subtotal > 0 ? (orderItem.lineTotal / order.subtotal) * order.stripeFeeEstimate : 0;
    const netSale = orderItem.lineTotal + allocatedShipping - allocatedStripeFee;
    const profitLoss = netSale - costBasis;
    await prisma.inventorySale.create({
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
        soldAt: new Date(),
        notes: `Storefront order ${order.orderNumber}`
      }
    });
    await prisma.storefrontOrderItem.update({
      where: { id: orderItem.id },
      data: { costBasis, profitLoss }
    });
    orderCostBasis += costBasis;
  }
  const netProfit = order.total - order.stripeFeeEstimate - order.shippingCost - orderCostBasis;
  await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: {
      status: "paid",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      costBasis: orderCostBasis,
      netProfit,
      roiPercent: orderCostBasis > 0 ? (netProfit / orderCostBasis) * 100 : null,
      paidAt: new Date()
    }
  });
  await prisma.stockReservation.updateMany({
    where: { orderId: order.id, status: "reserved" },
    data: { status: "completed" }
  });
  await createStorefrontOrderAlert(order, {
    type: "paid",
    title: "New paid order",
    reason: `Stripe Checkout paid order ${order.orderNumber} is ready for fulfillment.`,
    priority: "HIGH",
    score: 96
  });
}

async function releaseOrderReservations(orderId: string) {
  await prisma.stockReservation.updateMany({
    where: { orderId, status: "reserved" },
    data: { status: "released", releasedAt: new Date() }
  });
}

async function markStorefrontOrderPaymentFailed(order: StorefrontOrderWithItems, paymentStatus: "failed" | "expired", note?: string) {
  if (order.paymentStatus === "paid") return;
  await releaseOrderReservations(order.id);
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
}

async function orderForStripeEvent(event: Stripe.Event) {
  const object = event.data.object;
  const metadata = "metadata" in object ? object.metadata : null;
  const orderId = typeof metadata?.orderId === "string" ? metadata.orderId : null;
  if (orderId) {
    return prisma.storefrontOrder.findUnique({ where: { id: orderId }, include: storefrontOrderInclude });
  }
  if (event.type === "payment_intent.payment_failed" && "id" in object && typeof object.id === "string") {
    return prisma.storefrontOrder.findFirst({ where: { stripePaymentIntentId: object.id }, include: storefrontOrderInclude });
  }
  return null;
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const secret = envValue("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signature) throw new Error("Missing Stripe webhook signature.");
  const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  let order = await orderForStripeEvent(event);
  try {
    await prisma.paymentEvent.create({
      data: {
        orderId: order?.id,
        eventId: event.id,
        eventType: event.type,
        payload: rawBody
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
  if (event.type === "checkout.session.completed" && order && order.paymentStatus !== "paid") {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerEmail = session.customer_details?.email ?? session.customer_email ?? order.customerEmail;
    const customerName = session.customer_details?.name ?? order.customerName;
    const customer =
      customerEmail
        ? await prisma.storefrontCustomer.upsert({
            where: { email: customerEmail },
            create: { email: customerEmail, name: customerName, userId: order.userId },
            update: { name: customerName ?? undefined }
          })
        : null;
    await prisma.storefrontOrder.update({
      where: { id: order.id },
      data: {
        customerId: customer?.id ?? order.customerId,
        customerEmail,
        customerName,
        stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : order.stripePaymentIntentId
      }
    });
    order = await prisma.storefrontOrder.findUnique({ where: { id: order.id }, include: storefrontOrderInclude });
    if (order) await createStorefrontSale(order);
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
    prisma.storefrontOrder.findMany({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid" }, select: { total: true, netProfit: true, paidAt: true } }),
    prisma.storefrontOrder.findMany({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid", paidAt: { gte: todayStart } }, select: { total: true } }),
    prisma.storefrontOrder.findFirst({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid" }, orderBy: { paidAt: "desc" }, select: { paidAt: true } }),
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
    paidOrderCount: paidOrders.length,
    newPaidOrderCount,
    ordersToShipCount,
    todaySales: todayPaidOrders.reduce((sum, order) => sum + order.total, 0),
    todayPaidOrderCount: todayPaidOrders.length,
    lastPaidOrderAt: lastPaidOrder?.paidAt?.toISOString() ?? null,
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
    totalRevenue: paidOrders.reduce((sum, order) => sum + order.total, 0),
    netProfit: paidOrders.reduce((sum, order) => sum + order.netProfit, 0)
  };
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
