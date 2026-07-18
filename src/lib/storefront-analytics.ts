export const STOREFRONT_ANALYTICS_EVENTS = [
  "product_viewed",
  "shop_searched",
  "shop_filter_used",
  "product_added_to_cart",
  "product_removed_from_cart",
  "checkout_started",
  "local_pickup_selected",
  "purchase_completed",
  "account_login_requested"
] as const;

export type StorefrontAnalyticsEvent = (typeof STOREFRONT_ANALYTICS_EVENTS)[number];

type SafeAnalyticsValue = string | number | boolean | null;

export type StorefrontAnalyticsPayload = Partial<{
  productSlug: string;
  productCategory: string;
  productStatus: string;
  quantity: number;
  itemCount: number;
  fulfillmentMethod: "shipping" | "pickup";
  checkoutMode: "stripe" | "invoice";
  source: string;
  resultCount: number;
  hasQuery: boolean;
  filterCount: number;
}>;

const allowedPayloadKeys = new Set<keyof StorefrontAnalyticsPayload>([
  "productSlug",
  "productCategory",
  "productStatus",
  "quantity",
  "itemCount",
  "fulfillmentMethod",
  "checkoutMode",
  "source",
  "resultCount",
  "hasQuery",
  "filterCount"
]);

const blockedPayloadKeyPattern = /email|phone|address|note|token|secret|password|stripe|payment|customer|order|idempotency|metadata|reference|session/i;

function analyticsEnabled() {
  return process.env.NEXT_PUBLIC_GDG_ANALYTICS_ENABLED === "true";
}

function safeString(value: string) {
  return value.replace(/[^\w\s./:-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function sanitizeStorefrontAnalyticsPayload(payload: StorefrontAnalyticsPayload = {}) {
  const clean: Record<string, SafeAnalyticsValue> = {};
  for (const [key, value] of Object.entries(payload) as Array<[keyof StorefrontAnalyticsPayload, unknown]>) {
    if (!allowedPayloadKeys.has(key) || blockedPayloadKeyPattern.test(key)) continue;
    if (typeof value === "string") clean[key] = safeString(value);
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.max(0, Math.round(value));
    if (typeof value === "boolean") clean[key] = value;
    if (value === null) clean[key] = null;
  }
  return clean;
}

export function trackStorefrontEvent(event: StorefrontAnalyticsEvent, payload: StorefrontAnalyticsPayload = {}) {
  if (!STOREFRONT_ANALYTICS_EVENTS.includes(event)) return;
  try {
    const detail = {
      event,
      payload: sanitizeStorefrontAnalyticsPayload(payload)
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gamedaygrabs:analytics", { detail }));
    }
    if (!analyticsEnabled()) return;
    const analytics = typeof window !== "undefined" ? (window as typeof window & { dataLayer?: unknown[] }).dataLayer : null;
    if (Array.isArray(analytics)) analytics.push(detail);
  } catch {
    // Analytics must never block storefront browsing, cart updates, or checkout.
  }
}
