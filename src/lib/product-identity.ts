import type { ProductVerificationStatus } from "@/types/radar";

export type ProductIdentityInput = {
  retailerName: string;
  name: string;
  url: string;
  expectedTitleKeywords?: string | null;
  upc?: string | null;
  sku?: string | null;
  dpci?: string | null;
  retailerProductId?: string | null;
  retailPrice?: number | null;
};

export type RetailerUrlClassification = {
  exactProductUrl: boolean;
  searchOrCategory: boolean;
  retailerProductIdFromUrl: string | null;
  reason: string;
};

export type ProductIdentityMatch = {
  verificationStatus: ProductVerificationStatus;
  readyForAlert: boolean;
  actionUrl: string | null;
  exactProductUrl: boolean;
  searchOrCategory: boolean;
  possibleMismatch: boolean;
  needsIdentifiers: boolean;
  productIdVerified: boolean;
  titleMatched: boolean;
  titleKeywords: string[];
  matchedTitleKeywords: string[];
  expectedIdentifiers: string[];
  matchedIdentifiers: string[];
  missingIdentifiers: string[];
  retailerProductIdFromUrl: string | null;
  notes: string[];
};

const titleStopWords = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "pokemon",
  "tcg",
  "trading",
  "card",
  "game",
  "cards"
]);

function cleanText(value: string | null | undefined) {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value: string | null | undefined) {
  return cleanText(value).toLowerCase();
}

function normalizedIdentifier(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function compactIdentifier(value: string | null | undefined) {
  return normalizedIdentifier(value).replace(/[^a-z0-9]/g, "");
}

function splitList(value: string | null | undefined) {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => cleanText(item).toLowerCase())
        .filter((item) => item.length >= 2)
    )
  ];
}

function titleKeywords(input: ProductIdentityInput) {
  const explicit = splitList(input.expectedTitleKeywords);
  if (explicit.length) return explicit.slice(0, 12);
  return [
    ...new Set(
      input.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 4 && !titleStopWords.has(part))
    )
  ].slice(0, 8);
}

function identifierVariants(value: string | null | undefined) {
  const normalized = normalizedIdentifier(value);
  const compact = compactIdentifier(value);
  return [...new Set([normalized, compact].filter((item) => item.length >= 3))];
}

function textIncludesIdentifier(text: string, value: string | null | undefined) {
  const normalized = normalizedText(text);
  const compact = compactIdentifier(text);
  return identifierVariants(value).some((variant) => normalized.includes(variant) || compact.includes(variant));
}

function hostMatches(parsed: URL, hostPart: string) {
  return parsed.hostname.replace(/^www\./, "").toLowerCase().endsWith(hostPart);
}

function urlProductIdFromTarget(path: string) {
  return path.match(/(?:^|\/)-?\/?A-(\d{5,})/i)?.[1] ?? path.match(/A-(\d{5,})/i)?.[1] ?? null;
}

function urlProductIdFromWalmart(path: string) {
  const parts = path.split("/").filter(Boolean);
  const numeric = [...parts].reverse().find((part) => /^\d{6,}$/.test(part));
  return numeric ?? null;
}

function urlProductIdFromBestBuy(parsed: URL) {
  return parsed.pathname.match(/\/sku\/(\d{5,})/i)?.[1] ?? parsed.searchParams.get("skuId");
}

function urlProductIdFromAmazon(path: string) {
  return path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1] ?? null;
}

function urlProductIdFromGameStop(path: string) {
  return path.match(/\/(\d{5,})\.html(?:\/)?$/i)?.[1] ?? path.match(/\/products\/([^/?#]+)/i)?.[1] ?? null;
}

function urlProductIdFromPokemonCenter(path: string) {
  return path.match(/\/product\/([^/?#]+)/i)?.[1] ?? null;
}

export function classifyRetailerProductUrl(value: string, retailerName: string): RetailerUrlClassification {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    const retailer = retailerName.toLowerCase();
    const hasSearchQuery = parsed.searchParams.has("q") || parsed.searchParams.has("searchTerm") || parsed.searchParams.has("keyword");
    const genericPath =
      path === "/" ||
      path === "" ||
      path.includes("/search") ||
      path.includes("/category") ||
      path.includes("/categories") ||
      path.includes("/browse") ||
      path.includes("/collection") ||
      path.includes("/collections");

    if (retailer.includes("target")) {
      const productId = urlProductIdFromTarget(parsed.pathname);
      const searchOrCategory = hasSearchQuery || path.startsWith("/s") || path.startsWith("/c") || genericPath;
      return {
        exactProductUrl: hostMatches(parsed, "target.com") && path.includes("/p/") && Boolean(productId),
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory
          ? "Target search/category URL detected. Use the product page link, not the search results page."
          : "Target product URL checked for /p/ and TCIN."
      };
    }

    if (retailer.includes("walmart")) {
      const productId = urlProductIdFromWalmart(parsed.pathname);
      const searchOrCategory = hasSearchQuery || path.startsWith("/search") || path.startsWith("/browse") || path.startsWith("/cp") || genericPath;
      return {
        exactProductUrl: hostMatches(parsed, "walmart.com") && path.includes("/ip/") && Boolean(productId),
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory ? "Walmart search/category URL detected." : "Walmart /ip/ product URL checked for item ID."
      };
    }

    if (retailer.includes("pokemon center")) {
      const productId = urlProductIdFromPokemonCenter(parsed.pathname);
      const searchOrCategory = hasSearchQuery || path.includes("/search") || path.includes("/category") || path === "/" || path.includes("/shop/");
      return {
        exactProductUrl: hostMatches(parsed, "pokemoncenter.com") && path.includes("/product/") && Boolean(productId),
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory ? "Pokemon Center homepage/category/search URL detected." : "Pokemon Center product URL checked."
      };
    }

    if (retailer.includes("best buy")) {
      const productId = urlProductIdFromBestBuy(parsed);
      const searchOrCategory = path.includes("/searchpage") || hasSearchQuery || genericPath;
      return {
        exactProductUrl: hostMatches(parsed, "bestbuy.com") && (path.includes("/site/") || path.includes("/product/")) && Boolean(productId),
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory ? "Best Buy search/category URL detected." : "Best Buy product URL checked for SKU."
      };
    }

    if (retailer.includes("gamestop")) {
      const productId = urlProductIdFromGameStop(parsed.pathname);
      const searchOrCategory = hasSearchQuery || path.includes("/search") || path.includes("/collection") || path.includes("/category");
      return {
        exactProductUrl: hostMatches(parsed, "gamestop.com") && Boolean(productId) && !searchOrCategory,
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory ? "GameStop search/category URL detected." : "GameStop product URL checked."
      };
    }

    if (retailer.includes("amazon")) {
      const productId = urlProductIdFromAmazon(parsed.pathname);
      const searchOrCategory = hasSearchQuery || path === "/s" || path.startsWith("/s/") || path.includes("/gp/browse") || genericPath;
      return {
        exactProductUrl: hostMatches(parsed, "amazon.com") && Boolean(productId),
        searchOrCategory,
        retailerProductIdFromUrl: productId,
        reason: searchOrCategory ? "Amazon search/category URL detected." : "Amazon product URL checked for ASIN."
      };
    }

    return {
      exactProductUrl: !genericPath && !hasSearchQuery,
      searchOrCategory: genericPath || hasSearchQuery,
      retailerProductIdFromUrl: null,
      reason: genericPath || hasSearchQuery ? "Search/category URL detected." : "Retailer product URL checked."
    };
  } catch {
    return {
      exactProductUrl: false,
      searchOrCategory: true,
      retailerProductIdFromUrl: null,
      reason: "Invalid product URL."
    };
  }
}

export function matchProductIdentity(input: {
  product: ProductIdentityInput;
  finalUrl: string;
  html: string;
  titleText: string;
  httpStatus?: number;
}): ProductIdentityMatch {
  const originalUrl = classifyRetailerProductUrl(input.product.url, input.product.retailerName);
  const finalUrl = classifyRetailerProductUrl(input.finalUrl, input.product.retailerName);
  const retailerLower = input.product.retailerName.toLowerCase();
  const searchOrCategory = originalUrl.searchOrCategory || finalUrl.searchOrCategory;
  const exactProductUrl = originalUrl.exactProductUrl && finalUrl.exactProductUrl;
  const retailerProductIdFromUrl = finalUrl.retailerProductIdFromUrl || originalUrl.retailerProductIdFromUrl;
  const titleSource = `${input.titleText} ${input.html.slice(0, 250000)}`;
  const keywords = titleKeywords(input.product);
  const matchedTitleKeywords = keywords.filter((keyword) => normalizedText(titleSource).includes(keyword));
  const explicitKeywords = splitList(input.product.expectedTitleKeywords).length > 0;
  const requiredTitleMatches = explicitKeywords ? keywords.length : Math.min(2, keywords.length);
  const titleMatched = keywords.length === 0 || matchedTitleKeywords.length >= requiredTitleMatches;
  const expectedIdentifiers = [
    input.product.upc,
    input.product.sku,
    input.product.dpci,
    input.product.retailerProductId
  ].filter((value): value is string => Boolean(value?.trim()));
  const bestBuyNeedsStoredSku =
    retailerLower.includes("best buy") && !input.product.sku?.trim() && !input.product.retailerProductId?.trim();
  const evidenceText = `${input.finalUrl} ${input.html.slice(0, 500000)}`;
  const matchedIdentifiers = expectedIdentifiers.filter((identifier) => {
    if (textIncludesIdentifier(evidenceText, identifier)) return true;
    if (!retailerProductIdFromUrl) return false;
    return compactIdentifier(identifier) === compactIdentifier(retailerProductIdFromUrl);
  });
  if (expectedIdentifiers.length === 0 && !bestBuyNeedsStoredSku && retailerProductIdFromUrl && exactProductUrl) {
    matchedIdentifiers.push(retailerProductIdFromUrl);
  }
  const missingIdentifiers = expectedIdentifiers.filter((identifier) => !matchedIdentifiers.includes(identifier));
  const urlIdConflict =
    Boolean(retailerProductIdFromUrl && input.product.retailerProductId) &&
    compactIdentifier(retailerProductIdFromUrl) !== compactIdentifier(input.product.retailerProductId) &&
    !matchedIdentifiers.some((identifier) => compactIdentifier(identifier) === compactIdentifier(retailerProductIdFromUrl));
  const productIdVerified =
    !bestBuyNeedsStoredSku &&
    Boolean(retailerProductIdFromUrl) &&
    !urlIdConflict &&
    (!input.product.retailerProductId ||
      compactIdentifier(input.product.retailerProductId) === compactIdentifier(retailerProductIdFromUrl) ||
      textIncludesIdentifier(evidenceText, input.product.retailerProductId));
  const needsIdentifiers = bestBuyNeedsStoredSku || (!productIdVerified && expectedIdentifiers.length === 0);
  const notFound = input.httpStatus === 404 || input.httpStatus === 410;

  let verificationStatus: ProductVerificationStatus = "VERIFIED_EXACT";
  if (searchOrCategory) verificationStatus = "SEARCH_OR_CATEGORY_LINK";
  else if (needsIdentifiers) verificationStatus = "NEEDS_IDENTIFIERS";
  else if (!exactProductUrl || notFound || urlIdConflict || !productIdVerified || !titleMatched || matchedIdentifiers.length === 0) {
    verificationStatus = "POSSIBLE_MISMATCH";
  }

  const readyForAlert = verificationStatus === "VERIFIED_EXACT";
  const notes = [
    searchOrCategory ? "Search link only — replace with exact product URL." : null,
    originalUrl.reason,
    finalUrl.reason,
    exactProductUrl ? "Exact retailer product URL shape matched." : "URL is not recognized as an exact product page.",
    bestBuyNeedsStoredSku
      ? "Best Buy tracker requires a stored SKU or retailer product ID before alerts are trusted."
      : needsIdentifiers
        ? "Needs UPC/SKU/DPCI/TCIN/item ID before alerts are trusted."
        : null,
    productIdVerified ? "Retailer product ID verified from exact product URL." : "Retailer product ID is not verified.",
    titleMatched
      ? `Title keywords matched: ${matchedTitleKeywords.join(", ") || "not required"}`
      : `Title keywords did not match: ${keywords.join(", ")}`,
    matchedIdentifiers.length ? `Identifier matched: ${matchedIdentifiers.join(", ")}` : "No stored UPC/SKU/DPCI/product ID matched the page.",
    missingIdentifiers.length ? `Not visible in page: ${missingIdentifiers.join(", ")}` : null,
    retailerProductIdFromUrl ? `Product ID from URL: ${retailerProductIdFromUrl}` : null,
    urlIdConflict ? "URL product ID conflicts with the stored product identifier." : null,
    notFound ? `HTTP ${input.httpStatus} means this is not a live exact product page.` : null,
    readyForAlert ? "Ready for Alert: exact product identity verified." : "Not ready for Buy alerts."
  ].filter((item): item is string => Boolean(item));

  return {
    verificationStatus,
    readyForAlert,
    actionUrl: readyForAlert ? input.finalUrl : null,
    exactProductUrl,
    searchOrCategory,
    possibleMismatch: verificationStatus === "POSSIBLE_MISMATCH",
    needsIdentifiers,
    productIdVerified,
    titleMatched,
    titleKeywords: keywords,
    matchedTitleKeywords,
    expectedIdentifiers,
    matchedIdentifiers,
    missingIdentifiers,
    retailerProductIdFromUrl,
    notes
  };
}

export function productReadyForBuyAlerts(product: {
  verificationStatus?: string | null;
  verifiedFinalUrl?: string | null;
  url?: string | null;
  retailerProductId?: string | null;
  liveTitle?: string | null;
  livePrice?: number | null;
  liveStockStatus?: string | null;
  liveImageUrl?: string | null;
  imageUrl?: string | null;
  liveConfidenceScore?: number | null;
  liveBlockedType?: string | null;
}) {
  const exactIdentity = product.verificationStatus === "VERIFIED_EXACT" || product.verificationStatus === "UPC_MATCHED";
  return (
    exactIdentity &&
    Boolean(product.verifiedFinalUrl || product.url) &&
    Boolean(product.retailerProductId) &&
    Boolean(product.liveTitle) &&
    product.livePrice !== null &&
    product.livePrice !== undefined &&
    Boolean(product.liveStockStatus) &&
    Boolean(product.liveImageUrl) &&
    !product.liveBlockedType &&
    (product.liveConfidenceScore ?? 0) >= 70
  );
}

export function exactProductActionUrl(product: {
  verificationStatus?: string | null;
  verifiedFinalUrl?: string | null;
  url?: string | null;
}) {
  return productReadyForBuyAlerts(product) ? product.verifiedFinalUrl || product.url || null : null;
}
