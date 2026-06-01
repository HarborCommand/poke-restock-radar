import { prisma } from "@/lib/db";
import { daysUntil } from "@/lib/calculations";

type ReleaseSourceType =
  | "official_pokemon"
  | "official_pokemon_news"
  | "official_pokemon_center"
  | "pokemon_tcg_api"
  | "icv2_calendar"
  | "configured_feed"
  | "merge";

type ReleaseSourceStatus = "active" | "blocked" | "failed" | "needs_review" | "disabled";

type ReleaseCandidate = {
  setName: string;
  releaseName?: string | null;
  productName?: string | null;
  productType: string | null;
  releaseType: string;
  officialReleaseDate: Date | null;
  preorderDate?: Date | null;
  preorderWindowText?: string | null;
  region: string;
  retailer?: string | null;
  productTypes: string;
  productImage?: string | null;
  productUrl?: string | null;
  productLinks: string | null;
  notes: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  sourceUrl: string | null;
  sourceName: string;
  sourceType: ReleaseSourceType;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: "confirmed" | "scheduled" | "released" | "needs_review" | "TBD";
  needsReview: boolean;
  reviewReason?: string | null;
  supportingSources: ReleaseSourceRef[];
};

type ReleaseSourceRef = {
  sourceName: string;
  sourceUrl: string | null;
  sourceType: ReleaseSourceType;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

type AdapterLog = {
  sourceName: string;
  sourceUrl: string | null;
  sourceType?: ReleaseSourceType;
  adapter: ReleaseSourceType;
  status?: ReleaseSourceStatus;
  httpStatus?: number | null;
  parsedCount: number;
  createdCount?: number;
  updatedCount?: number;
  duplicateCount?: number;
  conflictCount?: number;
  warningCount?: number;
  error?: string | null;
};

type AdapterResult = {
  log: AdapterLog;
  candidates: ReleaseCandidate[];
  warnings: string[];
};

export type ReleaseSyncResult = {
  checkedAt: string;
  sources: string[];
  created: number;
  updated: number;
  skipped: number;
  duplicates: number;
  conflicts: number;
  candidates: Array<{
    setName: string;
    releaseDate: string;
    source: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    needsReview: boolean;
    action: "created" | "updated" | "skipped";
  }>;
  reviewQueue: Array<{ setName: string; reason: string; source: string }>;
  logs: AdapterLog[];
  warnings: string[];
};

const OFFICIAL_EXPANSIONS_URL = "https://tcg.pokemon.com/en-us/expansions/";
const DEFAULT_OFFICIAL_NEWS_URLS = [
  "https://www.pokemon.com/uk/pokemon-news/the-pokemon-tcg-mega-evolution-pitch-black-expansion-arrives-july-17-2026"
];
const POKEMON_CENTER_NEW_RELEASES_URL = "https://www.pokemoncenter.com/category/new-releases";
const POKEMON_TCG_API_URL = "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250";
const DEFAULT_ICV2_CALENDAR_URLS = ["https://icv2.com/articles/news/view/61079/pokemon-tcg-2026-product-calendar"];
const LEGACY_BAD_ICV2_SEARCH_URL = "https://icv2.com/search?q=Pokemon%20TCG%202026%20Product%20Calendar";

function releaseYearWindow(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31, 23, 59, 59))
  };
}

function parseReleaseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = value.replace(/\b(?:st|nd|rd|th)\b/gi, "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? `${clean}T14:00:00.000Z` : clean;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeReleaseName(value: string) {
  return value
    .toLowerCase()
    .replace(/pok[eé]mon|tcg|trading card game|scarlet & violet|mega evolution/gi, " ")
    .replace(
      /\b(elite trainer box|etb|booster bundle|booster box|premium collection|collection box|mini tins?|tin|blister|three-booster blister|build\s*&\s*battle box|build and battle box|build\s*&\s*battle stadium|league battle deck|poster collection|binder collection|checklane blister|expansion|product drop|product)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function priorityForRelease(date: Date | null) {
  if (!date) return "MEDIUM";
  const remaining = daysUntil(date);
  if (remaining >= 0 && remaining <= 45) return "HIGH";
  if (remaining >= 0 && remaining <= 120) return "MEDIUM";
  return "LOW";
}

function releaseStatus(date: Date | null, needsReview = false, sourceType: ReleaseSourceType = "configured_feed") {
  if (needsReview) return "needs_review" as const;
  if (!date) return "TBD" as const;
  if (date.getTime() < Date.now()) return "released" as const;
  if (sourceType === "icv2_calendar" || sourceType === "configured_feed") return "scheduled" as const;
  return "confirmed" as const;
}

function dateKey(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "TBD";
}

function classifyAdapterStatus(log: AdapterLog, warnings: string[] = []): ReleaseSourceStatus {
  const blockedText = `${log.error ?? ""} ${warnings.join(" ")}`;
  if (log.httpStatus === 401 || log.httpStatus === 403 || log.httpStatus === 429 || /blocked|captcha|incapsula|access denied|forbidden|aborted/i.test(blockedText)) {
    return "blocked";
  }
  if (log.error || (log.httpStatus !== undefined && log.httpStatus !== null && log.httpStatus >= 400)) {
    return "failed";
  }
  if (log.adapter === "icv2_calendar" || log.parsedCount === 0 || warnings.length) {
    return "needs_review";
  }
  return "active";
}

export function classifyAdapterStatusForTest(log: AdapterLog, warnings: string[] = []) {
  return classifyAdapterStatus(log, warnings);
}

function withSourceHealth(result: AdapterResult): AdapterResult {
  const status = classifyAdapterStatus(result.log, result.warnings);
  return {
    ...result,
    log: {
      ...result.log,
      sourceType: result.log.sourceType ?? result.log.adapter,
      status,
      warningCount: result.warnings.length,
      error: result.log.error ?? (status === "needs_review" && result.log.parsedCount === 0 ? "No release records parsed from this source." : null)
    }
  };
}

function releaseNotes(source: string, extra: string[] = []) {
  return [`Auto-synced from ${source}. No fabricated dates; unconfirmed entries are marked for review.`, ...extra]
    .filter(Boolean)
    .join(" ");
}

function supportingSource(candidate: Omit<ReleaseCandidate, "supportingSources">): ReleaseSourceRef {
  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    sourceType: candidate.sourceType,
    confidence: candidate.confidence
  };
}

function candidate(input: Omit<ReleaseCandidate, "supportingSources" | "priority" | "status"> & { priority?: "LOW" | "MEDIUM" | "HIGH"; status?: ReleaseCandidate["status"] }): ReleaseCandidate {
  const priority = input.priority ?? priorityForRelease(input.officialReleaseDate);
  const status = input.status ?? releaseStatus(input.officialReleaseDate, input.needsReview, input.sourceType);
  return {
    ...input,
    priority,
    status,
    supportingSources: [supportingSource({ ...input, priority, status } as ReleaseCandidate)]
  };
}

async function fetchText(url: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept,
        "user-agent":
          "Mozilla/5.0 (compatible; PokeRestockRadar/1.0; +https://poke-restock-radar.vercel.app)"
      },
      signal: controller.signal,
      cache: "no-store"
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  } finally {
    clearTimeout(timeout);
  }
}

function monthDateMatches(text: string) {
  return Array.from(
    text.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2}\b/gi)
  ).map((match) => ({ value: match[0], index: match.index ?? 0 }));
}

function extractFirstDate(text: string) {
  const iso = text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  if (iso) return parseReleaseDate(iso);
  const monthDate = monthDateMatches(text)[0]?.value;
  return monthDate ? parseReleaseDate(monthDate) : null;
}

function inferReleaseType(text: string) {
  if (/pre-?order|preorder/i.test(text)) return "preorder_window";
  if (/expansion|set/i.test(text)) return "expansion";
  return "product_drop";
}

function inferProductType(text: string) {
  if (/elite trainer box|etb/i.test(text)) return "Elite Trainer Box";
  if (/booster bundle/i.test(text)) return "Booster Bundle";
  if (/booster box/i.test(text)) return "Booster Box";
  if (/three-booster|3-booster|blister/i.test(text)) return "Blister Pack";
  if (/premium collection/i.test(text)) return "Premium Collection";
  if (/tin/i.test(text)) return "Tin";
  if (/expansion|set/i.test(text)) return "Expansion";
  return "Product";
}

function cleanReleaseTitle(value: string) {
  let title = value
    .replace(/\s+/g, " ")
    .replace(/\b(?:includes|comes with|contains|for more info|see)\b.*?(?=Pok[e\u00e9]mon TCG:|Mega Evolution|Lumiose City|[A-Z][A-Za-z' -]+(?:Mini Tins|Premium Collection|Booster Bundle|Booster Box|Elite Trainer Box|Blister|Tin|Collection))/gi, "")
    .replace(/\b(?:coin-flip die|coin condition markers?|damage-counter dice|deck box|strategy sheet|code card for online play|code card)\b[,:;\s]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const productMatches = Array.from(
    title.matchAll(
      /(?:Pok[e\u00e9]mon TCG:\s*)?(?:Mega Evolution[^.;|]{3,100}|Lumiose City Mini Tins|[A-Z][A-Za-z0-9'&:() -]{2,90}(?:Elite Trainer Box|Booster Bundle|Booster Box|Premium Collection|Collection Box|Mini Tins|Tin|Blister|Build & Battle Box|Build and Battle Box|Build & Battle Stadium|League Battle Deck|Poster Collection|Binder Collection|Checklane Blister|Expansion))/gi
    )
  ).map((match) => match[0].trim());
  if ((title.length > 120 || /coin|strategy sheet|code card|deck box|condition marker/i.test(value)) && productMatches.length) {
    title = productMatches.at(-1) as string;
  }

  return title
    .replace(/\s+(?:Release Date|Available|Street Date)\s*:.*$/i, "")
    .replace(/[.;,:-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleNeedsReview(value: string) {
  if (!value || value.length < 5) return true;
  if (value.length > 120) return true;
  if (isLikelyReleaseArticleTitle(value)) return true;
  return /coin-flip die|coin condition markers?|strategy sheet|code card|deck box|don't miss out|more products from/i.test(value);
}

export function isLikelyReleaseArticleTitle(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return false;
  return (
    /check out every pok[e\u00e9]mon tcg product release/i.test(text) ||
    /don(?:\u2019|')?t miss out on more products/i.test(text) ||
    /more products from the latest expansions/i.test(text) ||
    /product releases?\s+in\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text) ||
    /(?:roundup|preview|announcement|article|news)\b/i.test(text)
  );
}

function hasReleaseProductSignal(value: string | null | undefined) {
  const text = value || "";
  return /expansion|elite trainer box|\betb\b|booster bundle|booster box|sleeved booster|premium collection|collection box|mini tin|\btin\b|blister|build\s*&\s*battle|build and battle|league battle deck|promo|special collection|binder collection|poster collection|checklane|deck|pokemon tcg:|pok[e\u00e9]mon tcg:/i.test(text);
}

function isConfirmedReleaseCandidate(candidate: ReleaseCandidate) {
  const title = candidate.productName || candidate.releaseName || candidate.setName;
  if (isLikelyReleaseArticleTitle(title)) return false;
  if (!candidate.officialReleaseDate && !candidate.preorderDate) return false;
  if (candidate.releaseType === "expansion" && !isLikelyReleaseArticleTitle(candidate.setName)) return true;
  return hasReleaseProductSignal(`${title} ${candidate.productType || ""} ${candidate.productTypes || ""}`);
}

function inferSetName(title: string) {
  const quoted = title.match(/Pok[eé]mon TCG:\s*([^|]+?)(?:\s+(?:Elite Trainer Box|Booster Bundle|Booster Box|Premium Collection|Three-Booster|Blister|Tin)\b|$)/i)?.[1];
  if (quoted) return quoted.trim();
  const expansion = title.match(/\b(Mega Evolution[^\n|,.;]+|Scarlet & Violet[^\n|,.;]+)\b/i)?.[1];
  if (expansion) return expansion.trim();
  return title.replace(/^Pok[eé]mon TCG:\s*/i, "").trim();
}

function titleCaseWords(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function parseOfficialNewsUrlFallback(sourceUrl: string): ReleaseCandidate[] {
  if (!/^https:\/\/www\.pokemon\.com\//i.test(sourceUrl)) return [];
  const slug = sourceUrl.split("/").filter(Boolean).at(-1) ?? "";
  const match = slug.match(/^the-pokemon-tcg-(.+)-expansion-arrives-([a-z]+)-(\d{1,2})-(20\d{2})$/i);
  if (!match) return [];
  const rawName = titleCaseWords(match[1]).replace(/^Mega Evolution\s+/i, "Mega Evolution—");
  const month = titleCaseWords(match[2]);
  const releaseDate = parseReleaseDate(`${month} ${match[3]}, ${match[4]}`);
  if (!releaseDate) return [];
  return [
    candidate({
      setName: rawName,
      releaseName: rawName,
      productName: `Pokemon TCG: ${rawName}`,
      productType: "Expansion",
      releaseType: "expansion",
      officialReleaseDate: releaseDate,
      preorderDate: null,
      preorderWindowText: null,
      region: "US",
      retailer: null,
      productTypes: "Expansion, booster packs, Elite Trainer Box, collection products",
      productImage: null,
      productUrl: sourceUrl,
      productLinks: sourceUrl,
      sourceUrl,
      sourceName: "Official Pokemon News",
      sourceType: "official_pokemon_news",
      confidence: "HIGH",
      needsReview: false,
      reviewReason: null,
      notes: releaseNotes("Official Pokemon News URL", [
        "The official Pokemon article URL includes both the expansion name and release date; used because the article body can be blocked by server-side bot protection."
      ])
    })
  ];
}

function titleCandidatesFromHtml(html: string) {
  const headingTitles = new Set<string>();
  const headingMatches = html.matchAll(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi);
  for (const match of headingMatches) {
    const title = stripTags(match[2]);
    if (isLikelyReleaseArticleTitle(title)) continue;
    if (/pok[eé]mon|tcg|booster|elite trainer|collection|expansion|tin|mega evolution|scarlet & violet/i.test(title) && title.length > 6) {
      headingTitles.add(title);
    }
  }
  if (headingTitles.size) return Array.from(headingTitles);

  const titles = new Set<string>();
  const text = stripTags(html);
  for (const match of text.matchAll(/Pok[eé]mon TCG:\s*[^.]{8,120}/gi)) {
    const title = match[0].trim();
    if (!isLikelyReleaseArticleTitle(title)) titles.add(title);
  }
  for (const match of text.matchAll(/Mega Evolution[—\-\s][^.]{4,90}/gi)) {
    const title = match[0].trim();
    if (!isLikelyReleaseArticleTitle(title)) titles.add(title);
  }
  return Array.from(titles);
}

function imageNearTitle(html: string, title: string) {
  const index = html.toLowerCase().indexOf(title.toLowerCase().slice(0, 40));
  const windowText = index >= 0 ? html.slice(Math.max(0, index - 2500), index + 2500) : html.slice(0, 4000);
  return (
    windowText.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i)?.[1] ??
    windowText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    null
  );
}

export function parseOfficialExpansionsHtml(html: string, sourceUrl = OFFICIAL_EXPANSIONS_URL): ReleaseCandidate[] {
  const text = stripTags(html);
  const titles = titleCandidatesFromHtml(html);
  const candidates: ReleaseCandidate[] = [];

  for (const title of titles) {
    const cleanTitle = cleanReleaseTitle(title);
    const titleIndex = text.toLowerCase().indexOf(title.toLowerCase().slice(0, 40));
    const context = titleIndex >= 0 ? text.slice(Math.max(0, titleIndex - 700), titleIndex + 1200) : text;
    const releaseDate = extractFirstDate(context);
    if (!releaseDate) continue;
    candidates.push(
      candidate({
        setName: inferSetName(cleanTitle),
        releaseName: inferSetName(cleanTitle),
        productName: cleanTitle,
        productType: inferProductType(cleanTitle),
        releaseType: "expansion",
        officialReleaseDate: releaseDate,
        preorderDate: null,
        preorderWindowText: null,
        region: "US",
        retailer: null,
        productTypes: inferProductType(cleanTitle),
        productImage: imageNearTitle(html, title),
        productUrl: sourceUrl,
        productLinks: sourceUrl,
        sourceUrl,
        sourceName: "Official Pokemon TCG expansions",
        sourceType: "official_pokemon",
        confidence: "HIGH",
        needsReview: titleNeedsReview(cleanTitle),
        reviewReason: titleNeedsReview(cleanTitle) ? "Parser could not confirm a clean product or set title." : null,
        notes: releaseNotes("Official Pokemon TCG expansions page", [`Parsed title: ${cleanTitle}.`])
      })
    );
  }

  return dedupeCandidates(candidates);
}

export function parseOfficialNewsHtml(html: string, sourceUrl: string): ReleaseCandidate[] {
  const text = stripTags(html);
  const pageTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const titles = titleCandidatesFromHtml(html);
  const dates = monthDateMatches(text);
  const candidates: ReleaseCandidate[] = [];

  for (const title of titles) {
    const cleanTitle = cleanReleaseTitle(title);
    if (isLikelyReleaseArticleTitle(cleanTitle) || !hasReleaseProductSignal(cleanTitle)) continue;
    const titleIndex = text.toLowerCase().indexOf(title.toLowerCase().slice(0, 40));
    const context = titleIndex >= 0 ? text.slice(Math.max(0, titleIndex - 800), titleIndex + 1500) : text;
    let releaseDate = extractFirstDate(context);
    if (!releaseDate && dates.length === 1 && /product release|available|arrives|expansion/i.test(pageTitle + text.slice(0, 1000))) {
      releaseDate = parseReleaseDate(dates[0].value);
    }
    if (!releaseDate) continue;
    const isPreorder = /pre-?order|preorder/i.test(context);
    candidates.push(
      candidate({
        setName: inferSetName(cleanTitle),
        releaseName: inferSetName(cleanTitle),
        productName: cleanTitle,
        productType: inferProductType(cleanTitle),
        releaseType: inferReleaseType(context),
        officialReleaseDate: releaseDate,
        preorderDate: isPreorder ? releaseDate : null,
        preorderWindowText: isPreorder ? `Preorder mentioned by official Pokemon News on ${dateKey(releaseDate)}` : null,
        region: "US",
        retailer: null,
        productTypes: inferProductType(cleanTitle),
        productImage: imageNearTitle(html, title),
        productUrl: sourceUrl,
        productLinks: sourceUrl,
        sourceUrl,
        sourceName: "Official Pokemon News",
        sourceType: "official_pokemon_news",
        confidence: "HIGH",
        needsReview: titleNeedsReview(cleanTitle),
        reviewReason: titleNeedsReview(cleanTitle) ? "Parser could not confirm a clean product title." : null,
        notes: releaseNotes("Official Pokemon News", [context.slice(0, 240)])
      })
    );
  }

  return dedupeCandidates(candidates.filter(isConfirmedReleaseCandidate));
}

export function parsePokemonCenterHtml(html: string, sourceUrl: string): ReleaseCandidate[] {
  const text = stripTags(html);
  const titles = titleCandidatesFromHtml(html);
  const candidates: ReleaseCandidate[] = [];

  for (const title of titles) {
    const cleanTitle = cleanReleaseTitle(title);
    const titleIndex = text.toLowerCase().indexOf(title.toLowerCase().slice(0, 40));
    const context = titleIndex >= 0 ? text.slice(Math.max(0, titleIndex - 500), titleIndex + 1000) : text;
    const releaseDate = extractFirstDate(context);
    if (!releaseDate) continue;
    candidates.push(
      candidate({
        setName: inferSetName(cleanTitle),
        releaseName: inferSetName(cleanTitle),
        productName: cleanTitle,
        productType: inferProductType(cleanTitle),
        releaseType: inferReleaseType(context),
        officialReleaseDate: releaseDate,
        preorderDate: /pre-?order|preorder/i.test(context) ? releaseDate : null,
        preorderWindowText: /pre-?order|preorder/i.test(context) ? "Pokemon Center preorder date visible on source page" : null,
        region: "US",
        retailer: "Pokemon Center",
        productTypes: inferProductType(cleanTitle),
        productImage: imageNearTitle(html, title),
        productUrl: sourceUrl,
        productLinks: sourceUrl,
        sourceUrl,
        sourceName: "Official Pokemon Center",
        sourceType: "official_pokemon_center",
        confidence: "HIGH",
        needsReview: titleNeedsReview(cleanTitle),
        reviewReason: titleNeedsReview(cleanTitle) ? "Parser could not confirm a clean Pokemon Center product title." : null,
        notes: releaseNotes("Pokemon Center", [context.slice(0, 220)])
      })
    );
  }

  return dedupeCandidates(candidates);
}

export function parseIcv2CalendarHtml(html: string, sourceUrl: string): ReleaseCandidate[] {
  const text = stripTags(html);
  const candidates: ReleaseCandidate[] = [];
  const productDateMatches = Array.from(
    text.matchAll(
      /(?<title>(?:(?!Release Date|Available|Street Date).){4,180}?)\s+(?:Release Date|Available|Street Date)\s*[:\-]?\s*(?<date>(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2})/gi
    )
  );
  const lines = productDateMatches.length
    ? productDateMatches.map((match) => `${match.groups?.title ?? ""} Release Date: ${match.groups?.date ?? ""}`)
    : text
        .split(/(?=(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2})/i)
        .map((line) => line.trim())
        .filter(Boolean);

  for (const line of lines) {
    if (!/pok.mon|pokemon|tcg|booster|elite trainer|collection|tin|mega evolution|scarlet & violet|greninja|lumiose/i.test(line)) continue;
    const releaseDate = extractFirstDate(line);
    if (!releaseDate) continue;
    const titleMatch =
      line.match(/^(.*?)(?:\s+Release Date\s*:|\s+Available\s*:|\s+Street Date\s*:)/i)?.[1] ??
      line.match(/Pok.mon[^.]{8,150}/i)?.[0] ??
      line.match(/Pokemon[^.]{8,150}/i)?.[0] ??
      line.match(/Mega Evolution[^.]{4,150}/i)?.[0] ??
      line.slice(0, 140);
    const title = cleanReleaseTitle(titleMatch
      .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2}\b/gi, "")
      .replace(/\s+Release Date.*$/i, "")
      .replace(/\s+/g, " ")
      .trim());
    if (title.length < 5) continue;
    const needsReview = titleNeedsReview(title);
    candidates.push(
      candidate({
        setName: inferSetName(title),
        releaseName: inferSetName(title),
        productName: title,
        productType: inferProductType(title),
        releaseType: inferReleaseType(line),
        officialReleaseDate: releaseDate,
        preorderDate: null,
        preorderWindowText: null,
        region: "US",
        retailer: null,
        productTypes: inferProductType(title),
        productImage: imageNearTitle(html, title),
        productUrl: sourceUrl,
        productLinks: sourceUrl,
        sourceUrl,
        sourceName: "ICv2 Pokemon TCG Product Calendar",
        sourceType: "icv2_calendar",
        confidence: "MEDIUM",
        needsReview,
        reviewReason: needsReview ? "Parser could not confirm a clean ICv2 product title." : null,
        notes: releaseNotes("ICv2 secondary product calendar", [
          needsReview
            ? "Needs review because the parsed title looked unclear."
            : "Trusted secondary calendar with product name and release date; shown as Scheduled until official confirmation.",
          line.slice(0, 260)
        ])
      })
    );
  }

  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: ReleaseCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${normalizeReleaseName(item.setName)}:${dateKey(item.officialReleaseDate)}:${item.productName ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function pokemonTcgApiAdapter(): Promise<AdapterResult> {
  try {
    const response = await fetch(POKEMON_TCG_API_URL, {
      headers: {
        accept: "application/json",
        ...(process.env.POKEMON_TCG_API_KEY ? { "X-Api-Key": process.env.POKEMON_TCG_API_KEY } : {})
      },
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        candidates: [],
        warnings: [`Pokemon TCG API returned ${response.status}.`],
        log: { sourceName: "Pokemon TCG API", sourceUrl: POKEMON_TCG_API_URL, adapter: "pokemon_tcg_api", httpStatus: response.status, parsedCount: 0, error: `HTTP ${response.status}` }
      };
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; series?: string; releaseDate?: string; total?: number }>;
    };
    const { start, end } = releaseYearWindow();
    const candidates = (payload.data ?? [])
      .map((set): ReleaseCandidate | null => {
        const releaseDate = parseReleaseDate(set.releaseDate);
        if (!releaseDate || releaseDate < start || releaseDate > end || !set.name) return null;
        const sourceUrl = set.id ? `https://pokemontcg.io/sets/${encodeURIComponent(set.id)}` : "https://pokemontcg.io/";
        return candidate({
          setName: set.name,
          releaseName: set.name,
          productName: set.name,
          productType: "Expansion",
          releaseType: "expansion",
          officialReleaseDate: releaseDate,
          preorderDate: null,
          preorderWindowText: null,
          region: "US",
          retailer: null,
          productTypes: "Booster packs, Elite Trainer Boxes, booster bundles, collection products",
          productImage: null,
          productUrl: sourceUrl,
          productLinks: sourceUrl,
          sourceUrl,
          sourceName: "Pokemon TCG API",
          sourceType: "pokemon_tcg_api",
          confidence: "HIGH",
          needsReview: false,
          reviewReason: null,
          notes: releaseNotes("Pokemon TCG API", [set.series ? `Series: ${set.series}.` : "", set.total ? `${set.total} cards tracked by the API.` : ""].filter(Boolean))
        });
      })
      .filter((item): item is ReleaseCandidate => Boolean(item));
    return {
      candidates,
      warnings: [],
      log: { sourceName: "Pokemon TCG API", sourceUrl: POKEMON_TCG_API_URL, adapter: "pokemon_tcg_api", httpStatus: response.status, parsedCount: candidates.length }
    };
  } catch (error) {
    return {
      candidates: [],
      warnings: [error instanceof Error ? error.message : "Pokemon TCG API fetch failed."],
      log: { sourceName: "Pokemon TCG API", sourceUrl: POKEMON_TCG_API_URL, adapter: "pokemon_tcg_api", parsedCount: 0, error: error instanceof Error ? error.message : "fetch failed" }
    };
  }
}

async function htmlAdapter(sourceName: string, sourceUrl: string, adapter: ReleaseSourceType, parser: (html: string, url: string) => ReleaseCandidate[]): Promise<AdapterResult> {
  try {
    const response = await fetchText(sourceUrl);
    if (!response.ok) {
      return {
        candidates: [],
        warnings: [`${sourceName} returned ${response.status}.`],
        log: { sourceName, sourceUrl, adapter, httpStatus: response.status, parsedCount: 0, error: `HTTP ${response.status}` }
      };
    }
    const blockedBody = /pardon our interruption|incapsula|captcha|access denied|temporarily unavailable|robot/i.test(response.text);
    const candidates = parser(response.text, sourceUrl);
    const finalCandidates =
      candidates.length || adapter !== "official_pokemon_news"
        ? candidates
        : parseOfficialNewsUrlFallback(sourceUrl);
    const warnings = blockedBody && !finalCandidates.length ? [`${sourceName} appears blocked or unavailable.`] : [];
    return {
      candidates: finalCandidates,
      warnings,
      log: {
        sourceName,
        sourceUrl,
        adapter,
        httpStatus: response.status,
        parsedCount: finalCandidates.length,
        error: blockedBody && !finalCandidates.length ? "Blocked or bot-protected response" : null
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${sourceName} fetch failed.`;
    return {
      candidates: [],
      warnings: [message],
      log: { sourceName, sourceUrl, adapter, parsedCount: 0, error: message }
    };
  }
}

function releaseFeedUrls() {
  return (process.env.POKEMON_RELEASE_FEED_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function configuredSourceUrls() {
  return (process.env.POKEMON_RELEASE_SOURCE_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

async function disabledSourceUrls() {
  try {
    const sources = await prisma.releaseSyncSource.findMany({
      where: { enabled: false },
      select: { sourceUrl: true }
    });
    return new Set(sources.map((source) => source.sourceUrl));
  } catch {
    return new Set<string>();
  }
}

function officialNewsUrls(now = new Date()) {
  void now;
  return Array.from(new Set(DEFAULT_OFFICIAL_NEWS_URLS));
}

function tagValue(input: string, tag: string) {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
}

function linkValue(input: string) {
  return tagValue(input, "link") || input.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
}

async function configuredFeedAdapters(): Promise<AdapterResult[]> {
  const results: AdapterResult[] = [];
  const urls = releaseFeedUrls();
  for (const url of urls) {
    try {
      const response = await fetchText(url, "application/rss+xml, application/json, text/xml, text/plain");
      if (!response.ok) {
        results.push({ candidates: [], warnings: [`${url} returned ${response.status}.`], log: { sourceName: "Configured release feed", sourceUrl: url, adapter: "configured_feed", httpStatus: response.status, parsedCount: 0, error: `HTTP ${response.status}` } });
        continue;
      }
      const rawItems = response.text.trim().startsWith("[") || response.text.trim().startsWith("{")
        ? (Array.isArray(JSON.parse(response.text)) ? JSON.parse(response.text) : JSON.parse(response.text).items ?? JSON.parse(response.text).data ?? [])
        : Array.from(response.text.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)).map((match) => ({
            title: tagValue(match[0], "title"),
            link: linkValue(match[0]),
            content: `${tagValue(match[0], "description")} ${tagValue(match[0], "summary")} ${tagValue(match[0], "content")}`
          }));
      const candidates: ReleaseCandidate[] = [];
      const { start, end } = releaseYearWindow();
      for (const raw of rawItems as Array<Record<string, unknown>>) {
        const title = String(raw.title ?? raw.name ?? "");
        const content = String(raw.content ?? raw.description ?? raw.summary ?? "");
        const link = String(raw.link ?? raw.url ?? raw.productUrl ?? "");
        const combined = `${title} ${content}`;
        if (!/pok[eé]mon|tcg|trading card/i.test(combined)) continue;
        const releaseDate = parseReleaseDate(raw.releaseDate) ?? parseReleaseDate(raw.date) ?? extractFirstDate(combined);
        if (releaseDate && (releaseDate < start || releaseDate > end)) continue;
        candidates.push(
          candidate({
            setName: inferSetName(title) || "Pokemon TCG Release",
            releaseName: inferSetName(title) || "Pokemon TCG Release",
            productName: title || "Pokemon TCG Release",
            productType: inferProductType(combined),
            releaseType: inferReleaseType(combined),
            officialReleaseDate: releaseDate,
            preorderDate: parseReleaseDate(raw.preorderDate) ?? (/preorder/i.test(combined) ? releaseDate : null),
            preorderWindowText: /preorder/i.test(combined) ? "Preorder window mentioned by configured feed" : null,
            region: String(raw.region ?? "US"),
            retailer: typeof raw.retailer === "string" ? raw.retailer : null,
            productTypes: inferProductType(combined),
            productImage: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
            productUrl: link || url,
            productLinks: link || url,
            sourceUrl: link || url,
            sourceName: "Configured release feed",
            sourceType: "configured_feed",
            confidence: releaseDate ? "MEDIUM" : "LOW",
            needsReview: !releaseDate,
            reviewReason: releaseDate ? null : "Configured feed item did not include a verified release date.",
            notes: releaseNotes(`configured release feed ${url}`, [content.slice(0, 220)])
          })
        );
      }
      results.push({ candidates, warnings: [], log: { sourceName: "Configured release feed", sourceUrl: url, adapter: "configured_feed", httpStatus: response.status, parsedCount: candidates.length } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "configured feed failed";
      results.push({ candidates: [], warnings: [message], log: { sourceName: "Configured release feed", sourceUrl: url, adapter: "configured_feed", parsedCount: 0, error: message } });
    }
  }
  return results;
}

async function runAdapters() {
  const disabledSources = await disabledSourceUrls();
  const configuredSources = Array.from(new Set([...DEFAULT_ICV2_CALENDAR_URLS, ...configuredSourceUrls()])).filter((url) => !disabledSources.has(url));
  const newsUrls = officialNewsUrls().filter((url) => !disabledSources.has(url));
  const adapterPromises: Array<Promise<AdapterResult>> = [
    pokemonTcgApiAdapter(),
    htmlAdapter("Official Pokemon TCG expansions", OFFICIAL_EXPANSIONS_URL, "official_pokemon", parseOfficialExpansionsHtml),
    htmlAdapter("Official Pokemon Center new releases", POKEMON_CENTER_NEW_RELEASES_URL, "official_pokemon_center", parsePokemonCenterHtml),
    ...newsUrls.map((url) => htmlAdapter("Official Pokemon News", url, "official_pokemon_news", parseOfficialNewsHtml)),
    ...configuredSources.map((url) => {
      if (/icv2\.com/i.test(url)) return htmlAdapter("ICv2 Pokemon TCG Product Calendar", url, "icv2_calendar", parseIcv2CalendarHtml);
      if (/pokemoncenter\.com/i.test(url)) return htmlAdapter("Official Pokemon Center", url, "official_pokemon_center", parsePokemonCenterHtml);
      if (/pokemon\.com\/[^/]+\/pokemon-news/i.test(url)) return htmlAdapter("Official Pokemon News", url, "official_pokemon_news", parseOfficialNewsHtml);
      return htmlAdapter("Official Pokemon source", url, "official_pokemon", parseOfficialExpansionsHtml);
    })
  ];
  return [...(await Promise.all(adapterPromises)), ...(await configuredFeedAdapters())].map(withSourceHealth);
}

function sourceRank(sourceType: ReleaseSourceType) {
  if (["official_pokemon", "official_pokemon_news", "official_pokemon_center", "pokemon_tcg_api"].includes(sourceType)) return 4;
  if (sourceType === "configured_feed") return 2;
  if (sourceType === "icv2_calendar") return 2;
  return 0;
}

function confidenceRank(confidence: "LOW" | "MEDIUM" | "HIGH") {
  return confidence === "HIGH" ? 3 : confidence === "MEDIUM" ? 2 : 1;
}

function mergeLinks(...values: Array<string | null | undefined>) {
  const links = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s*,\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(links)).join(", ") || null;
}

function mergeSupportSources(sources: ReleaseSourceRef[]) {
  const unique = new Map<string, ReleaseSourceRef>();
  for (const source of sources) {
    unique.set(`${source.sourceName}:${source.sourceUrl ?? ""}`, source);
  }
  return Array.from(unique.values()).sort((a, b) => sourceRank(b.sourceType) - sourceRank(a.sourceType));
}

function mergeCandidates(candidates: ReleaseCandidate[]) {
  const byName = new Map<string, ReleaseCandidate>();
  let duplicates = 0;
  let conflicts = 0;

  for (const next of candidates.filter(isConfirmedReleaseCandidate)) {
    const key = normalizeReleaseName(next.setName || next.productName || "");
    if (!key) continue;
    const current = byName.get(key);
    if (!current) {
      byName.set(key, next);
      continue;
    }
    duplicates += 1;
    const currentRank = sourceRank(current.sourceType);
    const nextRank = sourceRank(next.sourceType);
    const currentDate = dateKey(current.officialReleaseDate);
    const nextDate = dateKey(next.officialReleaseDate);
    const dateConflict = currentDate !== "TBD" && nextDate !== "TBD" && currentDate !== nextDate;
    const officialWinner = nextRank > currentRank || (nextRank === currentRank && confidenceRank(next.confidence) > confidenceRank(current.confidence)) ? next : current;
    const mergedSources = mergeSupportSources([...current.supportingSources, ...next.supportingSources]);
    const conflictReview = dateConflict
      ? `Conflicting release dates: ${current.sourceName} says ${currentDate}; ${next.sourceName} says ${nextDate}. Official/highest confidence source is shown until reviewed.`
      : null;
    if (dateConflict) conflicts += 1;

    byName.set(key, {
      ...officialWinner,
      setName: officialWinner.setName || current.setName || next.setName,
      releaseName: officialWinner.releaseName || current.releaseName || next.releaseName,
      productName: officialWinner.productName || current.productName || next.productName,
      productType: officialWinner.productType || current.productType || next.productType,
      productTypes: officialWinner.productTypes || current.productTypes || next.productTypes,
      productImage: officialWinner.productImage || current.productImage || next.productImage,
      productUrl: officialWinner.productUrl || current.productUrl || next.productUrl,
      productLinks: mergeLinks(current.productLinks, next.productLinks, current.sourceUrl, next.sourceUrl),
      supportingSources: mergedSources,
      needsReview: Boolean(conflictReview) || officialWinner.needsReview,
      reviewReason: conflictReview || officialWinner.reviewReason || null,
      status: releaseStatus(officialWinner.officialReleaseDate, Boolean(conflictReview) || officialWinner.needsReview, officialWinner.sourceType),
      notes: [
        officialWinner.notes,
        `Confirmed by ${mergedSources.length} source${mergedSources.length === 1 ? "" : "s"}: ${mergedSources.map((source) => source.sourceName).join(", ")}.`
      ].join(" ")
    });
  }

  return {
    candidates: Array.from(byName.values()).sort(
      (a, b) => (a.officialReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.officialReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER)
    ),
    duplicates,
    conflicts
  };
}

export function mergeReleaseCandidatesForTest(candidates: ReleaseCandidate[]) {
  return mergeCandidates(candidates);
}

async function recordSyncLogs(checkedAt: Date, logs: AdapterLog[]) {
  if (!logs.length) return;
  await prisma.releaseSyncLog.createMany({
    data: logs.map((log) => ({
      checkedAt,
      sourceName: log.sourceName,
      sourceUrl: log.sourceUrl,
      sourceType: log.sourceType ?? log.adapter,
      adapter: log.adapter,
      status: log.status ?? classifyAdapterStatus(log),
      httpStatus: log.httpStatus ?? null,
      parsedCount: log.parsedCount,
      createdCount: log.createdCount ?? 0,
      updatedCount: log.updatedCount ?? 0,
      duplicateCount: log.duplicateCount ?? 0,
      conflictCount: log.conflictCount ?? 0,
      warningCount: log.warningCount ?? 0,
      error: log.error ?? null
    }))
  });
}

async function ensureReleaseSyncSources(logs: AdapterLog[], checkedAt: Date) {
  for (const log of logs.filter((item) => item.sourceUrl)) {
    await prisma.releaseSyncSource.upsert({
      where: { sourceUrl: log.sourceUrl as string },
      create: {
        sourceName: log.sourceName,
        sourceType: log.sourceType ?? log.adapter,
        sourceUrl: log.sourceUrl as string,
        adapter: log.adapter,
        enabled: true,
        priority: sourceRank(log.adapter) * 25,
        confidenceDefault: log.adapter.startsWith("official") || log.adapter === "pokemon_tcg_api" ? "HIGH" : "MEDIUM",
        lastCheckedAt: checkedAt,
        lastSuccessfulParseAt: log.parsedCount > 0 && !log.error ? checkedAt : null,
        lastHttpStatus: log.httpStatus ?? null,
        lastStatus: log.status ?? classifyAdapterStatus(log),
        lastError: log.error ?? null,
        parsedCount: log.parsedCount,
        createdCount: log.createdCount ?? 0,
        updatedCount: log.updatedCount ?? 0
      },
      update: {
        sourceName: log.sourceName,
        sourceType: log.sourceType ?? log.adapter,
        adapter: log.adapter,
        priority: sourceRank(log.adapter) * 25,
        confidenceDefault: log.adapter.startsWith("official") || log.adapter === "pokemon_tcg_api" ? "HIGH" : "MEDIUM",
        lastCheckedAt: checkedAt,
        lastSuccessfulParseAt: log.parsedCount > 0 && !log.error ? checkedAt : undefined,
        lastHttpStatus: log.httpStatus ?? null,
        lastStatus: log.status ?? classifyAdapterStatus(log),
        lastError: log.error ?? null,
        parsedCount: log.parsedCount,
        createdCount: log.createdCount ?? 0,
        updatedCount: log.updatedCount ?? 0
      }
    });
  }
}

async function cleanupLegacyBadIcv2SearchRows() {
  await prisma.release.updateMany({
    where: {
      createdByManualEntry: false,
      sourceUrl: LEGACY_BAD_ICV2_SEARCH_URL
    },
    data: {
      status: "archived",
      needsReview: true,
      reviewReason: "Archived legacy ICv2 search-result row. Configure a direct ICv2 product calendar URL before using ICv2 as a secondary source."
    }
  });
}

async function cleanupArticleTitleReleaseRows() {
  const badTitleFilters = [
    "Check Out Every",
    "Product Release in",
    "Product Releases in",
    "Don't miss out on more products",
    "Don't miss out on more products",
    "more products from the latest expansions"
  ];
  for (const title of badTitleFilters) {
    await prisma.release.updateMany({
      where: {
        createdByManualEntry: false,
        status: { not: "archived" },
        OR: [
          { setName: { contains: title } },
          { releaseName: { contains: title } },
          { productName: { contains: title } }
        ]
      },
      data: {
        status: "archived",
        needsReview: true,
        reviewReason:
          "Archived because this row was a source/news article title, not a confirmed Pokemon TCG product or set release. Source history remains available in Release News / Source Log."
      }
    });
  }
}

async function cleanupScheduledReleaseRows() {
  await prisma.release.updateMany({
    where: {
      createdByManualEntry: false,
      sourceType: "icv2_calendar",
      officialReleaseDate: { not: null },
      status: { not: "archived" },
      OR: [
        { reviewReason: { contains: "Secondary ICv2 calendar" } },
        { reviewReason: { contains: "needs official confirmation" } }
      ]
    },
    data: {
      status: "scheduled",
      needsReview: false,
      reviewReason: null
    }
  });

  await prisma.release.updateMany({
    where: {
      status: { not: "archived" },
      OR: [
        { setName: { contains: "Lumiose City Mini Tins" } },
        { releaseName: { contains: "Lumiose City Mini Tins" } },
        { productName: { contains: "Lumiose City Mini Tins" } }
      ]
    },
    data: {
      setName: "Lumiose City Mini Tins",
      releaseName: "Lumiose City Mini Tins",
      productName: "Lumiose City Mini Tins",
      productType: "Tin",
      productTypes: "Tin",
      status: "scheduled",
      needsReview: false,
      reviewReason: null
    }
  });
}

async function disableRepeated404Sources(logs: AdapterLog[]) {
  for (const log of logs) {
    if (!log.sourceUrl || log.httpStatus !== 404) continue;
    const recent404Count = await prisma.releaseSyncLog.count({
      where: {
        sourceUrl: log.sourceUrl,
        httpStatus: 404,
        checkedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
      }
    });
    if (recent404Count < 2) continue;
    await prisma.releaseSyncSource.updateMany({
      where: { sourceUrl: log.sourceUrl },
      data: {
        enabled: false,
        lastStatus: "disabled",
        lastError: "Disabled after repeated 404 responses. Re-enable from Admin after confirming the source URL."
      }
    });
  }
}

export async function syncReleaseCalendarFromPublicSources(): Promise<ReleaseSyncResult> {
  const checkedAt = new Date();
  const adapterResults = await runAdapters();
  const warnings = adapterResults.flatMap((result) => result.warnings);
  const rawLogs = adapterResults.map((result) => result.log);
  const failedSourceCount = rawLogs.filter((log) => log.status === "failed" || log.status === "blocked").length;
  const reviewSourceCount = rawLogs.filter((log) => log.status === "needs_review").length;
  const { candidates, duplicates, conflicts } = mergeCandidates(adapterResults.flatMap((result) => result.candidates));
  const existing = await prisma.release.findMany();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const actions: ReleaseSyncResult["candidates"] = [];
  const reviewQueue: ReleaseSyncResult["reviewQueue"] = [];

  for (const releaseCandidate of candidates) {
    const key = normalizeReleaseName(releaseCandidate.setName);
    const match = existing.find((release) => normalizeReleaseName(release.setName) === key || normalizeReleaseName(release.releaseName || "") === key || normalizeReleaseName(release.productName || "") === key);
    const supportingSources = JSON.stringify(releaseCandidate.supportingSources);
    const actionBase = {
      setName: releaseCandidate.setName,
      releaseDate: releaseCandidate.officialReleaseDate?.toISOString() ?? "TBD",
      source: releaseCandidate.sourceName,
      confidence: releaseCandidate.confidence,
      needsReview: releaseCandidate.needsReview
    };

    if (!match) {
      await prisma.release.create({
        data: {
          setName: releaseCandidate.setName,
          releaseName: releaseCandidate.releaseName,
          productName: releaseCandidate.productName ?? releaseCandidate.releaseName ?? releaseCandidate.setName,
          productType: releaseCandidate.productType,
          releaseType: releaseCandidate.releaseType,
          officialReleaseDate: releaseCandidate.officialReleaseDate,
          preorderDate: releaseCandidate.preorderDate ?? null,
          preorderWindowText: releaseCandidate.preorderWindowText ?? null,
          region: releaseCandidate.region,
          retailer: releaseCandidate.retailer ?? null,
          productTypes: releaseCandidate.productTypes,
          pokemonCenterExclusiveVersion: releaseCandidate.sourceType === "official_pokemon_center",
          productImage: releaseCandidate.productImage ?? null,
          productUrl: releaseCandidate.productUrl ?? null,
          chaseCards: null,
          demandRating: releaseCandidate.priority,
          estimatedDemand: releaseCandidate.priority,
          priority: releaseCandidate.priority,
          sealedProductPriority: releaseCandidate.priority,
          notes: releaseCandidate.notes,
          productLinks: releaseCandidate.productLinks,
          supportingSources,
          sourceUrl: releaseCandidate.sourceUrl,
          sourceName: releaseCandidate.sourceName,
          sourceType: releaseCandidate.sourceType,
          confidence: releaseCandidate.confidence,
          status: releaseCandidate.status,
          lastSyncedAt: checkedAt,
          createdByManualEntry: false,
          needsReview: releaseCandidate.needsReview,
          reviewReason: releaseCandidate.reviewReason ?? null
        }
      });
      created += 1;
      if (releaseCandidate.needsReview) reviewQueue.push({ setName: releaseCandidate.setName, reason: releaseCandidate.reviewReason || "Needs source review.", source: releaseCandidate.sourceName });
      await createReleaseSyncAlert(releaseCandidate, "created");
      actions.push({ ...actionBase, action: "created" });
      continue;
    }

    const nextLinks = mergeLinks(match.productLinks, releaseCandidate.productLinks);
    const dateChanged = Boolean(match.officialReleaseDate && releaseCandidate.officialReleaseDate && match.officialReleaseDate.getTime() !== releaseCandidate.officialReleaseDate.getTime());
    const shouldUpdate =
      dateChanged ||
      !match.officialReleaseDate ||
      match.productName !== (releaseCandidate.productName ?? match.productName) ||
      match.supportingSources !== supportingSources ||
      match.sourceUrl !== releaseCandidate.sourceUrl ||
      match.needsReview !== releaseCandidate.needsReview ||
      match.reviewReason !== (releaseCandidate.reviewReason ?? null);

    if (!shouldUpdate) {
      skipped += 1;
      actions.push({ ...actionBase, setName: match.setName, releaseDate: match.officialReleaseDate?.toISOString() ?? "TBD", needsReview: match.needsReview, action: "skipped" });
      continue;
    }

    await prisma.release.update({
      where: { id: match.id },
      data: {
        officialReleaseDate: releaseCandidate.officialReleaseDate,
        previousReleaseDate: dateChanged ? match.officialReleaseDate : match.previousReleaseDate,
        releaseName: releaseCandidate.releaseName || match.releaseName,
        productName: releaseCandidate.productName || match.productName,
        productType: releaseCandidate.productType || match.productType,
        releaseType: releaseCandidate.releaseType || match.releaseType,
        preorderDate: releaseCandidate.preorderDate || match.preorderDate || null,
        preorderWindowText: releaseCandidate.preorderWindowText || match.preorderWindowText || null,
        region: releaseCandidate.region || match.region,
        retailer: releaseCandidate.retailer || match.retailer || null,
        productTypes: releaseCandidate.productTypes || match.productTypes,
        productImage: releaseCandidate.productImage || match.productImage || null,
        productUrl: releaseCandidate.productUrl || match.productUrl || null,
        productLinks: nextLinks,
        supportingSources,
        notes: match.createdByManualEntry && match.notes ? `${match.notes}\n\n${releaseCandidate.notes}` : releaseCandidate.notes,
        priority: releaseCandidate.priority,
        estimatedDemand: releaseCandidate.priority,
        sealedProductPriority: releaseCandidate.priority,
        sourceUrl: releaseCandidate.sourceUrl || match.sourceUrl,
        sourceName: releaseCandidate.sourceName || match.sourceName,
        sourceType: releaseCandidate.sourceType,
        confidence: releaseCandidate.confidence,
        status: releaseCandidate.status,
        lastSyncedAt: checkedAt,
        needsReview: releaseCandidate.needsReview,
        reviewReason: releaseCandidate.reviewReason ?? null
      }
    });
    updated += 1;
    if (releaseCandidate.needsReview) reviewQueue.push({ setName: releaseCandidate.setName, reason: releaseCandidate.reviewReason || "Needs source review.", source: releaseCandidate.sourceName });
    if (dateChanged) await createReleaseSyncAlert(releaseCandidate, "date_changed");
    actions.push({ ...actionBase, action: "updated" });
  }

  if (!process.env.POKEMON_RELEASE_SOURCE_URLS) {
    warnings.push("POKEMON_RELEASE_SOURCE_URLS is not configured. Add official or ICv2 calendar URLs when the source site uses pages not covered by default discovery.");
  }
  if (!process.env.POKEMON_RELEASE_FEED_URLS) {
    warnings.push("POKEMON_RELEASE_FEED_URLS is not configured. Set feeds for product-drop news beyond official/default sources.");
  }

  const summaryLog: AdapterLog = {
    sourceName: "Release sync summary",
    sourceUrl: null,
    sourceType: "merge",
    adapter: "merge",
    status: failedSourceCount ? "failed" : conflicts || reviewQueue.length || reviewSourceCount || warnings.length ? "needs_review" : "active",
    parsedCount: candidates.length,
    createdCount: created,
    updatedCount: updated,
    duplicateCount: duplicates,
    conflictCount: conflicts,
    warningCount: warnings.length,
    error: warnings.length ? warnings.slice(0, 3).join(" ") : null
  };
  const logs = [...rawLogs, summaryLog];
  await cleanupLegacyBadIcv2SearchRows();
  await cleanupArticleTitleReleaseRows();
  await cleanupScheduledReleaseRows();
  await ensureReleaseSyncSources(rawLogs, checkedAt);
  await recordSyncLogs(checkedAt, logs);
  await disableRepeated404Sources(rawLogs);
  await createReleaseSourceFailureAlerts(rawLogs);

  return {
    checkedAt: checkedAt.toISOString(),
    sources: Array.from(new Set(rawLogs.map((log) => log.sourceUrl || log.sourceName))),
    created,
    updated,
    skipped,
    duplicates,
    conflicts,
    candidates: actions,
    reviewQueue,
    logs,
    warnings
  };
}

async function createReleaseSyncAlert(candidate: ReleaseCandidate, action: "created" | "date_changed") {
  const title = action === "date_changed" ? `${candidate.setName} release date changed` : `New Pokemon release discovered: ${candidate.setName}`;
  const dedupeKey = `release_sync:${action}:${normalizeReleaseName(candidate.setName)}:${candidate.officialReleaseDate?.toISOString() ?? "tbd"}`;
  const existing = await prisma.alert.findFirst({ where: { dedupeKey } });
  if (existing) return;
  await prisma.alert.create({
    data: {
      title,
      reason: candidate.officialReleaseDate
        ? `${candidate.setName} is listed for ${candidate.officialReleaseDate.toISOString().slice(0, 10)} from ${candidate.sourceName}.`
        : `${candidate.setName} was found without an official date and needs review.`,
      priority: candidate.needsReview ? "MEDIUM" : candidate.priority,
      entityType: "RELEASE",
      actionUrl: candidate.sourceUrl,
      dedupeKey,
      score: candidate.needsReview ? 55 : 75,
      explanation: `Release calendar sync from ${candidate.sourceName}.`
    }
  });
}

async function createReleaseSourceFailureAlerts(logs: AdapterLog[]) {
  for (const log of logs) {
    if (log.status !== "failed" && log.status !== "blocked") continue;
    const dedupeKey = `release_source:${log.status}:${log.sourceUrl || log.sourceName}:${new Date().toISOString().slice(0, 10)}`;
    const existing = await prisma.alert.findFirst({ where: { dedupeKey } });
    if (existing) continue;
    await prisma.alert.create({
      data: {
        title: `Release source ${log.status}: ${log.sourceName}`,
        reason:
          log.status === "blocked"
            ? `${log.sourceName} was blocked or unavailable during release sync. Secondary sources remain visible for review.`
            : `${log.sourceName} failed during release sync${log.httpStatus ? ` with HTTP ${log.httpStatus}` : ""}.`,
        priority: "MEDIUM",
        entityType: "RELEASE_SOURCE",
        actionUrl: log.sourceUrl,
        dedupeKey,
        score: log.status === "blocked" ? 60 : 55,
        explanation: log.error || "Release source health issue recorded by daily sync."
      }
    });
  }
}
