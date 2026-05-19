import type { ProductStatus } from "@/types/radar";

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

export function detectRetailerPrice(html: string, retailerName: string) {
  if (retailerName.toLowerCase().includes("target")) {
    return targetPrice(html) ?? genericPrice(html);
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

  return {
    price,
    title,
    imageUrl,
    source: "Target public Redsky API",
    availability: targetRedskyAvailability({
      fulfillment,
      fallback: input.fallbackAvailability,
      price
    })
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
