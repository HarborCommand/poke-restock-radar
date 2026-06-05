import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { classifyRetailerProductUrl } from "@/lib/product-identity";
import { detectRetailerAvailability, detectRetailerPrice } from "@/lib/retailer-page-signals";

type DiscoveryMode = "due" | "all";

const DISCOVERY_USER_AGENT = "PokeRestockRadar/0.3 private-safe-discovery (+review-before-watch)";
export const TARGET_DISCOVERY_SEARCH_TERMS = [
  "Pokemon trading cards",
  "Pokemon TCG",
  "Pokemon booster bundle",
  "Pokemon elite trainer box",
  "Pokemon ETB",
  "Pokemon sleeved booster",
  "Pokemon booster pack",
  "Pokemon premium collection",
  "Pokemon collection box",
  "Pokemon tin",
  "Pokemon mini tin",
  "Pokemon blister",
  "Pokemon checklane blister",
  "Pokemon 3 pack blister",
  "Pokemon booster box",
  "Mega Evolution Pokemon cards",
  "Chaos Rising Pokemon",
  "Perfect Order Pokemon",
  "Ascended Heroes Pokemon"
];

export const TARGET_TCG_ALLOWED_KEYWORDS = [
  "trading card game",
  "tcg",
  "booster",
  "booster bundle",
  "booster box",
  "elite trainer box",
  "etb",
  "sleeved booster",
  "blister",
  "checklane",
  "3-pack",
  "3 pack",
  "premium collection",
  "collection box",
  "tin",
  "mini tin",
  "deck",
  "build & battle",
  "build and battle",
  "card",
  "pack",
  "bundle",
  "collection"
];

export const TARGET_NON_TCG_EXCLUDE_KEYWORDS = [
  "clothing",
  "shirt",
  "hoodie",
  "pants",
  "socks",
  "costume",
  "plush",
  "toy figure",
  "figure",
  "bedding",
  "backpack",
  "lunch box",
  "book",
  "video game",
  "switch game",
  "toy",
  "lego",
  "party supplies",
  "shoes",
  "hat",
  "mug",
  "blanket",
  "pillow",
  "pajamas",
  "ornament"
];

type DiscoveryCandidateRecord = {
  url: string;
  label: string;
  retailerProductId: string | null;
  sku?: string | null;
  upc?: string | null;
  dpci?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  itemDetails?: string | null;
  imageUrl?: string | null;
  livePrice?: number | null;
  productType?: string | null;
  stockStatus?: string | null;
  enrichmentStatus?: "ENRICHED" | "PARTIAL" | "BLOCKED" | "NEEDS_REVIEW";
  enrichmentReason?: string | null;
  enrichedAt?: Date | null;
  confidenceScore?: number;
  reason?: string;
  status?: "PENDING" | "REJECTED_NON_TCG";
};

type TargetSearchConfig = {
  apiKey: string;
  baseUrl: string;
  plpSearchPath: string;
  storeId: string;
  storeIds: string;
};

export type TargetTcgCandidateEvaluation = {
  included: boolean;
  confidenceScore: number;
  productType: string | null;
  matchedKeywords: string[];
  excludedKeywords: string[];
  reason: string;
};

export type TargetDiscoveryPreviewCandidate = {
  url: string;
  productName: string;
  productType: string | null;
  retailerProductId: string | null;
  sku: string | null;
  upc: string | null;
  dpci: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  itemDetails: string | null;
  imageUrl: string | null;
  livePrice: number | null;
  stockStatus: string | null;
  enrichmentStatus: "ENRICHED" | "PARTIAL" | "BLOCKED" | "NEEDS_REVIEW";
  enrichmentReason: string | null;
  confidenceScore: number;
  status: "PENDING" | "REJECTED_NON_TCG";
  reason: string;
};

export type TargetDiscoveryDebugResult = {
  sourceUrl: string;
  httpStatus: number;
  finalUrl: string;
  responseLength: number;
  blocked: boolean;
  blockedReason: string | null;
  productLinksFound: number;
  candidatesCreatedCount: number;
  candidatesRejectedCount: number;
  zeroCandidateReason: string | null;
  candidates: TargetDiscoveryPreviewCandidate[];
  rejected: TargetDiscoveryPreviewCandidate[];
};
const productTerms = [
  "pokemon",
  "pokémon",
  "tcg",
  "trading card",
  "elite trainer",
  "etb",
  "booster",
  "bundle",
  "box",
  "collection",
  "tin",
  "sleeved"
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDelayMs() {
  const configured = Number(process.env.MONITOR_REQUEST_DELAY_MS || 1500);
  if (!Number.isFinite(configured)) return 1500;
  return Math.max(500, configured);
}

function nextCheckAt(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function hashPage(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeSpace(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiscoveryText(value: string) {
  return normalizeSpace(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function targetDiscoverySourceUrl(searchTerm: string) {
  const url = new URL("https://www.target.com/s");
  url.searchParams.set("searchTerm", searchTerm);
  return url.toString();
}

function parseTargetMoney(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\$?\s?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function firstJsonishString(input: string, keys: string[]) {
  for (const key of keys) {
    const pattern = new RegExp(`["']${key}["']\\s*:\\s*["']([^"']{2,260})["']`, "i");
    const match = input.match(pattern);
    if (match?.[1]) return normalizeSpace(match[1]);
  }
  return null;
}

function firstJsonishNumber(input: string, keys: string[]) {
  for (const key of keys) {
    const pattern = new RegExp(`["']${key}["']\\s*:\\s*(?:["']\\$?)?(\\d{1,4}(?:\\.\\d{1,2})?)(?:["'])?`, "i");
    const match = input.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function decodeTargetSearchPayload(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u002D/gi, "-")
    .replace(/\\u003A/gi, ":")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function canonicalTargetProductUrl(value: string, baseUrl: string) {
  const decoded = decodeHtmlAttribute(decodeTargetSearchPayload(value));
  const productMatch = decoded.match(/(?:https?:\/\/(?:www\.)?target\.com)?(\/p\/(?:-\/A-\d{5,}|[^"'<>\s\\]*?\/-\/A-\d{5,}))(?:[?#][^"'<>\s\\]*)?/i);
  if (!productMatch?.[1]) return null;
  const url = absoluteUrl(productMatch[1], baseUrl);
  if (!url) return null;
  const parsed = new URL(url);
  parsed.hostname = "www.target.com";
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function targetTcinFromUrl(url: string) {
  return url.match(/\/A-(\d{5,})/i)?.[1] ?? null;
}

function targetCandidateContext(html: string, candidateUrl: string, retailerProductId: string | null) {
  const searchHtml = decodeTargetSearchPayload(html);
  const decodedUrl = candidateUrl.replace(/https?:\/\//i, "").replace(/^www\./, "");
  const candidatePath = (() => {
    try {
      return new URL(candidateUrl).pathname;
    } catch {
      return "";
    }
  })();
  const needles = [
    candidateUrl,
    candidateUrl.replace(/\//g, "\\/"),
    decodedUrl,
    candidatePath,
    retailerProductId ? `A-${retailerProductId}` : "",
    retailerProductId ? `"tcin":"${retailerProductId}"` : "",
    retailerProductId ? `"tcin":${retailerProductId}` : ""
  ].filter(Boolean);
  const index = needles.map((needle) => searchHtml.indexOf(needle)).find((value) => value >= 0) ?? -1;
  if (index < 0) return "";
  return searchHtml.slice(Math.max(0, index - 6500), Math.min(searchHtml.length, index + 8500));
}

function targetMetadataFromContext(html: string, candidate: DiscoveryCandidateRecord) {
  const context = targetCandidateContext(html, candidate.url, candidate.retailerProductId);
  if (!context) return {};
  const title =
    firstJsonishString(context, ["title", "product_title", "item_title", "display_name", "name"]) ||
    candidate.label;
  const imageUrl =
    firstJsonishString(context, ["primary_image_url", "image_url", "imageUrl", "image", "base_url"]) ||
    context.match(/(?:https?:)?\/\/target\.scene7\.com\/is\/image\/Target\/[^"',\s<\\]+/i)?.[0] ||
    null;
  const price =
    firstJsonishNumber(context, ["current_retail", "formatted_current_price", "price", "currentPrice"]) ??
    parseTargetMoney(firstJsonishString(context, ["formatted_current_price", "current_retail", "price", "currentPrice"]));
  const dpci = firstJsonishString(context, ["dpci", "department_class_item"]);
  const upc = firstJsonishString(context, ["upc", "primary_barcode", "barcode"]);
  const brand = firstJsonishString(context, ["brand", "brand_name", "primary_brand", "manufacturer"]);
  const category = firstJsonishString(context, ["category", "category_name", "item_type", "product_type", "class_name"]);
  const description = firstJsonishString(context, ["description", "long_description", "soft_bullets", "bullet_description"]);
  const itemDetails = firstJsonishString(context, ["item_details", "details", "specifications", "bullet_descriptions"]);

  return {
    title,
    imageUrl: imageUrl ? decodeHtmlAttribute(imageUrl).replace(/\\\//g, "/").replace(/^\/\//, "https://") : null,
    price,
    dpci,
    upc,
    brand,
    category,
    description,
    itemDetails
  };
}

function normalizeIdentifier(value: string | null | undefined) {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function normalizedBarcode(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function targetEnrichmentStatus(candidate: DiscoveryCandidateRecord) {
  if (candidate.enrichmentStatus === "BLOCKED") return "BLOCKED";
  const exactUrl = Boolean(canonicalTargetProductUrl(candidate.url, candidate.url));
  const requiredComplete = exactUrl && Boolean(candidate.label) && Boolean(candidate.retailerProductId) && Boolean(candidate.imageUrl);
  if (!requiredComplete) return "NEEDS_REVIEW";
  const hasRecommended = Boolean(candidate.livePrice !== null && candidate.livePrice !== undefined) && Boolean(candidate.productType);
  const hasStrongIdentifier = Boolean(candidate.upc || candidate.dpci);
  return hasRecommended && hasStrongIdentifier ? "ENRICHED" : "PARTIAL";
}

function targetEnrichmentReason(candidate: DiscoveryCandidateRecord) {
  const missing: string[] = [];
  if (!canonicalTargetProductUrl(candidate.url, candidate.url)) missing.push("exact Target /p/ URL");
  if (!candidate.label) missing.push("title");
  if (!candidate.retailerProductId) missing.push("TCIN");
  if (!candidate.imageUrl) missing.push("image");
  if (!candidate.upc) missing.push("UPC");
  if (!candidate.dpci) missing.push("DPCI");
  if (candidate.livePrice === null || candidate.livePrice === undefined) missing.push("price");
  if (!candidate.productType) missing.push("product type");
  return missing.length
    ? `Missing ${missing.join(", ")}. UPC/DPCI are not fabricated when Target does not expose them publicly.`
    : "Public Target product data filled required and recommended candidate fields.";
}

export function evaluateTargetPokemonTcgCandidate(name: string, url: string): TargetTcgCandidateEvaluation {
  const text = normalizeDiscoveryText(`${name} ${url}`);
  const hasPokemon = text.includes("pokemon");
  const matchedKeywords = TARGET_TCG_ALLOWED_KEYWORDS.filter((keyword) => text.includes(normalizeDiscoveryText(keyword)));
  const excludedKeywords = TARGET_NON_TCG_EXCLUDE_KEYWORDS.filter((keyword) => text.includes(normalizeDiscoveryText(keyword)));
  const strongType = productTypeFromText(name) || productTypeFromText(url);
  const included = hasPokemon && matchedKeywords.length > 0 && excludedKeywords.length === 0;
  const confidenceScore = included
    ? Math.min(95, 60 + matchedKeywords.length * 5 + (strongType ? 8 : 0))
    : excludedKeywords.length
      ? 15
      : hasPokemon
        ? 35
        : 10;

  const reason = included
    ? `Target Pokemon TCG candidate matched ${matchedKeywords.slice(0, 5).join(", ")}. Search/category pages are discovery-only; approval still requires an exact /p/ URL.`
    : excludedKeywords.length
      ? `Rejected as non-TCG Target Pokemon result because it matched excluded terms: ${excludedKeywords.slice(0, 5).join(", ")}.`
      : hasPokemon
        ? "Rejected because it did not include enough Pokemon TCG product keywords."
        : "Rejected because it is not a Pokemon product.";

  return {
    included,
    confidenceScore,
    productType: strongType,
    matchedKeywords,
    excludedKeywords,
    reason
  };
}

function hostForRetailer(retailerName: string) {
  const retailer = retailerName.toLowerCase();
  if (retailer.includes("pokemon center")) return "pokemoncenter.com";
  if (retailer.includes("target")) return "target.com";
  if (retailer.includes("walmart")) return "walmart.com";
  if (retailer.includes("best buy")) return "bestbuy.com";
  if (retailer.includes("gamestop")) return "gamestop.com";
  if (retailer.includes("amazon")) return "amazon.com";
  return null;
}

function retailerHostMatches(url: string, retailerName: string) {
  const host = hostForRetailer(retailerName);
  if (!host) return true;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase().endsWith(host);
  } catch {
    return false;
  }
}

export function validateDiscoverySourceUrl(retailerName: string, url: string) {
  if (!retailerHostMatches(url, retailerName)) {
    throw new Error(`${retailerName} discovery URL must be on the retailer's public website.`);
  }
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    const parsed = new URL(value.replaceAll("\\/", "/"), baseUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function candidateNameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const slug =
      parts.find((part) => part.length > 8 && !/^(dp|ip|site|product|products|gp|A-\d+)/i.test(part)) ||
      parts[parts.length - 2] ||
      parts[parts.length - 1] ||
      "Pokemon TCG product";
    return normalizeSpace(slug.replace(/[-_]+/g, " ")).slice(0, 120) || "Pokemon TCG product";
  } catch {
    return "Pokemon TCG product";
  }
}

function productTypeFromText(value: string | null | undefined) {
  const text = normalizeDiscoveryText(value || "");
  if (!text) return null;
  if (text.includes("elite trainer") || /\betb\b/.test(text)) return "ETB";
  if (text.includes("premium checklane")) return "Premium Checklane Blister";
  if (text.includes("checklane")) return "Checklane Blister";
  if (text.includes("3 pack") || text.includes("3-pack") || text.includes("three booster") || text.includes("three-booster")) return "3-Pack Blister";
  if (text.includes("sleeved booster")) return "Sleeved Booster";
  if (text.includes("booster bundle")) return "Booster Bundle";
  if (text.includes("booster box") || text.includes("booster display")) return "Booster Box";
  if (text.includes("booster pack") || text.includes("single booster") || text.includes("card pack")) return "Booster Pack";
  if (text.includes("premium collection")) return "Premium Collection";
  if (text.includes("collection box")) return "Collection Box";
  if (text.includes("mini tin")) return "Mini Tin";
  if (text.includes("tin")) return "Tin";
  if (text.includes("deck")) return "Deck";
  if (text.includes("build") && text.includes("battle")) return "Build & Battle Box";
  if (text.includes("collection")) return "Collection Box";
  return null;
}

function looksLikePokemonProduct(name: string, url: string) {
  const text = `${name} ${url}`.toLowerCase();
  return productTerms.some((term) => text.includes(term));
}

function extractLinks(html: string, finalUrl: string) {
  const links: Array<{ url: string; label: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    const url = absoluteUrl(match[1], finalUrl);
    if (!url) continue;
    links.push({ url, label: normalizeSpace(match[2]) });
  }

  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>)]+/gi)) {
    const url = absoluteUrl(match[0], finalUrl);
    if (!url) continue;
    links.push({ url, label: "" });
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function extractTargetProductCandidates(html: string, finalUrl: string) {
  const candidates = new Map<string, DiscoveryCandidateRecord>();
  const decodedHtml = decodeTargetSearchPayload(html);

  function addCandidate(rawUrl: string, label = "") {
    const url = canonicalTargetProductUrl(rawUrl, finalUrl);
    if (!url) return;
    const retailerProductId = targetTcinFromUrl(url);
    if (!retailerProductId) return;
    const key = retailerProductId || url;
    const existing = candidates.get(key);
    if (existing) {
      if (existing.url.includes("/p/-/A-") && !url.includes("/p/-/A-")) existing.url = url;
      if (!existing.label && label) existing.label = normalizeSpace(label);
      return;
    }
    candidates.set(key, {
      url,
      label: normalizeSpace(label),
      retailerProductId
    });
  }

  for (const link of extractLinks(decodedHtml, finalUrl)) {
    addCandidate(link.url, link.label);
  }

  for (const match of decodedHtml.matchAll(/(?:https?:\/\/(?:www\.)?target\.com)?\/p\/(?:-\/A-\d{5,}|[^"'<>\s\\]*?\/-\/A-\d{5,})(?:[?#][^"'<>\s\\]*)?/gi)) {
    addCandidate(match[0]);
  }

  for (const match of decodedHtml.matchAll(/["'](?:url|canonical_url|product_url|pdp_url|buy_url|link|href)["']\s*:\s*["']([^"']*\/p\/(?:-\/A-\d{5,}|[^"']*?\/-\/A-\d{5,})[^"']*)["']/gi)) {
    addCandidate(match[1]);
  }

  for (const match of decodedHtml.matchAll(/\b(?:tcin|product_id|productId)["']?\s*[:=]\s*["']?(\d{5,})["']?/gi)) {
    const tcin = match[1];
    addCandidate(`/p/-/A-${tcin}`);
  }

  return Array.from(candidates.values()).map((candidate) => {
    const metadata = targetMetadataFromContext(decodedHtml, candidate);
    const title = metadata.title || candidate.label || candidateNameFromUrl(candidate.url);
    const productType = productTypeFromText(`${title} ${metadata.category || ""} ${metadata.description || ""} ${metadata.itemDetails || ""}`);
    const enrichedCandidate: DiscoveryCandidateRecord = {
      ...candidate,
      label: title,
      imageUrl: metadata.imageUrl,
      livePrice: metadata.price ?? null,
      upc: normalizedBarcode(metadata.upc),
      dpci: normalizeIdentifier(metadata.dpci),
      brand: normalizeIdentifier(metadata.brand),
      category: normalizeIdentifier(metadata.category),
      description: normalizeIdentifier(metadata.description),
      itemDetails: normalizeIdentifier(metadata.itemDetails),
      productType
    };
    enrichedCandidate.enrichmentStatus = targetEnrichmentStatus(enrichedCandidate);
    enrichedCandidate.enrichmentReason = targetEnrichmentReason(enrichedCandidate);
    return {
      ...enrichedCandidate,
      reason: [
        enrichedCandidate.dpci ? `DPCI ${enrichedCandidate.dpci}` : null,
        enrichedCandidate.upc ? `UPC ${enrichedCandidate.upc}` : null,
        candidate.retailerProductId ? `TCIN ${candidate.retailerProductId}` : null
      ]
        .filter(Boolean)
        .join("; ")
    };
  });
}

function parseTargetJsonPayloads(html: string) {
  const payloads: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/JSON\.parse\("([\s\S]*?)"\)/g)) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`);
      if (typeof decoded !== "string") continue;
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payloads.push(parsed as Record<string, unknown>);
    } catch {
      // Target embeds several JSON.parse payloads; ignore ones that are not application config/data.
    }
  }
  return payloads;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pathJoin(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function targetSearchTermFromUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return (
      url.searchParams.get("searchTerm") ||
      url.searchParams.get("keyword") ||
      url.searchParams.get("q") ||
      decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "")
    );
  } catch {
    return "";
  }
}

function targetSearchPageParam(searchTerm: string) {
  const slug = searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `/s/${slug || "pokemon tcg"}`;
}

function targetSearchConfigFromHtml(html: string): TargetSearchConfig | null {
  let apiKey: string | null = null;
  let baseUrl: string | null = null;
  let plpSearchPath: string | null = null;
  let storeId: string | null = null;
  let storeIds: string | null = null;

  for (const payload of parseTargetJsonPayloads(html)) {
    const services = recordValue(payload.services);
    const redsky = recordValue(services?.redsky);
    const redskyAggregations = recordValue(services?.redskyAggregations);
    const redskyAggregationsApis = recordValue(redskyAggregations?.apis);
    const productApi = recordValue(redskyAggregationsApis?.product);
    const productPaths = recordValue(productApi?.endpointPaths);
    const configPath = stringValue(productPaths?.plpSearchV2);
    if (configPath) plpSearchPath = configPath;
    apiKey = apiKey || stringValue(redsky?.apiKey) || stringValue(payload.defaultServicesApiKey);
    baseUrl = baseUrl || stringValue(redsky?.baseUrl) || stringValue(redskyAggregations?.baseUrl);

    const serverLocation = recordValue(payload.serverLocationVariables);
    const primaryStore = recordValue(serverLocation?.primaryStore);
    storeId = storeId || stringValue(serverLocation?.store_id) || stringValue(primaryStore?.id);
    storeIds = storeIds || stringValue(serverLocation?.store_ids) || storeId;
  }

  if (!apiKey || !plpSearchPath) return null;
  return {
    apiKey,
    baseUrl: baseUrl || "https://redsky.target.com",
    plpSearchPath,
    storeId: storeId || "2848",
    storeIds: storeIds || storeId || "2848"
  };
}

function targetCandidateFromSearchProduct(product: Record<string, unknown>, finalUrl: string): DiscoveryCandidateRecord | null {
  const item = recordValue(product.item);
  const enrichment = recordValue(item?.enrichment);
  const imageInfo = recordValue(enrichment?.image_info);
  const primaryImage = recordValue(imageInfo?.primary_image);
  const description = recordValue(item?.product_description);
  const brand = recordValue(item?.primary_brand);
  const classification = recordValue(item?.product_classification);
  const itemType = recordValue(classification?.item_type);
  const price = recordValue(product.price);
  const tcin = stringValue(product.tcin) || stringValue(product.original_tcin);
  const buyUrl = stringValue(enrichment?.buy_url) || (tcin ? `https://www.target.com/p/-/A-${tcin}` : null);
  const url = buyUrl ? canonicalTargetProductUrl(buyUrl, finalUrl) : null;
  if (!tcin || !url) return null;

  const title = stringValue(description?.title) || stringValue(product.title) || candidateNameFromUrl(url);
  const imageUrl = stringValue(primaryImage?.url) || stringValue(imageInfo?.base_url);
  const itemTypeName = stringValue(itemType?.name);
  const brandName = stringValue(brand?.name);
  const currentPrice = numberValue(price?.current_retail) ?? numberValue(price?.formatted_current_price);
  const bullets = [
    stringValue(description?.downstream_description),
    stringValue(description?.soft_bullets),
    stringValue(description?.bullet_description)
  ]
    .filter(Boolean)
    .join(" ");
  const candidate: DiscoveryCandidateRecord = {
    url,
    label: normalizeSpace(title),
    retailerProductId: tcin,
    brand: brandName,
    category: itemTypeName,
    description: bullets || null,
    itemDetails: itemTypeName,
    imageUrl: imageUrl?.replace(/^\/\//, "https://") ?? null,
    livePrice: currentPrice,
    productType: productTypeFromText(`${title} ${itemTypeName || ""} ${bullets}`) || (itemTypeName && /trading card/i.test(itemTypeName) ? "Other TCG" : null),
    reason: [
      "Target public search API",
      `TCIN ${tcin}`,
      brandName ? `brand ${brandName}` : null,
      itemTypeName ? `type ${itemTypeName}` : null
    ]
      .filter(Boolean)
      .join("; ")
  };
  candidate.enrichmentStatus = targetEnrichmentStatus(candidate);
  candidate.enrichmentReason = targetEnrichmentReason(candidate);
  return candidate;
}

async function fetchTargetSearchCandidates(input: {
  html: string;
  sourceUrl: string;
  finalUrl: string;
  userAgent: string;
}) {
  const config = targetSearchConfigFromHtml(input.html);
  const searchTerm = targetSearchTermFromUrl(input.sourceUrl);
  if (!config || !searchTerm) return { candidates: [] as DiscoveryCandidateRecord[], reason: "Target public search API config or search term missing" };

  const params = new URLSearchParams({
    key: config.apiKey,
    keyword: searchTerm,
    channel: "WEB",
    count: "24",
    offset: "0",
    default_purchasability_filter: "true",
    pricing_store_id: config.storeId,
    scheduled_delivery_store_id: config.storeId,
    store_ids: config.storeIds,
    visitor_id: "018F000000000201A9A0000000000000",
    page: targetSearchPageParam(searchTerm)
  });
  const url = `${pathJoin(config.baseUrl, config.plpSearchPath)}?${params}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
      Origin: "https://www.target.com",
      Referer: input.sourceUrl,
      "User-Agent": input.userAgent
    }
  });
  if (!response.ok) {
    return { candidates: [] as DiscoveryCandidateRecord[], reason: `Target public search API returned HTTP ${response.status}` };
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const data = recordValue(payload?.data);
  const search = recordValue(data?.search);
  const products = Array.isArray(search?.products) ? (search.products as Record<string, unknown>[]) : [];
  return {
    candidates: products.flatMap((product) => {
      const candidate = targetCandidateFromSearchProduct(product, input.finalUrl);
      return candidate ? [candidate] : [];
    }),
    reason: products.length ? `Target public search API returned ${products.length} products` : "Target public search API returned zero products"
  };
}

function sourceItselfCandidate(sourceUrl: string, finalUrl: string, retailerName: string) {
  const source = classifyRetailerProductUrl(sourceUrl, retailerName);
  const final = classifyRetailerProductUrl(finalUrl, retailerName);
  const exact = final.exactProductUrl ? final : source.exactProductUrl ? source : null;
  if (!exact) return null;
  return {
    url: final.exactProductUrl ? finalUrl : sourceUrl,
    label: candidateNameFromUrl(final.exactProductUrl ? finalUrl : sourceUrl),
    retailerProductId: exact.retailerProductIdFromUrl
  };
}

function enrichDiscoveryCandidate(
  candidate: DiscoveryCandidateRecord,
  html: string,
  retailerName: string,
  directCandidateUrl: string | null,
  availability: ReturnType<typeof detectRetailerAvailability>
): DiscoveryCandidateRecord {
  const isDirect = directCandidateUrl === candidate.url;
  if (!retailerName.toLowerCase().includes("target")) {
    return {
      ...candidate,
      productType: productTypeFromText(candidate.label),
      livePrice: isDirect ? detectRetailerPrice(html, retailerName) : null,
      confidenceScore: isDirect ? Math.max(availability.confidenceScore, 60) : 55,
      reason: isDirect
        ? `Exact source URL found. ${availability.reason}`
        : "Found exact product link on a public discovery page. Admin review required before monitoring.",
      status: "PENDING"
    };
  }

  const metadata = targetMetadataFromContext(html, candidate);
  const productName = metadata.title || candidate.label || candidateNameFromUrl(candidate.url);
  const productType =
    productTypeFromText(`${productName} ${metadata.category || candidate.category || ""} ${metadata.description || candidate.description || ""} ${metadata.itemDetails || candidate.itemDetails || ""}`) ||
    candidate.productType ||
    null;
  const evaluation = evaluateTargetPokemonTcgCandidate(`${productName} ${productType || ""}`, candidate.url);
  const upc = normalizedBarcode(metadata.upc) || normalizedBarcode(candidate.upc);
  const dpci = normalizeIdentifier(metadata.dpci) || normalizeIdentifier(candidate.dpci);
  const enrichedCandidate: DiscoveryCandidateRecord = {
    ...candidate,
    label: productName,
    imageUrl: metadata.imageUrl ?? candidate.imageUrl,
    livePrice: metadata.price ?? candidate.livePrice ?? (isDirect ? detectRetailerPrice(html, retailerName) : null),
    upc,
    dpci,
    brand: normalizeIdentifier(metadata.brand) || normalizeIdentifier(candidate.brand),
    category: normalizeIdentifier(metadata.category) || normalizeIdentifier(candidate.category),
    description: normalizeIdentifier(metadata.description) || normalizeIdentifier(candidate.description),
    itemDetails: normalizeIdentifier(metadata.itemDetails) || normalizeIdentifier(candidate.itemDetails),
    productType,
    stockStatus: isDirect ? availability.status : candidate.stockStatus ?? null,
    confidenceScore: evaluation.confidenceScore,
    status: evaluation.included ? "PENDING" : "REJECTED_NON_TCG"
  };
  enrichedCandidate.enrichmentStatus = targetEnrichmentStatus(enrichedCandidate);
  enrichedCandidate.enrichmentReason = targetEnrichmentReason(enrichedCandidate);
  const targetMetadataReason = [
    enrichedCandidate.dpci ? `DPCI ${enrichedCandidate.dpci}` : null,
    enrichedCandidate.upc ? `UPC ${enrichedCandidate.upc}` : null,
    candidate.retailerProductId ? `TCIN ${candidate.retailerProductId}` : null,
    candidate.reason || null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ...enrichedCandidate,
    reason: targetMetadataReason ? `${evaluation.reason} ${targetMetadataReason}.` : evaluation.reason,
    enrichmentReason: enrichedCandidate.enrichmentReason
  };
}

function targetDiscoveryDebugResultFromRaw(input: {
  sourceUrl: string;
  finalUrl: string;
  httpStatus: number;
  html: string;
}, rawCandidates: DiscoveryCandidateRecord[], blocked: boolean, blockedReason: string | null, zeroRawReason: string | null): TargetDiscoveryDebugResult {
  const availability = detectRetailerAvailability(input.html, "Target");
  const evaluatedCandidates = rawCandidates.map((candidate) => enrichDiscoveryCandidate(candidate, input.html, "Target", null, availability));
  const candidates = evaluatedCandidates
    .filter((candidate) => (candidate.status ?? "PENDING") === "PENDING")
    .map((candidate): TargetDiscoveryPreviewCandidate => ({
      url: candidate.url,
      productName: candidate.label || candidateNameFromUrl(candidate.url),
      productType: candidate.productType ?? productTypeFromText(candidate.label),
      retailerProductId: candidate.retailerProductId,
      sku: candidate.sku ?? null,
      upc: candidate.upc ?? null,
      dpci: candidate.dpci ?? null,
      brand: candidate.brand ?? null,
      category: candidate.category ?? null,
      description: candidate.description ?? null,
      itemDetails: candidate.itemDetails ?? null,
      imageUrl: candidate.imageUrl ?? null,
      livePrice: candidate.livePrice ?? null,
      stockStatus: candidate.stockStatus ?? null,
      enrichmentStatus: candidate.enrichmentStatus ?? targetEnrichmentStatus(candidate),
      enrichmentReason: candidate.enrichmentReason ?? targetEnrichmentReason(candidate),
      confidenceScore: candidate.confidenceScore ?? 55,
      status: "PENDING",
      reason: candidate.reason ?? "Target Pokemon TCG candidate found."
    }));
  const rejected = evaluatedCandidates
    .filter((candidate) => candidate.status === "REJECTED_NON_TCG")
    .map((candidate): TargetDiscoveryPreviewCandidate => ({
      url: candidate.url,
      productName: candidate.label || candidateNameFromUrl(candidate.url),
      productType: candidate.productType ?? productTypeFromText(candidate.label),
      retailerProductId: candidate.retailerProductId,
      sku: candidate.sku ?? null,
      upc: candidate.upc ?? null,
      dpci: candidate.dpci ?? null,
      brand: candidate.brand ?? null,
      category: candidate.category ?? null,
      description: candidate.description ?? null,
      itemDetails: candidate.itemDetails ?? null,
      imageUrl: candidate.imageUrl ?? null,
      livePrice: candidate.livePrice ?? null,
      stockStatus: candidate.stockStatus ?? null,
      enrichmentStatus: candidate.enrichmentStatus ?? targetEnrichmentStatus(candidate),
      enrichmentReason: candidate.enrichmentReason ?? targetEnrichmentReason(candidate),
      confidenceScore: candidate.confidenceScore ?? 15,
      status: "REJECTED_NON_TCG",
      reason: candidate.reason ?? "Rejected as non-TCG Target result."
    }));
  const zeroCandidateReason = blocked
    ? `blocked: ${blockedReason || availability.reason}`
    : rawCandidates.length === 0
      ? zeroRawReason || "no product links found; Target search page may be empty, redirected, blocked, or structure changed"
      : candidates.length === 0
        ? "parsed links were all non-TCG or duplicate products"
        : null;

  return {
    sourceUrl: input.sourceUrl,
    httpStatus: input.httpStatus,
    finalUrl: input.finalUrl,
    responseLength: input.html.length,
    blocked,
    blockedReason: blocked ? availability.reason : null,
    productLinksFound: rawCandidates.length,
    candidatesCreatedCount: candidates.length,
    candidatesRejectedCount: rejected.length,
    zeroCandidateReason,
    candidates,
    rejected
  };
}

export function previewTargetDiscoveryHtml(input: {
  sourceUrl: string;
  finalUrl: string;
  httpStatus: number;
  html: string;
}): TargetDiscoveryDebugResult {
  const availability = detectRetailerAvailability(input.html, "Target");
  const blocked =
    [401, 403, 429, 503].includes(input.httpStatus) ||
    availability.detectedWords.some((word) => /blocked|captcha|robot|queue/i.test(word));
  const rawCandidates = blocked ? [] : extractTargetProductCandidates(input.html, input.finalUrl);
  return targetDiscoveryDebugResultFromRaw(
    input,
    rawCandidates,
    blocked,
    blocked ? availability.reason : null,
    "no product links found; Target search page may be empty, redirected, blocked, or structure changed"
  );
}

export async function previewTargetDiscoveryHtmlWithSearch(input: {
  sourceUrl: string;
  finalUrl: string;
  httpStatus: number;
  html: string;
  userAgent?: string;
}): Promise<TargetDiscoveryDebugResult> {
  const availability = detectRetailerAvailability(input.html, "Target");
  const blocked =
    [401, 403, 429, 503].includes(input.httpStatus) ||
    availability.detectedWords.some((word) => /blocked|captcha|robot|queue/i.test(word));
  const htmlCandidates = blocked ? [] : extractTargetProductCandidates(input.html, input.finalUrl);
  const searchResult =
    blocked || htmlCandidates.length > 0
      ? { candidates: [] as DiscoveryCandidateRecord[], reason: null as string | null }
      : await fetchTargetSearchCandidates({
          html: input.html,
          sourceUrl: input.sourceUrl,
          finalUrl: input.finalUrl,
          userAgent: input.userAgent || DISCOVERY_USER_AGENT
        });

  return targetDiscoveryDebugResultFromRaw(
    input,
    [...htmlCandidates, ...searchResult.candidates],
    blocked,
    blocked ? availability.reason : null,
    searchResult.reason || "no product links found; Target search page may be empty, redirected, blocked, or structure changed"
  );
}

export async function enrichTargetDiscoveryCandidateFromPage(candidateId: string) {
  const startedAt = new Date();
  const candidate = await prisma.productDiscoveryCandidate.findUnique({
    where: { id: candidateId },
    include: { retailer: { select: { name: true } }, source: { select: { name: true } } }
  });
  if (!candidate) throw new Error("Discovery candidate not found");
  if (!candidate.retailer.name.toLowerCase().includes("target")) {
    throw new Error("Only Target discovery candidates can be enriched by this action.");
  }

  const classification = classifyRetailerProductUrl(candidate.url, candidate.retailer.name);
  if (classification.searchOrCategory || !classification.exactProductUrl) {
    return prisma.productDiscoveryCandidate.update({
      where: { id: candidate.id },
      data: {
        enrichmentStatus: "NEEDS_REVIEW",
        enrichmentReason: `Exact Target /p/ product URL is required before enrichment. ${classification.reason}`,
        enrichedAt: new Date()
      }
    });
  }

  try {
    const requestStarted = Date.now();
    const response = await fetch(candidate.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": DISCOVERY_USER_AGENT
      }
    });
    const html = await response.text();
    const finalUrl = response.url || candidate.url;
    const availability = detectRetailerAvailability(html, "Target");
    const blocked =
      [401, 403, 429, 503].includes(response.status) ||
      availability.detectedWords.some((word) => /blocked|captcha|robot|queue/i.test(word));

    if (blocked) {
      await createMonitorLog({
        runType: "DISCOVERY_DUE",
        status: "BLOCKED",
        startedAt,
        httpStatus: response.status,
        finalUrl,
        responseTimeMs: Date.now() - requestStarted,
        detectedWords: availability.detectedWords,
        confidenceScore: availability.confidenceScore,
        reason: `Target candidate enrichment blocked for ${candidate.productName}: ${availability.reason}`,
        blockedType: availability.detectedWords.some((word) => /captcha|robot/i.test(word)) ? "CAPTCHA_ROBOT_PAGE" : "PAGE_BLOCKED",
        pageHash: hashPage(html)
      });
      return prisma.productDiscoveryCandidate.update({
        where: { id: candidate.id },
        data: {
          finalUrl,
          stockStatus: "BLOCKED",
          enrichmentStatus: "BLOCKED",
          enrichmentReason: availability.reason,
          enrichedAt: new Date()
        }
      });
    }

    if (!response.ok) throw new Error(`Target product page returned HTTP ${response.status}`);
    const record = enrichDiscoveryCandidate(
      {
        url: candidate.url,
        label: candidate.productName,
        retailerProductId: candidate.retailerProductId || targetTcinFromUrl(candidate.url),
        sku: candidate.sku,
        upc: candidate.upc,
        dpci: candidate.dpci,
        brand: candidate.brand,
        category: candidate.category,
        description: candidate.description,
        itemDetails: candidate.itemDetails,
        imageUrl: candidate.imageUrl,
        livePrice: candidate.livePrice,
        productType: candidate.productType,
        stockStatus: candidate.stockStatus,
        confidenceScore: candidate.confidenceScore,
        reason: candidate.reason ?? undefined
      },
      html,
      "Target",
      candidate.url,
      availability
    );
    const updateData = {
      finalUrl,
      productName: record.label || candidate.productName,
      productType: record.productType ?? candidate.productType,
      retailerProductId: record.retailerProductId || candidate.retailerProductId || targetTcinFromUrl(candidate.url),
      sku: record.sku ?? candidate.sku,
      upc: record.upc ?? candidate.upc,
      dpci: record.dpci ?? candidate.dpci,
      brand: record.brand ?? candidate.brand,
      category: record.category ?? candidate.category,
      description: record.description ?? candidate.description,
      itemDetails: record.itemDetails ?? candidate.itemDetails,
      imageUrl: record.imageUrl ?? candidate.imageUrl,
      livePrice: record.livePrice ?? candidate.livePrice,
      stockStatus: record.stockStatus ?? availability.status,
      confidenceScore: Math.max(record.confidenceScore ?? candidate.confidenceScore, candidate.confidenceScore),
      reason: record.reason || candidate.reason,
      enrichmentStatus: record.enrichmentStatus ?? targetEnrichmentStatus(record),
      enrichmentReason: record.enrichmentReason ?? targetEnrichmentReason(record),
      enrichedAt: new Date()
    };
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "SUCCESS",
      startedAt,
      httpStatus: response.status,
      finalUrl,
      responseTimeMs: Date.now() - requestStarted,
      detectedWords: [
        "candidate enrichment",
        updateData.enrichmentStatus,
        updateData.upc ? "UPC found" : "UPC missing",
        updateData.dpci ? "DPCI found" : "DPCI missing"
      ],
      confidenceScore: updateData.confidenceScore,
      reason: `Target candidate enrichment for ${updateData.productName}: ${updateData.enrichmentReason}`,
      pageHash: hashPage(html)
    });
    return prisma.productDiscoveryCandidate.update({
      where: { id: candidate.id },
      data: updateData
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Target candidate enrichment failed";
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "ERROR",
      startedAt,
      reason: `Target candidate enrichment failed for ${candidate.productName}`,
      error: message
    });
    return prisma.productDiscoveryCandidate.update({
      where: { id: candidate.id },
      data: {
        enrichmentStatus: "NEEDS_REVIEW",
        enrichmentReason: message,
        enrichedAt: new Date()
      }
    });
  }
}

async function createMonitorLog(input: {
  runType: string;
  status: string;
  startedAt: Date;
  changeSummary?: string;
  httpStatus?: number;
  finalUrl?: string;
  responseTimeMs?: number;
  detectedWords?: string[];
  confidenceScore?: number;
  reason?: string;
  blockedType?: string | null;
  pageHash?: string;
  error?: string;
}) {
  const finishedAt = new Date();
  return prisma.monitorLog.create({
    data: {
      runType: input.runType,
      status: input.status,
      changeSummary: input.changeSummary,
      httpStatus: input.httpStatus,
      finalUrl: input.finalUrl,
      responseTimeMs: input.responseTimeMs,
      detectedWords: input.detectedWords?.length ? input.detectedWords.join(", ") : undefined,
      confidenceScore: input.confidenceScore,
      reason: input.reason,
      blockedType: input.blockedType ?? undefined,
      pageHash: input.pageHash,
      startedAt: input.startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - input.startedAt.getTime(),
      error: input.error
    }
  });
}

export async function runProductDiscoveryCheck(sourceId: string, force = true) {
  const startedAt = new Date();
  const source = await prisma.productDiscoverySource.findUnique({
    where: { id: sourceId },
    include: { retailer: { select: { id: true, name: true } } }
  });
  if (!source) throw new Error("Discovery source not found");

  const now = new Date();
  if (!force && source.nextCheckAt && source.nextCheckAt > now) {
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "SKIPPED",
      startedAt,
      changeSummary: `Next discovery check is scheduled for ${source.nextCheckAt.toISOString()}.`
    });
    return { sourceId, sourceName: source.name, status: "SKIPPED", found: 0, created: 0 };
  }

  validateDiscoverySourceUrl(source.retailer.name, source.url);

  try {
    const requestStarted = Date.now();
    const response = await fetch(source.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": DISCOVERY_USER_AGENT
      }
    });
    const html = await response.text();
    const responseTimeMs = Date.now() - requestStarted;
    const finalUrl = response.url || source.url;
    const availability = detectRetailerAvailability(html, source.retailer.name);
    const blocked =
      [401, 403, 429, 503].includes(response.status) ||
      availability.detectedWords.some((word) => /blocked|captcha|robot/i.test(word));

    if (blocked) {
      await prisma.productDiscoverySource.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: now,
          nextCheckAt: nextCheckAt(source.checkFrequencyMinutes),
          lastResult: "Blocked",
          lastError: availability.reason
        }
      });
      await createMonitorLog({
        runType: "DISCOVERY_DUE",
        status: "BLOCKED",
        startedAt,
        httpStatus: response.status,
        finalUrl,
        responseTimeMs,
        detectedWords: availability.detectedWords,
        confidenceScore: availability.confidenceScore,
        reason: availability.reason,
        blockedType: availability.detectedWords.some((word) => /captcha|robot/i.test(word)) ? "CAPTCHA_ROBOT_PAGE" : "PAGE_BLOCKED",
        pageHash: hashPage(html)
      });
      return {
        sourceId,
        sourceName: source.name,
        status: "BLOCKED",
        found: 0,
        created: 0,
        rejected: 0,
        sourceUrl: source.url,
        httpStatus: response.status,
        finalUrl,
        responseLength: html.length,
        blocked: true,
        productLinksFound: 0,
        zeroCandidateReason: availability.reason
      };
    }

    if (!response.ok) throw new Error(`Discovery page returned HTTP ${response.status}`);

    const directCandidate = sourceItselfCandidate(source.url, finalUrl, source.retailer.name);
    const isTargetDiscovery = source.retailer.name.toLowerCase().includes("target");
    const targetHtmlCandidates = isTargetDiscovery ? extractTargetProductCandidates(html, finalUrl) : [];
    const targetSearchResult =
      isTargetDiscovery && targetHtmlCandidates.length === 0 && !directCandidate
        ? await fetchTargetSearchCandidates({
            html,
            sourceUrl: source.url,
            finalUrl,
            userAgent: DISCOVERY_USER_AGENT
          })
        : { candidates: [] as DiscoveryCandidateRecord[], reason: null as string | null };
    const rawCandidates: DiscoveryCandidateRecord[] = isTargetDiscovery
      ? [...(directCandidate ? [directCandidate] : []), ...targetHtmlCandidates, ...targetSearchResult.candidates]
      : [
          ...(directCandidate ? [directCandidate] : []),
          ...extractLinks(html, finalUrl).flatMap((link) => {
            const classification = classifyRetailerProductUrl(link.url, source.retailer.name);
            if (!classification.exactProductUrl || classification.searchOrCategory) return [];
            const label = link.label || candidateNameFromUrl(link.url);
            if (!looksLikePokemonProduct(label, link.url)) return [];
            return [{ ...link, label, retailerProductId: classification.retailerProductIdFromUrl }];
          })
        ];

    const candidates = rawCandidates
      .filter((candidate) => retailerHostMatches(candidate.url, source.retailer.name))
      .map((candidate) => enrichDiscoveryCandidate(candidate, html, source.retailer.name, directCandidate?.url ?? null, availability))
      .slice(0, 80);

    let created = 0;
    let updated = 0;
    let rejected = 0;
    let skippedExistingProducts = 0;
    for (const candidate of candidates) {
      const name = candidate.label || candidateNameFromUrl(candidate.url);
      const finalCandidateUrl = candidate.url;
      const existingProduct = await prisma.product.findFirst({
        where: {
          retailerId: source.retailerId,
          OR: [
            { url: finalCandidateUrl },
            ...(candidate.retailerProductId ? [{ retailerProductId: candidate.retailerProductId }] : [])
          ]
        },
        select: { id: true }
      });
      if (existingProduct) {
        skippedExistingProducts += 1;
        continue;
      }

      const existingCandidate = await prisma.productDiscoveryCandidate.findFirst({
        where: {
          retailerId: source.retailerId,
          OR: [
            { url: finalCandidateUrl },
            { finalUrl: finalCandidateUrl },
            ...(candidate.retailerProductId ? [{ retailerProductId: candidate.retailerProductId }] : [])
          ]
        },
        select: { id: true }
      });

      const data = {
        sourceId: source.id,
        retailerId: source.retailerId,
        url: finalCandidateUrl,
        finalUrl: finalCandidateUrl,
        productName: name,
        productType: candidate.productType ?? productTypeFromText(name),
        retailerProductId: candidate.retailerProductId,
        sku: candidate.sku ?? null,
        upc: candidate.upc ?? null,
        dpci: candidate.dpci ?? null,
        brand: candidate.brand ?? null,
        category: candidate.category ?? null,
        description: candidate.description ?? null,
        itemDetails: candidate.itemDetails ?? null,
        imageUrl: candidate.imageUrl,
        livePrice: candidate.livePrice ?? null,
        stockStatus: candidate.stockStatus ?? (directCandidate?.url === finalCandidateUrl ? availability.status : null),
        enrichmentStatus: candidate.enrichmentStatus ?? "NEEDS_REVIEW",
        enrichmentReason: candidate.enrichmentReason ?? null,
        enrichedAt: candidate.enrichmentStatus ? new Date() : null,
        confidenceScore: candidate.confidenceScore ?? 55,
        reason: candidate.reason ?? "Found exact product link on a public discovery page. Admin review required before monitoring.",
        status: candidate.status ?? "PENDING"
      };

      if (existingCandidate) {
        await prisma.productDiscoveryCandidate.update({ where: { id: existingCandidate.id }, data });
        updated += 1;
      } else {
        await prisma.productDiscoveryCandidate.create({ data });
        created += 1;
      }
      if ((candidate.status ?? "PENDING") === "REJECTED_NON_TCG") rejected += 1;
    }

    const pendingCount = candidates.filter((candidate) => (candidate.status ?? "PENDING") === "PENDING").length;
    const zeroCandidateReason =
      rawCandidates.length === 0
        ? targetSearchResult.reason || "no product links found; search page returned no exact product links or Target structure changed"
        : candidates.length === 0
          ? "parsed links were not usable for this retailer"
          : pendingCount === 0 && rejected > 0
            ? "parsed links were all non-TCG products"
            : pendingCount === 0 && skippedExistingProducts > 0
              ? "all parsed products are already watched or already queued"
              : null;
    const debugSummary = [
      `HTTP ${response.status}`,
      `response ${html.length} chars`,
      `${rawCandidates.length} product links found`,
      `${pendingCount} pending TCG`,
      `${rejected} rejected non-TCG`,
      `${created} created`,
      `${updated} updated`,
      `${skippedExistingProducts} already watched`,
      targetSearchResult.reason ? `target search: ${targetSearchResult.reason}` : null,
      zeroCandidateReason ? `zero reason: ${zeroCandidateReason}` : null
    ]
      .filter(Boolean)
      .join("; ");

    await prisma.productDiscoverySource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        lastSuccessfulCheckedAt: now,
        nextCheckAt: nextCheckAt(source.checkFrequencyMinutes),
        lastResult: debugSummary,
        lastError: null,
        lastFoundCount: pendingCount
      }
    });
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "SUCCESS",
      startedAt,
      httpStatus: response.status,
      finalUrl,
      responseTimeMs,
      detectedWords: [
        "discovery source",
        `${rawCandidates.length} product links found`,
        `${pendingCount} TCG candidate links`,
        `${rejected} non-TCG excluded`,
        `${created} new candidates`,
        ...(zeroCandidateReason ? [zeroCandidateReason] : [])
      ],
      confidenceScore: availability.confidenceScore,
      reason: `${source.retailer.name} discovery debug: source ${source.url}; final ${finalUrl}; status ${response.status}; response length ${html.length}; blocked no; product links found ${rawCandidates.length}; candidates created ${created}; candidates rejected ${rejected}; ${zeroCandidateReason ? `reason ${zeroCandidateReason}.` : "candidate queue updated."} Search/category pages never trigger buy alerts.`,
      pageHash: hashPage(html)
    });

    return {
      sourceId,
      sourceName: source.name,
      status: "SUCCESS",
      found: pendingCount,
      created,
      updated,
      rejected,
      skippedExistingProducts,
      sourceUrl: source.url,
      httpStatus: response.status,
      finalUrl,
      responseLength: html.length,
      blocked: false,
      productLinksFound: rawCandidates.length,
      zeroCandidateReason
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery check failed";
    await prisma.productDiscoverySource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        nextCheckAt: nextCheckAt(source.checkFrequencyMinutes),
        lastResult: "Discovery check failed",
        lastError: message
      }
    });
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "ERROR",
      startedAt,
      changeSummary: "Public discovery page check failed.",
      error: message
    });
    return { sourceId, sourceName: source.name, status: "ERROR", found: 0, created: 0, rejected: 0, error: message, zeroCandidateReason: message };
  }
}

export async function runProductDiscoveryBatch(mode: DiscoveryMode = "due") {
  const now = new Date();
  const sources = await prisma.productDiscoverySource.findMany({
    where: {
      enabled: true,
      ...(mode === "due" ? { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] } : {})
    },
    orderBy: [{ nextCheckAt: "asc" }, { updatedAt: "asc" }]
  });

  const results = [];
  for (const source of sources) {
    results.push(await runProductDiscoveryCheck(source.id, mode === "all"));
    await delay(requestDelayMs());
  }

  return {
    checked: results.length,
    created: results.reduce((total, result) => total + result.created, 0),
    rejected: results.reduce((total, result) => total + ("rejected" in result ? Number(result.rejected || 0) : 0), 0),
    blocked: results.filter((result) => result.status === "BLOCKED").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    results
  };
}
