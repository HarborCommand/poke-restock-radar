import type { ProductStatus } from "@/types/radar";
import { detectTargetSellerInfoFromText, type TargetFulfillmentType, type TargetSellerType } from "@/lib/target-retail-policy";

export type RetailerAvailabilitySignal = {
  status: ProductStatus | null;
  stockText: string | null;
  addToCartEnabled: boolean | null;
  confidenceScore: number;
  reason: string;
  detectedWords: string[];
};

export type RetailerLiveSignal = {
  price: number | null;
  availability: RetailerAvailabilitySignal;
  title: string | null;
  imageUrl: string | null;
  source: string;
  sku?: string | null;
  stockLevel?: "HIGH" | "LOW" | null;
  storeAvailabilityText?: string | null;
  sellerName?: string | null;
  sellerType?: TargetSellerType | null;
  fulfillmentType?: TargetFulfillmentType | null;
  sellerVerified?: boolean | null;
};

function htmlDecode(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleText(html: string) {
  return htmlDecode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).toLowerCase();
}

function compactText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueWords(words: string[]) {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function numberFromPrice(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : null;
}

function targetPrice(html: string) {
  const candidates = [
    /"current_retail"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"currentRetail"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"formatted_current_price"\s*:\s*"\$?\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"/i,
    /"formattedCurrentPrice"\s*:\s*"\$?\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"/i,
    /"price"\s*:\s*\{[^{}]{0,300}"value"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /data-test=["']product-price["'][^>]*>[\s\S]{0,120}?\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  ];

  for (const pattern of candidates) {
    const value = numberFromPrice(html.match(pattern)?.[1]);
    if (value !== null) return value;
  }

  return null;
}

function genericPrice(html: string) {
  const candidates = [
    /"price"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"salePrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"current_retail"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/
  ];

  for (const pattern of candidates) {
    const value = numberFromPrice(html.match(pattern)?.[1]);
    if (value !== null) return value;
  }

  return null;
}

function firstDecodedMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return htmlDecode(value.replace(/\\\//g, "/"));
  }
  return null;
}

function absolutePublicUrl(value: string | null, baseUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function bestBuySku(html: string, finalUrl: string) {
  try {
    const parsed = new URL(finalUrl);
    const fromQuery = parsed.searchParams.get("skuId");
    if (fromQuery) return fromQuery;
    const fromPath = parsed.pathname.match(/\/sku\/(\d{5,})/i)?.[1] ?? parsed.pathname.match(/\/(\d{5,})\.p(?:\/|$)/i)?.[1];
    if (fromPath) return fromPath;
  } catch {
    // Keep checking page text below.
  }

  return firstDecodedMatch(html, [
    /"skuId"\s*:\s*"?(\d{5,})"?/i,
    /"sku"\s*:\s*"?(\d{5,})"?/i,
    /(?:SKU|Sku)\s*[:#]?\s*<\/?[^>]*>?\s*(\d{5,})/i
  ]);
}

function bestBuyPrice(html: string) {
  const candidates = [
    /"salePrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"currentPrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"customerPrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"price"\s*:\s*\{[^{}]{0,300}"value"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /(?:priceView-hero-price|pricing-price)[\s\S]{0,180}?\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  ];

  for (const pattern of candidates) {
    const value = numberFromPrice(html.match(pattern)?.[1]);
    if (value !== null) return value;
  }

  return genericPrice(html);
}

function bestBuyTitle(html: string) {
  return firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']{4,240})["']/i,
    /<meta\s+content=["']([^"']{4,240})["']\s+(?:property|name)=["']og:title["']/i,
    /"name"\s*:\s*"([^"]{4,240})"/i,
    /<h1\b[^>]*>([\s\S]{4,300}?)<\/h1>/i
  ])?.replace(/\s*-\s*Best Buy\s*$/i, "") ?? null;
}

function bestBuyImage(html: string, finalUrl: string) {
  const image = firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i,
    /"primaryImage"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*"([^"]+)"/i
  ]);
  return absolutePublicUrl(image, finalUrl);
}

function gameStopProductId(html: string, finalUrl: string) {
  try {
    const parsed = new URL(finalUrl);
    const pathId =
      parsed.pathname.match(/\/(\d{5,})\.html(?:\/)?$/i)?.[1] ??
      parsed.pathname.match(/\/products\/[^/?#]+\/(\d{5,})(?:[/?#]|$)/i)?.[1];
    if (pathId) return pathId;
  } catch {
    // Keep checking page text below.
  }

  return firstDecodedMatch(html, [
    /"sku"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/i,
    /"productId"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/i,
    /"productID"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/i,
    /(?:SKU|Product\s*ID)\s*[:#]?\s*<\/?[^>]*>?\s*([A-Za-z0-9_-]{5,})/i
  ]);
}

function gameStopPrice(html: string) {
  const candidates = [
    /"price"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"salePrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"currentPrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"displayPrice"\s*:\s*"\$?\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"/i,
    /(?:product-price|actual-price|sales-price|price-sales)[\s\S]{0,180}?\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  ];

  for (const pattern of candidates) {
    const value = numberFromPrice(html.match(pattern)?.[1]);
    if (value !== null) return value;
  }

  return genericPrice(html);
}

function gameStopTitle(html: string) {
  return firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']{4,240})["']/i,
    /<meta\s+content=["']([^"']{4,240})["']\s+(?:property|name)=["']og:title["']/i,
    /"name"\s*:\s*"([^"]{4,240})"/i,
    /<h1\b[^>]*>([\s\S]{4,300}?)<\/h1>/i
  ])?.replace(/\s*(?:-\s*|\|\s*)GameStop(?:\.com)?\s*$/i, "") ?? null;
}

function gameStopImage(html: string, finalUrl: string) {
  const image = firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i,
    /"primaryImage"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*"([^"]+)"/i,
    /"imageUrl"\s*:\s*"([^"]+)"/i
  ]);
  return absolutePublicUrl(image, finalUrl);
}

function pokemonCenterProductId(html: string, finalUrl: string) {
  try {
    const parsed = new URL(finalUrl);
    const fromPath = parsed.pathname.match(/\/product\/([^/?#]+)/i)?.[1];
    if (fromPath) return fromPath;
  } catch {
    // Keep checking page text below.
  }

  return firstDecodedMatch(html, [
    /"sku"\s*:\s*"?([A-Za-z0-9_-]{3,})"?/i,
    /"productId"\s*:\s*"?([A-Za-z0-9_-]{3,})"?/i,
    /"productID"\s*:\s*"?([A-Za-z0-9_-]{3,})"?/i,
    /(?:SKU|Product\s*ID)\s*[:#]?\s*<\/?[^>]*>?\s*([A-Za-z0-9_-]{3,})/i
  ]);
}

function pokemonCenterPrice(html: string) {
  const candidates = [
    /"price"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"salePrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"currentPrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"displayPrice"\s*:\s*"\$?\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"/i,
    /(?:product-price|price-sales|sales-price|price-value)[\s\S]{0,180}?\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  ];

  for (const pattern of candidates) {
    const value = numberFromPrice(html.match(pattern)?.[1]);
    if (value !== null) return value;
  }

  return genericPrice(html);
}

function pokemonCenterTitle(html: string) {
  return firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']{4,240})["']/i,
    /<meta\s+content=["']([^"']{4,240})["']\s+(?:property|name)=["']og:title["']/i,
    /"name"\s*:\s*"([^"]{4,240})"/i,
    /<h1\b[^>]*>([\s\S]{4,300}?)<\/h1>/i
  ])?.replace(/\s*(?:-\s*|\|\s*)Pokemon Center(?: Official Site)?\s*$/i, "") ?? null;
}

function pokemonCenterImage(html: string, finalUrl: string) {
  const image = firstDecodedMatch(html, [
    /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i,
    /"primaryImage"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*"([^"]+)"/i,
    /"imageUrl"\s*:\s*"([^"]+)"/i
  ]);
  return absolutePublicUrl(image, finalUrl);
}

function bestBuyStockLevel(html: string): { level: "HIGH" | "LOW" | null; text: string | null } {
  const text = visibleText(html);
  const storeCount =
    Number(text.match(/available\s+(?:at|in)\s+(\d{1,3})\s+stores?/i)?.[1]) ||
    Number(text.match(/(\d{1,3})\s+stores?\s+(?:nearby\s+)?(?:have|with)\s+stock/i)?.[1]) ||
    0;
  const quantity =
    Number(html.match(/"availableQuantity"\s*:\s*(\d{1,4})/i)?.[1]) ||
    Number(html.match(/"quantity"\s*:\s*(\d{1,4})/i)?.[1]) ||
    0;

  if (storeCount >= 3 || quantity >= 5 || text.includes("available in many stores")) {
    return { level: "HIGH", text: storeCount ? `Available in ${storeCount} stores` : quantity ? `Quantity ${quantity}` : "High stock" };
  }
  if (storeCount > 0 || quantity > 0 || text.includes("limited stock") || text.includes("only a few left")) {
    return { level: "LOW", text: storeCount ? `Available in ${storeCount} store${storeCount === 1 ? "" : "s"}` : quantity ? `Quantity ${quantity}` : "Low stock" };
  }
  return { level: null, text: null };
}

export function detectRetailerPrice(html: string, retailerName: string) {
  if (retailerName.toLowerCase().includes("target")) {
    return targetPrice(html) ?? genericPrice(html);
  }
  if (retailerName.toLowerCase().includes("best buy")) {
    return bestBuyPrice(html);
  }
  if (retailerName.toLowerCase().includes("gamestop")) {
    return gameStopPrice(html);
  }
  if (retailerName.toLowerCase().includes("pokemon center")) {
    return pokemonCenterPrice(html);
  }

  return genericPrice(html);
}

function productIdFromTargetUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.match(/A-(\d{5,})/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function targetConfigFromHtml(html: string) {
  const parses = html.matchAll(/JSON\.parse\("([\s\S]*?)"\)/g);
  for (const match of parses) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`);
      if (typeof decoded !== "string" || !decoded.includes('"redskyAggregations"')) continue;
      return JSON.parse(decoded) as {
        serverLocationVariables?: { store_id?: string; primaryStore?: { id?: string } };
        services?: {
          redsky?: { apiKey?: string };
          redskyAggregations?: {
            baseUrl?: string;
            apis?: { product?: { endpointPaths?: Record<string, string> } };
          };
        };
      };
    } catch {
      // Ignore non-config JSON.parse payloads embedded by the retailer page.
    }
  }
  return null;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function fetchJson(url: string, finalUrl: string, userAgent: string) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
    headers: {
      Accept: "application/json",
      Origin: "https://www.target.com",
      Referer: finalUrl,
      "User-Agent": userAgent
    }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function targetRedskyAvailability(input: {
  fulfillment: Record<string, unknown> | null;
  fallback: RetailerAvailabilitySignal;
  price: number | null;
}): RetailerAvailabilitySignal {
  const fulfillment = input.fulfillment;
  const shipping = fulfillment?.shipping_options as Record<string, unknown> | undefined;
  const storeOptions = Array.isArray(fulfillment?.store_options) ? (fulfillment?.store_options as Array<Record<string, unknown>>) : [];
  const statuses = [
    textValue(shipping?.availability_status),
    textValue(shipping?.loyalty_availability_status),
    ...storeOptions.flatMap((option) => [
      textValue((option.order_pickup as Record<string, unknown> | undefined)?.availability_status),
      textValue((option.ship_to_store as Record<string, unknown> | undefined)?.availability_status),
      textValue((option.in_store_only as Record<string, unknown> | undefined)?.availability_status)
    ])
  ].filter((status): status is string => Boolean(status));
  const normalizedStatuses = statuses.map((status) => status.toUpperCase());
  const shippingQuantity = numeric(shipping?.available_to_promise_quantity) ?? 0;
  const preorderQuantity = numeric(shipping?.pre_order_available_to_promise_quantity) ?? 0;
  const allStoresOut = fulfillment?.is_out_of_stock_in_all_store_locations === true;
  const hasOutOfStock = normalizedStatuses.some((status) => status.includes("OUT_OF_STOCK"));
  const hasUnavailable = normalizedStatuses.some((status) => status.includes("UNAVAILABLE") || status.includes("NOT_SOLD"));
  const hasAvailable = normalizedStatuses.some((status) => status.includes("AVAILABLE") || status.includes("IN_STOCK"));
  const hasPreorder = normalizedStatuses.some((status) => status.includes("PREORDER") || status.includes("PRE_ORDER"));
  const priceText = input.price === null ? "price not verified" : `price ${input.price}`;
  const statusText = statuses.join(", ") || input.fallback.stockText || "unknown";

  if (hasOutOfStock || (allStoresOut && !hasAvailable)) {
    return {
      status: "SOLD_OUT",
      stockText: "Out of stock",
      addToCartEnabled: false,
      confidenceScore: 98,
      reason: `Target public product API reports ${priceText}, stock ${statusText}, and no available-to-promise quantity.`,
      detectedWords: uniqueWords([...input.fallback.detectedWords, "target redsky api", "out of stock", "add-to-cart enabled: false"])
    };
  }

  if (hasPreorder && preorderQuantity > 0) {
    return {
      status: "PREORDER_LIVE",
      stockText: "Preorder live",
      addToCartEnabled: true,
      confidenceScore: 96,
      reason: `Target public product API reports ${priceText}, preorder availability, and preorder quantity ${preorderQuantity}.`,
      detectedWords: uniqueWords([...input.fallback.detectedWords, "target redsky api", "preorder", "add-to-cart enabled: true"])
    };
  }

  if (hasAvailable && shippingQuantity > 0) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: "Add to cart available",
      addToCartEnabled: true,
      confidenceScore: 96,
      reason: `Target public product API reports ${priceText}, stock ${statusText}, and available-to-promise quantity ${shippingQuantity}.`,
      detectedWords: uniqueWords([...input.fallback.detectedWords, "target redsky api", "add to cart", "add-to-cart enabled: true"])
    };
  }

  if (hasUnavailable) {
    return {
      status: "UNAVAILABLE",
      stockText: statusText,
      addToCartEnabled: false,
      confidenceScore: 90,
      reason: `Target public product API reports ${priceText} and stock ${statusText}.`,
      detectedWords: uniqueWords([...input.fallback.detectedWords, "target redsky api", "unavailable", "add-to-cart enabled: false"])
    };
  }

  return input.fallback;
}

export async function fetchTargetRedskyLiveSignal(input: {
  html: string;
  finalUrl: string;
  retailerProductId?: string | null;
  userAgent: string;
  fallbackAvailability: RetailerAvailabilitySignal;
}): Promise<RetailerLiveSignal | null> {
  const config = targetConfigFromHtml(input.html);
  const key = config?.services?.redsky?.apiKey;
  const baseUrl = config?.services?.redskyAggregations?.baseUrl;
  const productPaths = config?.services?.redskyAggregations?.apis?.product?.endpointPaths;
  const tcin = input.retailerProductId || productIdFromTargetUrl(input.finalUrl);
  const storeId = config?.serverLocationVariables?.store_id || config?.serverLocationVariables?.primaryStore?.id || "2848";
  const pdpPath = productPaths?.pdpClientV1;
  const fulfillmentPath = productPaths?.productFulfillment;
  if (!key || !baseUrl || !tcin || !pdpPath || !fulfillmentPath) return null;

  const commonParams = {
    key,
    tcin,
    store_id: storeId,
    pricing_store_id: storeId,
    has_pricing_store_id: "true",
    include_obsolete: "true"
  };
  const pdpUrl = `${baseUrl}/${pdpPath}?${new URLSearchParams(commonParams)}`;
  const fulfillmentUrl = `${baseUrl}/${fulfillmentPath}?${new URLSearchParams(commonParams)}`;
  const [pdp, fulfillmentResponse] = await Promise.all([
    fetchJson(pdpUrl, input.finalUrl, input.userAgent),
    fetchJson(fulfillmentUrl, input.finalUrl, input.userAgent)
  ]);

  const product = ((pdp?.data as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined) ?? null;
  const price = numeric((product?.price as Record<string, unknown> | undefined)?.current_retail);
  const title =
    textValue(((product?.item as Record<string, unknown> | undefined)?.product_description as Record<string, unknown> | undefined)?.title) ??
    textValue(product?.title);
  const imageUrl =
    textValue(((product?.item as Record<string, unknown> | undefined)?.enrichment as Record<string, unknown> | undefined)?.primary_image_url) ??
    textValue(((product?.item as Record<string, unknown> | undefined)?.enrichment as Record<string, unknown> | undefined)?.image_url);
  const fulfillmentProduct =
    ((fulfillmentResponse?.data as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined) ?? null;
  const fulfillment = (fulfillmentProduct?.fulfillment as Record<string, unknown> | undefined) ?? null;
  const seller = detectTargetSellerInfoFromText({ product, fulfillmentProduct, fulfillment });

  return {
    price,
    title,
    imageUrl,
    source: "Target public Redsky API",
    sellerName: seller.sellerName,
    sellerType: seller.sellerType,
    fulfillmentType: seller.fulfillmentType,
    sellerVerified: seller.sellerVerified,
    availability: targetRedskyAvailability({
      fulfillment,
      fallback: input.fallbackAvailability,
      price
    })
  };
}

export function detectBestBuyAvailability(
  html: string,
  fallbackAvailability?: RetailerAvailabilitySignal
): RetailerAvailabilitySignal {
  const text = visibleText(html);
  const compact = compactText(`${html} ${text}`);
  const addToCartEnabled = enabledPurchaseAction(html, "Best Buy");
  const stockLevel = bestBuyStockLevel(html);
  const hasCaptcha =
    text.includes("captcha") ||
    text.includes("verify you are human") ||
    text.includes("robot check") ||
    text.includes("automated access") ||
    text.includes("press and hold");
  const hasBlocked =
    hasCaptcha ||
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily blocked") ||
    text.includes("waiting room");
  const hasSoldOut =
    text.includes("sold out") ||
    text.includes("out of stock") ||
    text.includes("currently unavailable") ||
    text.includes("unavailable nearby") ||
    compact.includes("outofstock") ||
    compact.includes("soldout") ||
    compact.includes("availabilityoutofstock");
  const hasUnavailable =
    text.includes("not available") ||
    text.includes("no longer available") ||
    text.includes("unavailable online") ||
    compact.includes("notavailable") ||
    compact.includes("unavailableonline");
  const hasPreorder = text.includes("preorder") || text.includes("pre-order") || compact.includes("preorder");
  const hasJsonInStock =
    /"availability"\s*:\s*"[^"]*InStock/i.test(html) ||
    /"availableForSale"\s*:\s*true/i.test(html) ||
    /"inStock"\s*:\s*true/i.test(html);
  const detectedWords = uniqueWords([
    ...(fallbackAvailability?.detectedWords ?? []),
    "best buy adapter",
    hasCaptcha ? "captcha/robot page" : "",
    hasBlocked ? "blocked page" : "",
    hasSoldOut ? "out of stock" : "",
    hasUnavailable ? "unavailable" : "",
    hasPreorder ? "preorder" : "",
    addToCartEnabled === true ? "enabled purchase button" : "",
    addToCartEnabled === false ? "disabled purchase button" : "",
    hasJsonInStock ? "in stock" : "",
    stockLevel.level === "HIGH" ? "high stock" : "",
    stockLevel.level === "LOW" ? "low stock" : "",
    stockLevel.text ? `store stock cue: ${stockLevel.text}` : "",
    "best buy store stock source not available"
  ]);

  if (hasBlocked) {
    return {
      status: null,
      stockText: hasCaptcha ? "Captcha or robot page" : "Blocked page",
      addToCartEnabled: null,
      confidenceScore: 0,
      reason: "Best Buy page appears blocked or shows captcha/robot verification. No buy alert will be sent.",
      detectedWords
    };
  }

  if (hasSoldOut) {
    return {
      status: "SOLD_OUT",
      stockText: "Out of stock",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 96 : 90,
      reason: "Best Buy public page says sold out/out of stock.",
      detectedWords
    };
  }

  if (hasUnavailable || addToCartEnabled === false) {
    return {
      status: "UNAVAILABLE",
      stockText: addToCartEnabled === false ? "Purchase button disabled" : "Unavailable",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 92 : 84,
      reason: addToCartEnabled === false
        ? "Best Buy purchase button is disabled; product is not buyable right now."
        : "Best Buy page has unavailable cues.",
      detectedWords
    };
  }

  if (hasPreorder && addToCartEnabled === true) {
    return {
      status: "PREORDER_LIVE",
      stockText: stockLevel.text || "Preorder live",
      addToCartEnabled: true,
      confidenceScore: 94,
      reason: "Best Buy preorder cues matched and an enabled purchase button was found.",
      detectedWords
    };
  }

  if (addToCartEnabled === true) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: stockLevel.text || "Add to cart available",
      addToCartEnabled: true,
      confidenceScore: 96,
      reason: "Best Buy exact product page has an enabled public Add to Cart action.",
      detectedWords
    };
  }

  if (hasJsonInStock) {
    return {
      status: "IN_STOCK",
      stockText: stockLevel.text || "In stock",
      addToCartEnabled: null,
      confidenceScore: 86,
      reason: "Best Buy public product data reports in-stock availability, but no enabled purchase button was proven.",
      detectedWords
    };
  }

  const safeFallbackStatus =
    fallbackAvailability?.status === "SOLD_OUT" ||
    fallbackAvailability?.status === "UNAVAILABLE" ||
    fallbackAvailability?.status === "PAGE_UPDATED" ||
    fallbackAvailability?.status === "PRICE_CHANGE"
      ? fallbackAvailability.status
      : null;

  return {
    status: safeFallbackStatus,
    stockText: safeFallbackStatus ? fallbackAvailability?.stockText ?? stockLevel.text : stockLevel.text,
    addToCartEnabled: safeFallbackStatus ? fallbackAvailability?.addToCartEnabled ?? null : null,
    confidenceScore: safeFallbackStatus ? Math.max(fallbackAvailability?.confidenceScore ?? 35, stockLevel.level ? 58 : 35) : stockLevel.level ? 58 : 35,
    reason:
      safeFallbackStatus && fallbackAvailability?.reason
        ? fallbackAvailability.reason
        : "Best Buy public page did not prove an actionable buyable stock signal.",
    detectedWords
  };
}

export async function fetchBestBuyLiveSignal(input: {
  html: string;
  finalUrl: string;
  fallbackAvailability: RetailerAvailabilitySignal;
}): Promise<RetailerLiveSignal | null> {
  const sku = bestBuySku(input.html, input.finalUrl);
  const stockLevel = bestBuyStockLevel(input.html);
  return {
    price: bestBuyPrice(input.html),
    title: bestBuyTitle(input.html),
    imageUrl: bestBuyImage(input.html, input.finalUrl),
    source: "Best Buy public product page",
    sku,
    stockLevel: stockLevel.level,
    storeAvailabilityText: stockLevel.text,
    availability: detectBestBuyAvailability(input.html, input.fallbackAvailability)
  };
}

export function detectGameStopAvailability(
  html: string,
  fallbackAvailability?: RetailerAvailabilitySignal
): RetailerAvailabilitySignal {
  const text = visibleText(html);
  const compact = compactText(`${html} ${text}`);
  const addToCartEnabled = enabledPurchaseAction(html, "GameStop");
  const hasCaptcha =
    text.includes("captcha") ||
    text.includes("verify you are human") ||
    text.includes("robot check") ||
    text.includes("automated access") ||
    text.includes("press and hold");
  const hasBlocked =
    hasCaptcha ||
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily blocked") ||
    text.includes("waiting room");
  const hasSoldOut =
    text.includes("sold out") ||
    text.includes("out of stock") ||
    text.includes("currently unavailable") ||
    text.includes("temporarily unavailable") ||
    compact.includes("outofstock") ||
    compact.includes("soldout") ||
    compact.includes("availabilityoutofstock");
  const hasUnavailable =
    text.includes("not available") ||
    text.includes("no longer available") ||
    text.includes("unavailable online") ||
    text.includes("not available for shipping") ||
    text.includes("not available for pickup") ||
    compact.includes("notavailable") ||
    compact.includes("unavailableonline");
  const hasPreorder =
    text.includes("preorder") ||
    text.includes("pre-order") ||
    text.includes("pre order") ||
    compact.includes("preorder");
  const hasJsonInStock =
    /"availability"\s*:\s*"[^"]*InStock/i.test(html) ||
    /"availableForSale"\s*:\s*true/i.test(html) ||
    /"inStock"\s*:\s*true/i.test(html);
  const detectedWords = uniqueWords([
    ...(fallbackAvailability?.detectedWords ?? []),
    "gamestop adapter",
    hasCaptcha ? "captcha/robot page" : "",
    hasBlocked ? "blocked page" : "",
    hasSoldOut ? "out of stock" : "",
    hasUnavailable ? "unavailable" : "",
    hasPreorder ? "preorder" : "",
    addToCartEnabled === true ? "enabled purchase button" : "",
    addToCartEnabled === false ? "disabled purchase button" : "",
    hasJsonInStock ? "in stock" : "",
    "gamestop store stock source not available"
  ]);

  if (hasBlocked) {
    return {
      status: null,
      stockText: hasCaptcha ? "Captcha or robot page" : "Blocked page",
      addToCartEnabled: null,
      confidenceScore: 0,
      reason: "GameStop page appears blocked or shows captcha/robot verification. No buy alert will be sent.",
      detectedWords
    };
  }

  if (hasSoldOut) {
    return {
      status: "SOLD_OUT",
      stockText: "Sold out",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 96 : 90,
      reason: "GameStop public product page says sold out/out of stock.",
      detectedWords
    };
  }

  if (hasUnavailable || addToCartEnabled === false) {
    return {
      status: "UNAVAILABLE",
      stockText: addToCartEnabled === false ? "Purchase button disabled" : "Unavailable",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 92 : 84,
      reason: addToCartEnabled === false
        ? "GameStop purchase button is disabled; product is not buyable right now."
        : "GameStop page has unavailable cues.",
      detectedWords
    };
  }

  if (hasPreorder && addToCartEnabled === true) {
    return {
      status: "PREORDER_LIVE",
      stockText: "Preorder live",
      addToCartEnabled: true,
      confidenceScore: 94,
      reason: "GameStop preorder cues matched and an enabled public purchase button was found.",
      detectedWords
    };
  }

  if (addToCartEnabled === true) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: "Add to cart available",
      addToCartEnabled: true,
      confidenceScore: 96,
      reason: "GameStop exact product page has an enabled public Add to Cart action.",
      detectedWords
    };
  }

  if (hasJsonInStock) {
    return {
      status: "IN_STOCK",
      stockText: "In stock",
      addToCartEnabled: null,
      confidenceScore: 78,
      reason: "GameStop public product data reports in-stock availability, but no enabled purchase button was separately proven.",
      detectedWords
    };
  }

  const safeFallbackStatus =
    fallbackAvailability?.status === "SOLD_OUT" ||
    fallbackAvailability?.status === "UNAVAILABLE" ||
    fallbackAvailability?.status === "PAGE_UPDATED" ||
    fallbackAvailability?.status === "PRICE_CHANGE"
      ? fallbackAvailability.status
      : null;

  return {
    status: safeFallbackStatus,
    stockText: safeFallbackStatus ? fallbackAvailability?.stockText ?? null : null,
    addToCartEnabled: safeFallbackStatus ? fallbackAvailability?.addToCartEnabled ?? null : null,
    confidenceScore: safeFallbackStatus ? Math.max(fallbackAvailability?.confidenceScore ?? 35, 35) : 35,
    reason:
      safeFallbackStatus && fallbackAvailability?.reason
        ? fallbackAvailability.reason
        : "GameStop public page did not prove an actionable buyable stock signal.",
    detectedWords
  };
}

export async function fetchGameStopLiveSignal(input: {
  html: string;
  finalUrl: string;
  fallbackAvailability: RetailerAvailabilitySignal;
}): Promise<RetailerLiveSignal | null> {
  return {
    price: gameStopPrice(input.html),
    title: gameStopTitle(input.html),
    imageUrl: gameStopImage(input.html, input.finalUrl),
    source: "GameStop public product page",
    sku: gameStopProductId(input.html, input.finalUrl),
    stockLevel: null,
    storeAvailabilityText: "GameStop store stock source not available",
    availability: detectGameStopAvailability(input.html, input.fallbackAvailability)
  };
}

export function detectPokemonCenterAvailability(
  html: string,
  fallbackAvailability?: RetailerAvailabilitySignal
): RetailerAvailabilitySignal {
  const text = visibleText(html);
  const compact = compactText(`${html} ${text}`);
  const addToCartEnabled = enabledPurchaseAction(html, "Pokemon Center");
  const hasCaptcha =
    text.includes("captcha") ||
    text.includes("verify you are human") ||
    text.includes("robot check") ||
    text.includes("automated access") ||
    text.includes("press and hold") ||
    text.includes("are you a human");
  const hasQueue =
    text.includes("queue-it") ||
    text.includes("queue it") ||
    text.includes("waiting room") ||
    text.includes("please wait") ||
    text.includes("you are now in line");
  const hasBlocked =
    hasCaptcha ||
    hasQueue ||
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily blocked") ||
    text.includes("incapsula") ||
    text.includes("cloudflare");
  const hasSoldOut =
    text.includes("sold out") ||
    text.includes("out of stock") ||
    text.includes("currently unavailable") ||
    text.includes("temporarily unavailable") ||
    compact.includes("outofstock") ||
    compact.includes("soldout") ||
    compact.includes("availabilityoutofstock");
  const hasUnavailable =
    text.includes("unavailable") ||
    text.includes("not available") ||
    text.includes("no longer available") ||
    compact.includes("notavailable") ||
    compact.includes("unavailableonline");
  const hasPreorder =
    text.includes("preorder") ||
    text.includes("pre-order") ||
    text.includes("pre order") ||
    compact.includes("preorder");
  const hasJsonInStock =
    /"availability"\s*:\s*"[^"]*InStock/i.test(html) ||
    /"availableForSale"\s*:\s*true/i.test(html) ||
    /"inStock"\s*:\s*true/i.test(html);
  const detectedWords = uniqueWords([
    ...(fallbackAvailability?.detectedWords ?? []),
    "pokemon center adapter",
    hasCaptcha ? "captcha/robot page" : "",
    hasQueue ? "queue/waiting room" : "",
    hasBlocked ? "blocked page" : "",
    hasSoldOut ? "out of stock" : "",
    hasUnavailable ? "unavailable" : "",
    hasPreorder ? "preorder" : "",
    addToCartEnabled === true ? "enabled purchase button" : "",
    addToCartEnabled === false ? "disabled purchase button" : "",
    hasJsonInStock ? "in stock" : "",
    "pokemon center online-only"
  ]);

  if (hasBlocked) {
    return {
      status: null,
      stockText: hasQueue ? "Queue or waiting room" : hasCaptcha ? "Captcha or robot page" : "Blocked page",
      addToCartEnabled: null,
      confidenceScore: 0,
      reason: "Pokemon Center page appears blocked, queued, or shows captcha/robot verification. No buy alert will be sent.",
      detectedWords
    };
  }

  if (hasSoldOut) {
    return {
      status: "SOLD_OUT",
      stockText: "Sold out",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 96 : 90,
      reason: "Pokemon Center public product page says sold out/out of stock.",
      detectedWords
    };
  }

  if (hasUnavailable || addToCartEnabled === false) {
    return {
      status: "UNAVAILABLE",
      stockText: addToCartEnabled === false ? "Purchase button disabled" : "Unavailable",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 92 : 84,
      reason: addToCartEnabled === false
        ? "Pokemon Center purchase button is disabled; product is not buyable right now."
        : "Pokemon Center page has unavailable cues.",
      detectedWords
    };
  }

  if (hasPreorder && addToCartEnabled === true) {
    return {
      status: "PREORDER_LIVE",
      stockText: "Preorder live",
      addToCartEnabled: true,
      confidenceScore: 94,
      reason: "Pokemon Center preorder cues matched and an enabled public purchase button was found.",
      detectedWords
    };
  }

  if (addToCartEnabled === true) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: "Add to cart available",
      addToCartEnabled: true,
      confidenceScore: 96,
      reason: "Pokemon Center exact product page has an enabled public Add to Cart action.",
      detectedWords
    };
  }

  if (hasJsonInStock) {
    return {
      status: "IN_STOCK",
      stockText: "In stock",
      addToCartEnabled: null,
      confidenceScore: 82,
      reason: "Pokemon Center public product data reports in-stock availability, but no enabled purchase button was separately proven.",
      detectedWords
    };
  }

  const safeFallbackStatus =
    fallbackAvailability?.status === "SOLD_OUT" ||
    fallbackAvailability?.status === "UNAVAILABLE" ||
    fallbackAvailability?.status === "PAGE_UPDATED" ||
    fallbackAvailability?.status === "PRICE_CHANGE"
      ? fallbackAvailability.status
      : null;

  return {
    status: safeFallbackStatus ?? "UNAVAILABLE",
    stockText: safeFallbackStatus ? fallbackAvailability?.stockText ?? null : "Not proven available",
    addToCartEnabled: safeFallbackStatus ? fallbackAvailability?.addToCartEnabled ?? null : null,
    confidenceScore: safeFallbackStatus ? Math.max(fallbackAvailability?.confidenceScore ?? 35, 35) : 35,
    reason:
      safeFallbackStatus && fallbackAvailability?.reason
        ? fallbackAvailability.reason
        : "Pokemon Center public page did not prove an actionable buyable stock signal.",
    detectedWords
  };
}

export async function fetchPokemonCenterLiveSignal(input: {
  html: string;
  finalUrl: string;
  fallbackAvailability: RetailerAvailabilitySignal;
}): Promise<RetailerLiveSignal | null> {
  return {
    price: pokemonCenterPrice(input.html),
    title: pokemonCenterTitle(input.html),
    imageUrl: pokemonCenterImage(input.html, input.finalUrl),
    source: "Pokemon Center public product page",
    sku: pokemonCenterProductId(input.html, input.finalUrl),
    stockLevel: null,
    storeAvailabilityText: "Pokemon Center is online-only; use Online Drops / Watchlist.",
    availability: detectPokemonCenterAvailability(input.html, input.fallbackAvailability)
  };
}

function hasDisabledAttribute(value: string) {
  return (
    /\sdisabled(?:\s|=|>)/i.test(value) ||
    /aria-disabled=["']?true/i.test(value) ||
    /data-disabled=["']?true/i.test(value) ||
    /disabled=["']?true/i.test(value)
  );
}

function targetAddToCartEnabled(html: string) {
  const buttonMatches = html.match(/<button\b[\s\S]{0,900}?(?:add to cart|add for shipping|ship it)[\s\S]{0,500}?<\/button>/gi) ?? [];
  const ariaMatches = html.match(/<(?:button|a)\b[^>]+aria-label=["'][^"']*(?:add to cart|add for shipping|ship it)[^"']*["'][^>]*>/gi) ?? [];
  const candidates = [...buttonMatches, ...ariaMatches];

  if (candidates.length) {
    const enabled = candidates.some((candidate) => !hasDisabledAttribute(candidate));
    return enabled ? true : false;
  }

  const explicitEnabled =
    /"addToCart(?:Enabled|Available|ButtonEnabled)"\s*:\s*true/i.test(html) ||
    /"isAddToCartEnabled"\s*:\s*true/i.test(html);
  if (explicitEnabled) return true;

  const explicitDisabled =
    /"addToCart(?:Enabled|Available|ButtonEnabled)"\s*:\s*false/i.test(html) ||
    /"isAddToCartEnabled"\s*:\s*false/i.test(html) ||
    /"buttonState"\s*:\s*"disabled"/i.test(html);
  if (explicitDisabled) return false;

  return null;
}

function buttonLabelPattern(retailerName: string) {
  const retailer = retailerName.toLowerCase();
  if (retailer.includes("best buy")) return "(?:add to cart|pre-order|preorder|buy now)";
  if (retailer.includes("gamestop")) return "(?:add to cart|add to bag|pre-order|preorder)";
  if (retailer.includes("pokemon center")) return "(?:add to cart|add to bag|pre-order|preorder)";
  if (retailer.includes("walmart")) return "(?:add to cart|add to cart for shipping|preorder|pre-order)";
  if (retailer.includes("amazon")) return "(?:add to cart|buy now|pre-order|preorder)";
  return "(?:add to cart|add to bag|buy now|pre-order|preorder)";
}

function enabledPurchaseAction(html: string, retailerName: string) {
  const labelPattern = buttonLabelPattern(retailerName);
  const elementPattern = new RegExp(
    `<(?:button|a|input)\\b[\\s\\S]{0,900}?${labelPattern}[\\s\\S]{0,500}?(?:>|<\\/(?:button|a)>)`,
    "gi"
  );
  const ariaPattern = new RegExp(
    `<(?:button|a|input)\\b[^>]+(?:aria-label|title|value)=["'][^"']*${labelPattern}[^"']*["'][^>]*>`,
    "gi"
  );
  const candidates = [...(html.match(elementPattern) ?? []), ...(html.match(ariaPattern) ?? [])];
  if (candidates.length) {
    return candidates.some((candidate) => !hasDisabledAttribute(candidate));
  }

  const explicitEnabled =
    /"isAddToCartEnabled"\s*:\s*true/i.test(html) ||
    /"addToCart(?:Enabled|Available|ButtonEnabled)"\s*:\s*true/i.test(html) ||
    /"availableForSale"\s*:\s*true/i.test(html) ||
    /"inStock"\s*:\s*true/i.test(html);
  if (explicitEnabled) return true;

  const explicitDisabled =
    /"isAddToCartEnabled"\s*:\s*false/i.test(html) ||
    /"addToCart(?:Enabled|Available|ButtonEnabled)"\s*:\s*false/i.test(html) ||
    /"availableForSale"\s*:\s*false/i.test(html) ||
    /"inStock"\s*:\s*false/i.test(html) ||
    /"availability"\s*:\s*"[^"]*OutOfStock/i.test(html);
  if (explicitDisabled) return false;

  return null;
}

export function detectRetailerAvailability(html: string, retailerName: string): RetailerAvailabilitySignal {
  if (retailerName.toLowerCase().includes("target")) return detectTargetAvailability(html);
  if (retailerName.toLowerCase().includes("best buy")) return detectBestBuyAvailability(html);
  if (retailerName.toLowerCase().includes("gamestop")) return detectGameStopAvailability(html);
  if (retailerName.toLowerCase().includes("pokemon center")) return detectPokemonCenterAvailability(html);

  const text = visibleText(html);
  const compact = compactText(`${html} ${text}`);
  const addToCartEnabled = enabledPurchaseAction(html, retailerName);
  const hasCaptcha =
    text.includes("captcha") ||
    text.includes("verify you are human") ||
    text.includes("robot check") ||
    text.includes("automated access") ||
    text.includes("press and hold") ||
    text.includes("sorry, we just need to make sure");
  const hasBlocked =
    hasCaptcha ||
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily blocked") ||
    text.includes("waiting room");
  const hasSoldOut =
    text.includes("out of stock") ||
    text.includes("sold out") ||
    text.includes("currently unavailable") ||
    text.includes("temporarily out of stock") ||
    compact.includes("outofstock") ||
    compact.includes("soldout") ||
    compact.includes("availabilityoutofstock");
  const hasUnavailable =
    text.includes("not available") ||
    text.includes("no longer available") ||
    text.includes("unavailable online") ||
    compact.includes("notavailable") ||
    compact.includes("unavailableonline");
  const hasPreorder = text.includes("preorder") || text.includes("pre-order") || compact.includes("preorder");
  const hasInStock =
    text.includes("in stock") ||
    text.includes("available to ship") ||
    text.includes("ships from") ||
    text.includes("available for pickup") ||
    compact.includes("availabilityinstock") ||
    compact.includes("availabletoship");

  const detectedWords = uniqueWords([
    hasCaptcha ? "captcha/robot page" : "",
    hasBlocked ? "blocked page" : "",
    hasSoldOut ? "out of stock" : "",
    hasUnavailable ? "unavailable" : "",
    hasPreorder ? "preorder" : "",
    hasInStock ? "in stock" : "",
    addToCartEnabled === true ? "enabled purchase button" : "",
    addToCartEnabled === false ? "disabled purchase button" : ""
  ]);

  if (hasBlocked) {
    return {
      status: null,
      stockText: hasCaptcha ? "Captcha or robot page" : "Blocked page",
      addToCartEnabled: null,
      confidenceScore: 0,
      reason: `${retailerName} page appears blocked or shows captcha/robot verification. No buy alert will be sent.`,
      detectedWords
    };
  }

  if (hasSoldOut) {
    return {
      status: "SOLD_OUT",
      stockText: "Out of stock",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 94 : 86,
      reason: `${retailerName} public page says sold out/currently unavailable.`,
      detectedWords
    };
  }

  if (hasUnavailable || addToCartEnabled === false) {
    return {
      status: "UNAVAILABLE",
      stockText: addToCartEnabled === false ? "Purchase button disabled" : "Unavailable",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 88 : 80,
      reason: addToCartEnabled === false
        ? `${retailerName} purchase button is disabled; product is not buyable right now.`
        : `${retailerName} page has unavailable cues.`,
      detectedWords
    };
  }

  if (hasPreorder && addToCartEnabled === true) {
    return {
      status: "PREORDER_LIVE",
      stockText: "Preorder live",
      addToCartEnabled,
      confidenceScore: 92,
      reason: `${retailerName} preorder cues matched and an enabled purchase button was found.`,
      detectedWords
    };
  }

  if (addToCartEnabled === true) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: "Add to cart available",
      addToCartEnabled,
      confidenceScore: 92,
      reason: `${retailerName} page has an enabled purchase button.`,
      detectedWords
    };
  }

  if (hasInStock) {
    return {
      status: "IN_STOCK",
      stockText: "In stock cue found",
      addToCartEnabled: null,
      confidenceScore: 78,
      reason: `${retailerName} page has in-stock cues but no proven enabled purchase button.`,
      detectedWords
    };
  }

  return {
    status: "UNAVAILABLE",
    stockText: "No enabled purchase proof",
    addToCartEnabled: null,
    confidenceScore: 60,
    reason: `${retailerName} parser could not prove this product is buyable, so it defaults to unavailable.`,
    detectedWords
  };
}

export function detectTargetAvailability(html: string): RetailerAvailabilitySignal {
  const text = visibleText(html);
  const compact = compactText(`${html} ${text}`);
  const addToCartEnabled = targetAddToCartEnabled(html);
  const hasSoldOut =
    text.includes("out of stock") ||
    text.includes("sold out") ||
    compact.includes("outofstock") ||
    compact.includes("soldout") ||
    compact.includes("availabilitystatusoutofstock") ||
    compact.includes("availabilitystatussoldout") ||
    compact.includes("isoutofstocktrue");
  const hasUnavailable =
    text.includes("currently unavailable") ||
    text.includes("not available") ||
    compact.includes("currentlyunavailable") ||
    compact.includes("notavailable");
  const hasPreorder = text.includes("preorder") || text.includes("pre-order") || compact.includes("preorder");
  const hasInStock =
    text.includes("in stock") ||
    text.includes("available to ship") ||
    compact.includes("availabilitystatusinstock") ||
    compact.includes("isinstocktrue");

  const detectedWords = uniqueWords([
    hasSoldOut ? "out of stock" : "",
    hasUnavailable ? "not available" : "",
    hasPreorder ? "preorder" : "",
    hasInStock ? "in stock" : "",
    addToCartEnabled === true ? "enabled add to cart button" : "",
    addToCartEnabled === false ? "disabled add to cart button" : ""
  ]);

  if (hasSoldOut) {
    return {
      status: "SOLD_OUT",
      stockText: "Out of stock",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: addToCartEnabled === false ? 97 : 92,
      reason: addToCartEnabled === false
        ? "Target page says out of stock and the Add to cart button is disabled."
        : "Target page says out of stock.",
      detectedWords
    };
  }

  if (hasPreorder && addToCartEnabled === true) {
    return {
      status: "PREORDER_LIVE",
      stockText: "Preorder with enabled Add to cart",
      addToCartEnabled,
      confidenceScore: 94,
      reason: "Target preorder cues matched and an enabled Add to cart button was found.",
      detectedWords
    };
  }

  if (addToCartEnabled === true) {
    return {
      status: "ADD_TO_CART_AVAILABLE",
      stockText: "Add to cart enabled",
      addToCartEnabled,
      confidenceScore: 95,
      reason: "Target page has an enabled Add to cart button.",
      detectedWords
    };
  }

  if (hasUnavailable || addToCartEnabled === false) {
    return {
      status: "UNAVAILABLE",
      stockText: addToCartEnabled === false ? "Add to cart disabled" : "Unavailable",
      addToCartEnabled: addToCartEnabled ?? false,
      confidenceScore: 82,
      reason: addToCartEnabled === false
        ? "Target Add to cart button is disabled; product is not buyable right now."
        : "Target page has unavailable cues.",
      detectedWords
    };
  }

  return {
    status: "UNAVAILABLE",
    stockText: "No enabled Add to cart proof",
    addToCartEnabled: null,
    confidenceScore: 65,
    reason: "Target parser could not prove an enabled Add to cart button, so it defaults to unavailable.",
    detectedWords
  };
}
