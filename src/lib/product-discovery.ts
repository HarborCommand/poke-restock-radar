import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { classifyRetailerProductUrl } from "@/lib/product-identity";
import { detectRetailerAvailability, detectRetailerPrice } from "@/lib/retailer-page-signals";

type DiscoveryMode = "due" | "all";

const DISCOVERY_USER_AGENT = "PokeRestockRadar/0.3 private-safe-discovery (+review-before-watch)";
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
      return { sourceId, sourceName: source.name, status: "BLOCKED", found: 0, created: 0 };
    }

    if (!response.ok) throw new Error(`Discovery page returned HTTP ${response.status}`);

    const directCandidate = sourceItselfCandidate(source.url, finalUrl, source.retailer.name);
    const rawCandidates = [
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
      .slice(0, 40);

    let created = 0;
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
      if (existingProduct) continue;

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
        productType: productTypeFromText(name),
        retailerProductId: candidate.retailerProductId,
        livePrice: directCandidate?.url === finalCandidateUrl ? detectRetailerPrice(html, source.retailer.name) : null,
        stockStatus: directCandidate?.url === finalCandidateUrl ? availability.status : null,
        confidenceScore: directCandidate?.url === finalCandidateUrl ? Math.max(availability.confidenceScore, 60) : 55,
        reason: directCandidate?.url === finalCandidateUrl
          ? `Exact source URL found. ${availability.reason}`
          : "Found exact product link on a public discovery page. Admin review required before monitoring.",
        status: "PENDING"
      };

      if (existingCandidate) {
        await prisma.productDiscoveryCandidate.update({ where: { id: existingCandidate.id }, data });
      } else {
        await prisma.productDiscoveryCandidate.create({ data });
        created += 1;
      }
    }

    await prisma.productDiscoverySource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        lastSuccessfulCheckedAt: now,
        nextCheckAt: nextCheckAt(source.checkFrequencyMinutes),
        lastResult: `${candidates.length} candidate links found; ${created} new pending review.`,
        lastError: null,
        lastFoundCount: candidates.length
      }
    });
    await createMonitorLog({
      runType: "DISCOVERY_DUE",
      status: "SUCCESS",
      startedAt,
      httpStatus: response.status,
      finalUrl,
      responseTimeMs,
      detectedWords: ["discovery source", `${candidates.length} candidate links`, `${created} new candidates`],
      confidenceScore: availability.confidenceScore,
      reason: `${source.retailer.name} discovery scan found ${candidates.length} exact product candidate links. Search/category pages never trigger buy alerts.`,
      pageHash: hashPage(html)
    });

    return { sourceId, sourceName: source.name, status: "SUCCESS", found: candidates.length, created };
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
    return { sourceId, sourceName: source.name, status: "ERROR", found: 0, created: 0, error: message };
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
    blocked: results.filter((result) => result.status === "BLOCKED").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    results
  };
}
