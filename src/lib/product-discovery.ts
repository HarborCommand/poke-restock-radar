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
  imageUrl?: string | null;
  livePrice?: number | null;
  productType?: string | null;
  confidenceScore?: number;
  reason?: string;
  status?: "PENDING" | "REJECTED_NON_TCG";
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
  imageUrl: string | null;
  livePrice: number | null;
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

  return {
    title,
    imageUrl: imageUrl ? decodeHtmlAttribute(imageUrl).replace(/\\\//g, "/").replace(/^\/\//, "https://") : null,
    price,
    dpci,
    upc
  };
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

function productTypeFromText(value: string) {
  const text = value.toLowerCase();
  if (text.includes("elite trainer") || text.includes(" etb")) return "ETB";
  if (text.includes("booster bundle")) return "Booster Bundle";
  if (text.includes("booster box") || text.includes("booster display")) return "Booster Box";
  if (text.includes("sleeved booster")) return "Sleeved Booster";
  if (text.includes("checklane") || text.includes("blister") || text.includes("3-pack") || text.includes("3 pack")) return "Blister Pack";
  if (text.includes("collection")) return "Collection Box";
  if (text.includes("tin")) return "Tin";
  if (text.includes("build") && text.includes("battle")) return "Build & Battle Box";
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
    return {
      ...candidate,
      label: metadata.title || candidate.label || candidateNameFromUrl(candidate.url),
      imageUrl: metadata.imageUrl,
      livePrice: metadata.price ?? null,
      reason: [
        metadata.dpci ? `DPCI ${metadata.dpci}` : null,
        metadata.upc ? `UPC ${metadata.upc}` : null,
        candidate.retailerProductId ? `TCIN ${candidate.retailerProductId}` : null
      ]
        .filter(Boolean)
        .join("; ")
    };
  });
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
  const evaluation = evaluateTargetPokemonTcgCandidate(productName, candidate.url);
  const targetMetadataReason = [
    metadata.dpci ? `DPCI ${metadata.dpci}` : null,
    metadata.upc ? `UPC ${metadata.upc}` : null,
    candidate.retailerProductId ? `TCIN ${candidate.retailerProductId}` : null,
    candidate.reason || null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ...candidate,
    label: productName,
    imageUrl: metadata.imageUrl,
    livePrice: metadata.price ?? (isDirect ? detectRetailerPrice(html, retailerName) : null),
    productType: evaluation.productType,
    confidenceScore: evaluation.confidenceScore,
    reason: targetMetadataReason ? `${evaluation.reason} ${targetMetadataReason}.` : evaluation.reason,
    status: evaluation.included ? "PENDING" : "REJECTED_NON_TCG"
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
  const evaluatedCandidates = rawCandidates.map((candidate) => enrichDiscoveryCandidate(candidate, input.html, "Target", null, availability));
  const candidates = evaluatedCandidates
    .filter((candidate) => (candidate.status ?? "PENDING") === "PENDING")
    .map((candidate): TargetDiscoveryPreviewCandidate => ({
      url: candidate.url,
      productName: candidate.label || candidateNameFromUrl(candidate.url),
      productType: candidate.productType ?? productTypeFromText(candidate.label),
      retailerProductId: candidate.retailerProductId,
      imageUrl: candidate.imageUrl ?? null,
      livePrice: candidate.livePrice ?? null,
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
      imageUrl: candidate.imageUrl ?? null,
      livePrice: candidate.livePrice ?? null,
      confidenceScore: candidate.confidenceScore ?? 15,
      status: "REJECTED_NON_TCG",
      reason: candidate.reason ?? "Rejected as non-TCG Target result."
    }));
  const zeroCandidateReason = blocked
    ? `blocked: ${availability.reason}`
    : rawCandidates.length === 0
      ? "no product links found; Target search page may be empty, redirected, blocked, or structure changed"
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
    const rawCandidates: DiscoveryCandidateRecord[] = isTargetDiscovery
      ? [...(directCandidate ? [directCandidate] : []), ...extractTargetProductCandidates(html, finalUrl)]
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
        imageUrl: candidate.imageUrl,
        livePrice: candidate.livePrice ?? null,
        stockStatus: directCandidate?.url === finalCandidateUrl ? availability.status : null,
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
        ? "no product links found; search page returned no exact product links or Target structure changed"
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
