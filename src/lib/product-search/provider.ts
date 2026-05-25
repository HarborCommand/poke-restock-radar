import type { ProductSearchCandidate, ProductSearchConfig, ProductSearchFailure } from "@/lib/product-search/types";
import { normalizeUPC } from "@/lib/upc";

const PREFERRED_RETAILERS = [
  "target",
  "walmart",
  "gamestop",
  "best buy",
  "bestbuy",
  "pokemon center",
  "pokémon center",
  "amazon",
  "tcgplayer"
];

const PREFERRED_DOMAINS = [
  "target.com",
  "walmart.com",
  "gamestop.com",
  "bestbuy.com",
  "pokemoncenter.com",
  "amazon.com",
  "tcgplayer.com"
];

const REJECT_TITLE_PATTERNS = [
  /\bdigital\b/i,
  /\bproxy\b/i,
  /\bproxies\b/i,
  /\bjumbo\b/i,
  /\boversized\b/i,
  /\bposter\b/i,
  /\bcode card\b/i,
  /\blot of\b/i
];

export function productSearchConfig(): ProductSearchConfig {
  const provider = process.env.PRODUCT_SEARCH_PROVIDER?.trim().toLowerCase() || null;
  const apiUrl = process.env.PRODUCT_SEARCH_API_URL?.trim() || null;
  const apiKeyConfigured = Boolean(process.env.PRODUCT_SEARCH_API_KEY?.trim());
  return {
    provider,
    apiUrl,
    apiKeyConfigured,
    configured: Boolean(provider && apiUrl && apiKeyConfigured)
  };
}

export function productSearchFailure(
  source: string,
  reason: string,
  options: { configured?: boolean; statusCode?: number; detail?: string | null } = {}
): ProductSearchFailure {
  return {
    source,
    reason,
    configured: options.configured,
    statusCode: options.statusCode,
    detail: options.detail ? options.detail.slice(0, 240) : undefined
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function firstString(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function firstNumber(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function buildProviderUrl(baseUrl: string, upc: string, options: { apiKey?: string | null; defaults?: Record<string, string> } = {}) {
  const apiKey = options.apiKey || "";
  let rawUrl = baseUrl.replaceAll("{upc}", encodeURIComponent(upc)).replaceAll("{query}", encodeURIComponent(upc));
  rawUrl = rawUrl.replaceAll("{apiKey}", encodeURIComponent(apiKey)).replaceAll("{api_key}", encodeURIComponent(apiKey));
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(options.defaults || {})) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  if (!url.searchParams.has("q") && !url.searchParams.has("query") && !baseUrl.includes("{upc}") && !baseUrl.includes("{query}")) {
    url.searchParams.set("q", upc);
  }
  if (apiKey && !url.searchParams.has("api_key") && !url.searchParams.has("apiKey") && !baseUrl.includes("{apiKey}") && !baseUrl.includes("{api_key}")) {
    url.searchParams.set("api_key", apiKey);
  }
  return url;
}

export async function fetchProviderJson(url: URL, apiKey?: string | null) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(14000)
  });
  if (!response.ok) {
    const error = new Error(`Product search provider returned ${response.status}.`) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

export function errorStatusCode(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

export function nestedRecordArray(record: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => recordArray(record[key]));
}

export function rootCandidateRecords(payload: unknown) {
  if (!isRecord(payload)) return [];
  const direct = [
    payload.product,
    payload.item,
    payload.result,
    payload.data
  ].filter(isRecord);
  const arrays = nestedRecordArray(payload, [
    "products",
    "items",
    "results",
    "data",
    "shopping_results",
    "inline_shopping_results",
    "organic_results"
  ]);
  return [...arrays, ...direct, payload];
}

export function inferRetailerFromUrl(productUrl?: string | null) {
  if (!productUrl) return null;
  try {
    const hostname = new URL(productUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname.includes("target.com")) return "Target";
    if (hostname.includes("walmart.com")) return "Walmart";
    if (hostname.includes("gamestop.com")) return "GameStop";
    if (hostname.includes("bestbuy.com")) return "Best Buy";
    if (hostname.includes("pokemoncenter.com")) return "Pokemon Center";
    if (hostname.includes("amazon.com")) return "Amazon";
    if (hostname.includes("tcgplayer.com")) return "TCGplayer";
    return hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function inferCategoryFromSearchText(...values: Array<string | null | undefined>) {
  const normalized = values.filter(Boolean).join(" ").toLowerCase();
  if (normalized.includes("elite trainer") || normalized.includes(" etb")) return "etbs";
  if (normalized.includes("booster bundle")) return "booster_bundles";
  if (normalized.includes("booster box")) return "booster_boxes";
  if (normalized.includes("sleeved booster") || normalized.includes("blister")) return "sleeved_boosters";
  if (normalized.includes("premium collection") || normalized.includes("collection")) return "collection_boxes";
  if (normalized.includes("mini tin") || normalized.includes(" tin")) return "sealed_packs";
  if (normalized.includes("pokemon") || normalized.includes("pokémon") || normalized.includes("tcg") || normalized.includes("trading card")) return "sealed_packs";
  return null;
}

export function extractSkuFromUrl(productUrl?: string | null) {
  if (!productUrl) return null;
  const bestBuySku = productUrl.match(/\/(\d{6,})(?:[/?#]|$)/);
  const walmartItem = productUrl.match(/\/ip\/(?:[^/]+\/)?(\d{6,})(?:[/?#]|$)/i);
  const amazonAsin = productUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (walmartItem?.[1]) return walmartItem[1];
  if (amazonAsin?.[1]) return amazonAsin[1].toUpperCase();
  if (bestBuySku?.[1]) return bestBuySku[1];
  return null;
}

export function extractTcinFromUrl(productUrl?: string | null) {
  if (!productUrl) return null;
  const match = productUrl.match(/\/A-(\d{6,12})(?:[/?#]|$)/i);
  return match?.[1] ?? null;
}

export function candidateQuality(upc: string, candidate: Omit<ProductSearchCandidate, "confidence"> & { confidence?: number | null }) {
  const title = candidate.title || "";
  const lowerTitle = title.toLowerCase();
  const productUrl = candidate.productUrl || "";
  const lowerUrl = productUrl.toLowerCase();
  const retailer = (candidate.retailer || inferRetailerFromUrl(productUrl) || "").toLowerCase();
  const explicitUpc = normalizeUPC(candidate.upc);
  const exactUpc = explicitUpc && explicitUpc === upc;
  const productSignals = /pokemon|pokémon|tcg|trading card|scarlet|violet|mega evolution|elite trainer|booster|collection|tin/.test(lowerTitle);
  const rejected = REJECT_TITLE_PATTERNS.some((pattern) => pattern.test(title));
  const preferredRetailer = PREFERRED_RETAILERS.some((name) => retailer.includes(name)) || PREFERRED_DOMAINS.some((domain) => lowerUrl.includes(domain));
  let confidence = Math.max(0, Math.min(100, candidate.confidence ?? 0));
  if (title) confidence += 10;
  if (candidate.imageUrl) confidence += 5;
  if (productUrl) confidence += 5;
  if (preferredRetailer) confidence += 15;
  if (productSignals) confidence += 25;
  if (productSignals && preferredRetailer) confidence += 10;
  if (exactUpc) confidence += 40;
  if (lowerTitle.includes(upc) || lowerUrl.includes(upc)) confidence += 25;
  if (candidate.price !== null && candidate.price !== undefined) confidence += 4;
  if (rejected) confidence -= 45;
  if (!productSignals && !exactUpc && !lowerTitle.includes(upc) && !preferredRetailer) confidence -= 30;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

export function normalizeSearchCandidate(upc: string, candidate: Omit<ProductSearchCandidate, "confidence"> & { confidence?: number | null }) {
  const normalized: ProductSearchCandidate = {
    ...candidate,
    title: candidate.title.trim(),
    brand: candidate.brand || (/pok[eé]mon/i.test(candidate.title) ? "Pokemon" : null),
    category: candidate.category || inferCategoryFromSearchText(candidate.title),
    imageUrl: candidate.imageUrl || null,
    retailer: candidate.retailer || inferRetailerFromUrl(candidate.productUrl) || null,
    productUrl: candidate.productUrl || null,
    price: candidate.price ?? null,
    sku: candidate.sku || extractSkuFromUrl(candidate.productUrl) || null,
    tcin: candidate.tcin || extractTcinFromUrl(candidate.productUrl) || null,
    upc: candidate.upc || null,
    source: candidate.source,
    confidence: 0
  };
  normalized.confidence = candidateQuality(upc, normalized);
  return normalized;
}

export function rankSearchCandidates(upc: string, candidates: Array<Omit<ProductSearchCandidate, "confidence"> & { confidence?: number | null }>) {
  return candidates
    .filter((candidate) => candidate.title?.trim())
    .map((candidate) => normalizeSearchCandidate(upc, candidate))
    .filter((candidate) => candidate.confidence >= 35)
    .sort((a, b) => b.confidence - a.confidence);
}
