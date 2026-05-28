import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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
  stockReservations: true
} satisfies Prisma.InventoryItemInclude;

const storefrontOrderInclude = {
  items: true,
  customer: true
} satisfies Prisma.StorefrontOrderInclude;

type StorefrontInventoryItem = Prisma.InventoryItemGetPayload<{ include: typeof storefrontInventoryInclude }>;
type StorefrontOrderWithItems = Prisma.StorefrontOrderGetPayload<{ include: typeof storefrontOrderInclude }>;

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

function publicImages(item: StorefrontInventoryItem) {
  const images = parseList(item.publicImages);
  if (item.imageUrl && !images.includes(item.imageUrl)) images.unshift(item.imageUrl);
  return images;
}

export function publicProductToDTO(item: StorefrontInventoryItem): PublicStoreProductDTO | null {
  const price = item.publicPrice;
  const availableQuantity = sellableQuantity(item);
  const slug = item.publicSlug;
  if (!item.publishToStore || !slug || price === null || price === undefined) return null;
  if (!["active", "sold_out"].includes(item.storeStatus)) return null;
  const images = publicImages(item);
  return {
    id: item.id,
    slug,
    title: item.publicTitle || item.itemName,
    description: item.publicDescription || item.description,
    price,
    compareAtPrice: item.compareAtPrice,
    imageUrl: images[0] ?? item.imageUrl,
    images,
    category: item.storefrontCategory || item.category,
    tags: parseList(item.storefrontTags),
    availableQuantity,
    maxQuantityPerOrder: item.maxQuantityPerOrder,
    status: availableQuantity > 0 && item.storeStatus === "active" ? "active" : "sold_out",
    localPickupAvailable: item.localPickupAvailable,
    shippingAvailable: item.shippingAvailable
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
    storeName: settings?.storeName ?? "Poke Radar Shop",
    storeLogoUrl: settings?.storeLogoUrl ?? null,
    contactEmail: settings?.contactEmail ?? null,
    returnPolicyText: settings?.returnPolicyText ?? null,
    shippingPolicyText: settings?.shippingPolicyText ?? null,
    localPickupInstructions: settings?.localPickupInstructions ?? null,
    announcementBanner: settings?.announcementBanner ?? null,
    defaultShippingPrice: settings?.defaultShippingPrice ?? 5,
    freeShippingThreshold: settings?.freeShippingThreshold ?? null,
    socialLinks: parseList(settings?.socialLinks)
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
    .filter((product) => product.status === "active")
    .filter((product) => !q || product.title.toLowerCase().includes(q) || product.tags.some((tag) => tag.toLowerCase().includes(q)))
    .filter((product) => !category || category === "all" || product.category.toLowerCase() === category);
}

export async function getPublicStoreProduct(slug: string) {
  await releaseExpiredReservations();
  const item = await prisma.inventoryItem.findFirst({
    where: { publicSlug: slug, publishToStore: true, storeStatus: { in: ["active", "sold_out"] } },
    include: storefrontInventoryInclude
  });
  return item ? publicProductToDTO(item) : null;
}

export async function getCartProducts(items: Array<{ id: string; quantity: number }>) {
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
    if (!product || product.status !== "active") throw new Error(`${item.publicTitle || item.itemName} is not available for checkout.`);
    const requestedQuantity = requested.get(item.id) ?? 0;
    if (requestedQuantity > product.availableQuantity) throw new Error(`Only ${product.availableQuantity} available for ${product.title}.`);
    if (requestedQuantity > product.maxQuantityPerOrder) throw new Error(`Max ${product.maxQuantityPerOrder} per order for ${product.title}.`);
    return { item, product, quantity: requestedQuantity };
  });
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe checkout is not configured. Set STRIPE_SECRET_KEY in Vercel.");
  return new Stripe(key);
}

function storeBaseUrl() {
  return process.env.STORE_BASE_URL?.trim() || process.env.APP_URL?.trim() || "https://poke-restock-radar.vercel.app";
}

function orderNumber() {
  return `PR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function estimateStripeFee(total: number) {
  return Math.round((total * 0.029 + 0.3) * 100) / 100;
}

function stripeImage(imageUrl: string | null | undefined) {
  return imageUrl && /^https?:\/\//i.test(imageUrl) ? [imageUrl] : undefined;
}

function orderItemToDTO(item: Prisma.StorefrontOrderItemGetPayload<Record<string, never>>): StorefrontOrderItemDTO {
  return {
    id: item.id,
    inventoryItemId: item.inventoryItemId,
    publicTitle: item.publicTitle,
    publicSlug: item.publicSlug,
    imageUrl: item.imageUrl,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    costBasis: item.costBasis,
    profitLoss: item.profitLoss
  };
}

export function storefrontOrderToDTO(order: StorefrontOrderWithItems): StorefrontOrderDTO {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail ?? order.customer?.email ?? null,
    customerName: order.customerName ?? order.customer?.name ?? null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
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
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map(orderItemToDTO)
  };
}

export async function createCheckoutSession(input: {
  items: Array<{ id: string; quantity: number }>;
  fulfillmentMethod: "shipping" | "pickup";
  customerEmail?: string;
  customerName?: string;
}) {
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
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      inventoryProductIds: order.items.map((item) => item.inventoryItemId).join(","),
      quantities: order.items.map((item) => item.quantity).join(",")
    },
    success_url: `${storeBaseUrl()}/checkout/success?order=${order.id}`,
    cancel_url: `${storeBaseUrl()}/checkout/cancel?order=${order.id}`
  });
  await prisma.storefrontOrder.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id }
  });
  return { order: storefrontOrderToDTO(order), checkoutUrl: session.url };
}

function lotUnitCost(lot: { costPerUnit: number; totalCost: number; quantity: number }) {
  if (lot.costPerUnit > 0) return lot.costPerUnit;
  return lot.quantity > 0 ? lot.totalCost / lot.quantity : 0;
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
    if (remainingToAllocate > 0) costBasis += remainingToAllocate * inventory.cost;
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
        platform: "other",
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
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signature) throw new Error("Missing Stripe webhook signature.");
  const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId : null;
  let order = orderId
    ? await prisma.storefrontOrder.findUnique({ where: { id: orderId }, include: storefrontOrderInclude })
    : null;
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
  if ((event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") && order) {
    await prisma.stockReservation.updateMany({
      where: { orderId: order.id, status: "reserved" },
      data: { status: "released", releasedAt: new Date() }
    });
    await prisma.storefrontOrder.update({
      where: { id: order.id },
      data: { status: "canceled", paymentStatus: "failed", canceledAt: new Date() }
    });
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
  const publicTitle = input.publicTitle || item.publicTitle || item.itemName;
  const publicSlug = input.publicSlug ? await uniqueSlug(input.publicSlug, item.id) : item.publicSlug || (input.publishToStore ? await uniqueSlug(publicTitle, item.id) : null);
  if (input.storeStatus === "active" && (!input.publicPrice || input.publicPrice <= 0)) {
    throw new Error("Set a public price before activating a store listing.");
  }
  if (input.storeStatus === "active" && sellableQuantity(item) <= 0 && !input.availableForSale) {
    throw new Error("Add available inventory before activating this store listing.");
  }
  return prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      publishToStore: input.publishToStore,
      publicSlug,
      publicTitle,
      publicDescription: input.publicDescription,
      publicPrice: input.publicPrice,
      compareAtPrice: input.compareAtPrice,
      publicImages: stringifyList(input.publicImages),
      availableForSale: input.availableForSale,
      maxQuantityPerOrder: input.maxQuantityPerOrder,
      shippingProfile: input.shippingProfile,
      storeStatus: input.storeStatus,
      localPickupAvailable: input.localPickupAvailable,
      shippingAvailable: input.shippingAvailable,
      storefrontCategory: input.storefrontCategory,
      storefrontTags: stringifyList(input.storefrontTags)
    },
    include: storefrontInventoryInclude
  });
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
  const [productCount, activeProductCount, pendingOrderCount, paidOrders] = await Promise.all([
    prisma.inventoryItem.count({ where: { ...(where as Prisma.InventoryItemWhereInput), publishToStore: true } }),
    prisma.inventoryItem.count({ where: { ...(where as Prisma.InventoryItemWhereInput), publishToStore: true, storeStatus: "active" } }),
    prisma.storefrontOrder.count({ where: { ...(where as Prisma.StorefrontOrderWhereInput), status: "pending_payment" } }),
    prisma.storefrontOrder.findMany({ where: { ...(where as Prisma.StorefrontOrderWhereInput), paymentStatus: "paid" }, select: { total: true, netProfit: true } })
  ]);
  return {
    productCount,
    activeProductCount,
    pendingOrderCount,
    paidOrderCount: paidOrders.length,
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
