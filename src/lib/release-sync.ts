import { prisma } from "@/lib/db";
import { daysUntil } from "@/lib/calculations";

type ReleaseCandidate = {
  setName: string;
  releaseName?: string | null;
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
  sourceType: "official" | "secondary" | "configured_feed";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: "upcoming" | "released" | "needs_review";
  needsReview: boolean;
  reviewReason?: string | null;
};

export type ReleaseSyncResult = {
  checkedAt: string;
  sources: string[];
  created: number;
  updated: number;
  skipped: number;
  candidates: Array<{
    setName: string;
    releaseDate: string;
    source: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    needsReview: boolean;
    action: "created" | "updated" | "skipped";
  }>;
  reviewQueue: Array<{ setName: string; reason: string; source: string }>;
  warnings: string[];
};

const officialSources = [
  "Pokemon TCG API",
  "https://tcg.pokemon.com/en-us/expansions/",
  "https://www.pokemon.com/us/pokemon-news/"
];

function releaseYearWindow(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31, 23, 59, 59))
  };
}

function parseReleaseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T14:00:00.000Z` : value.trim();
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeReleaseName(value: string) {
  return value.toLowerCase().replace(/pokemon|pokémon|tcg|trading card game|:/gi, "").replace(/\s+/g, " ").trim();
}

function priorityForRelease(date: Date | null) {
  if (!date) return "MEDIUM";
  const remaining = daysUntil(date);
  if (remaining >= 0 && remaining <= 45) return "HIGH";
  if (remaining >= 0 && remaining <= 120) return "MEDIUM";
  return "LOW";
}

function releaseNotes(source: string, extra: string[] = []) {
  return [`Auto-synced from ${source}. Verify regional product dates before chasing drops.`, ...extra].join(" ");
}

function releaseStatus(date: Date | null) {
  if (!date) return "needs_review" as const;
  return date.getTime() < Date.now() ? ("released" as const) : ("upcoming" as const);
}

async function fetchPokemonTcgSets(): Promise<{ candidates: ReleaseCandidate[]; warning?: string }> {
  const endpoint = "https://api.pokemontcg.io/v2/sets?orderBy=releaseDate&pageSize=250";
  try {
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        ...(process.env.POKEMON_TCG_API_KEY ? { "X-Api-Key": process.env.POKEMON_TCG_API_KEY } : {})
      },
      next: { revalidate: 60 * 60 * 12 }
    });
    if (!response.ok) {
      return { candidates: [], warning: `Pokemon TCG API returned ${response.status}.` };
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; series?: string; releaseDate?: string; total?: number; printedTotal?: number }>;
    };
    const { start, end } = releaseYearWindow();
    const candidates = (payload.data ?? [])
      .map((set): ReleaseCandidate | null => {
        const date = parseReleaseDate(set.releaseDate);
        if (!date || date < start || date > end || !set.name) return null;
        const setLink = set.id ? `https://pokemontcg.io/sets/${encodeURIComponent(set.id)}` : "https://pokemontcg.io/";
        return {
          setName: set.name,
          releaseName: set.name,
          productType: "Expansion",
          releaseType: "expansion",
          officialReleaseDate: date,
          preorderDate: null,
          preorderWindowText: null,
          region: "US",
          retailer: null,
          productTypes: "Booster packs, Elite Trainer Boxes, booster bundles, collection products",
          productImage: null,
          productUrl: setLink,
          productLinks: setLink,
          priority: priorityForRelease(date),
          sourceUrl: setLink,
          sourceName: "Pokemon TCG API",
          sourceType: "official",
          confidence: "HIGH",
          status: releaseStatus(date),
          needsReview: false,
          reviewReason: null,
          notes: releaseNotes("Pokemon TCG API", [
            set.series ? `Series: ${set.series}.` : "",
            set.total ? `${set.total} cards tracked by the API.` : ""
          ].filter(Boolean))
        } satisfies ReleaseCandidate;
      })
      .filter((candidate): candidate is ReleaseCandidate => Boolean(candidate));
    return { candidates };
  } catch (error) {
    return { candidates: [], warning: error instanceof Error ? error.message : "Pokemon TCG API fetch failed." };
  }
}

function releaseFeedUrls() {
  return (process.env.POKEMON_RELEASE_FEED_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function extractDateFromText(text: string) {
  const iso = text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  if (iso) return parseReleaseDate(iso);
  const monthDate = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  return monthDate ? parseReleaseDate(monthDate) : null;
}

function tagValue(input: string, tag: string) {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
}

function linkValue(input: string) {
  return tagValue(input, "link") || input.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
}

async function fetchConfiguredFeeds(): Promise<{ candidates: ReleaseCandidate[]; warnings: string[] }> {
  const urls = releaseFeedUrls();
  const warnings: string[] = [];
  const candidates: ReleaseCandidate[] = [];
  const { start, end } = releaseYearWindow();

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { accept: "application/rss+xml, application/json, text/xml, text/plain" } });
      if (!response.ok) {
        warnings.push(`${url} returned ${response.status}.`);
        continue;
      }
      const text = await response.text();
      const items = text.trim().startsWith("[") || text.trim().startsWith("{")
        ? (Array.isArray(JSON.parse(text)) ? JSON.parse(text) : JSON.parse(text).items ?? JSON.parse(text).data ?? [])
        : Array.from(text.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)).map((match) => ({
            title: tagValue(match[0], "title"),
            link: linkValue(match[0]),
            content: `${tagValue(match[0], "description")} ${tagValue(match[0], "summary")} ${tagValue(match[0], "content")}`
          }));

      for (const raw of items as Array<Record<string, unknown>>) {
        const title = String(raw.title ?? raw.name ?? "");
        const content = String(raw.content ?? raw.description ?? raw.summary ?? "");
        const link = String(raw.link ?? raw.url ?? raw.productUrl ?? "");
        const combined = `${title} ${content}`;
        if (!/pok[eé]mon|tcg|trading card/i.test(combined)) continue;
        const date = parseReleaseDate(raw.releaseDate) ?? parseReleaseDate(raw.date) ?? extractDateFromText(combined);
        if (date && (date < start || date > end)) continue;
        candidates.push({
          setName: title.replace(/\s+-\s+.*$/, "").trim() || "Pokemon TCG Release",
          releaseName: title.replace(/\s+-\s+.*$/, "").trim() || "Pokemon TCG Release",
          productType: "News",
          releaseType: /preorder/i.test(combined) ? "preorder_window" : "product_drop",
          officialReleaseDate: date,
          preorderDate: parseReleaseDate(raw.preorderDate) ?? (/preorder/i.test(combined) ? date : null),
          preorderWindowText: /preorder/i.test(combined) ? "Preorder window mentioned by configured feed" : null,
          region: String(raw.region ?? "US"),
          retailer: typeof raw.retailer === "string" ? raw.retailer : null,
          productTypes: "Release news, product drop, preorder window",
          productImage: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
          productUrl: link || url,
          productLinks: link || url,
          priority: priorityForRelease(date),
          sourceUrl: link || url,
          sourceName: `Configured release feed`,
          sourceType: "configured_feed",
          confidence: date ? "MEDIUM" : "LOW",
          status: releaseStatus(date),
          needsReview: !date,
          reviewReason: date ? null : "Configured feed item did not include a verified release date.",
          notes: releaseNotes(`release news feed ${url}`, [content.slice(0, 220)])
        });
      }
    } catch (error) {
      warnings.push(`${url} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { candidates, warnings };
}

function mergeCandidates(candidates: ReleaseCandidate[]) {
  const byName = new Map<string, ReleaseCandidate>();
  for (const candidate of candidates) {
    const key = normalizeReleaseName(candidate.setName);
    const existing = byName.get(key);
    if (!existing || (candidate.officialReleaseDate && (!existing.officialReleaseDate || candidate.officialReleaseDate < existing.officialReleaseDate))) {
      byName.set(key, candidate);
    }
  }
  return Array.from(byName.values()).sort((a, b) => (a.officialReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.officialReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER));
}

function mergeLinks(existing: string | null, next: string | null) {
  const links = [existing, next]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s*,\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(links)).join(", ") || null;
}

export async function syncReleaseCalendarFromPublicSources(): Promise<ReleaseSyncResult> {
  const checkedAt = new Date().toISOString();
  const [api, feeds] = await Promise.all([fetchPokemonTcgSets(), fetchConfiguredFeeds()]);
  const warnings = [api.warning, ...feeds.warnings].filter((warning): warning is string => Boolean(warning));
  const sources = [...officialSources, ...releaseFeedUrls()];
  const candidates = mergeCandidates([...api.candidates, ...feeds.candidates]);
  const existing = await prisma.release.findMany();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const actions: ReleaseSyncResult["candidates"] = [];
  const reviewQueue: ReleaseSyncResult["reviewQueue"] = [];

  for (const candidate of candidates) {
    const key = normalizeReleaseName(candidate.setName);
    const match = existing.find((release) => normalizeReleaseName(release.setName) === key);
    if (!match) {
      await prisma.release.create({
        data: {
          setName: candidate.setName,
          releaseName: candidate.releaseName,
          productType: candidate.productType,
          releaseType: candidate.releaseType,
          officialReleaseDate: candidate.officialReleaseDate,
          preorderDate: candidate.preorderDate ?? null,
          preorderWindowText: candidate.preorderWindowText ?? null,
          region: candidate.region,
          retailer: candidate.retailer ?? null,
          productTypes: candidate.productTypes,
          pokemonCenterExclusiveVersion: false,
          productImage: candidate.productImage ?? null,
          productUrl: candidate.productUrl ?? null,
          chaseCards: null,
          demandRating: candidate.priority,
          estimatedDemand: candidate.priority,
          priority: candidate.priority,
          sealedProductPriority: candidate.priority,
          notes: candidate.notes,
          productLinks: candidate.productLinks,
          sourceUrl: candidate.sourceUrl,
          sourceName: candidate.sourceName,
          sourceType: candidate.sourceType,
          confidence: candidate.confidence,
          status: candidate.status,
          lastSyncedAt: new Date(checkedAt),
          createdByManualEntry: false,
          needsReview: candidate.needsReview,
          reviewReason: candidate.reviewReason ?? null
        }
      });
      created += 1;
      if (candidate.needsReview) reviewQueue.push({ setName: candidate.setName, reason: candidate.reviewReason || "Needs source review.", source: candidate.sourceName });
      await createReleaseSyncAlert(candidate, "created");
      actions.push({ setName: candidate.setName, releaseDate: candidate.officialReleaseDate?.toISOString() ?? "TBD", source: candidate.sourceName, confidence: candidate.confidence, needsReview: candidate.needsReview, action: "created" });
      continue;
    }

    const nextLinks = mergeLinks(match.productLinks, candidate.productLinks);
    const dateChanged = Boolean(match.officialReleaseDate && candidate.officialReleaseDate && match.officialReleaseDate.getTime() !== candidate.officialReleaseDate.getTime());
    const shouldUpdate =
      dateChanged ||
      !match.productType ||
      !match.productLinks?.includes(candidate.productLinks || "__no_link__") ||
      !match.notes?.includes("Auto-synced") ||
      match.sourceUrl !== candidate.sourceUrl ||
      match.productImage !== candidate.productImage;

    if (!shouldUpdate) {
      skipped += 1;
      actions.push({ setName: match.setName, releaseDate: match.officialReleaseDate?.toISOString() ?? "TBD", source: candidate.sourceName, confidence: candidate.confidence, needsReview: match.needsReview, action: "skipped" });
      continue;
    }

    await prisma.release.update({
      where: { id: match.id },
      data: {
        officialReleaseDate: candidate.officialReleaseDate,
        previousReleaseDate: dateChanged ? match.officialReleaseDate : match.previousReleaseDate,
        releaseName: match.releaseName || candidate.releaseName,
        productType: match.productType || candidate.productType,
        releaseType: match.releaseType || candidate.releaseType,
        preorderDate: match.preorderDate || candidate.preorderDate || null,
        preorderWindowText: match.preorderWindowText || candidate.preorderWindowText || null,
        region: match.region || candidate.region,
        retailer: match.retailer || candidate.retailer || null,
        productTypes: match.productTypes || candidate.productTypes,
        productImage: match.productImage || candidate.productImage || null,
        productUrl: match.productUrl || candidate.productUrl || null,
        productLinks: nextLinks,
        notes: match.notes?.includes("Auto-synced") ? candidate.notes : `${match.notes || ""}\n\n${candidate.notes}`.trim(),
        priority: match.priority || candidate.priority,
        estimatedDemand: match.estimatedDemand || candidate.priority,
        sealedProductPriority: match.sealedProductPriority || candidate.priority,
        sourceUrl: candidate.sourceUrl || match.sourceUrl,
        sourceName: candidate.sourceName || match.sourceName,
        sourceType: candidate.sourceType,
        confidence: candidate.confidence,
        status: candidate.status,
        lastSyncedAt: new Date(checkedAt),
        needsReview: candidate.needsReview,
        reviewReason: candidate.reviewReason ?? null
      }
    });
    updated += 1;
    if (candidate.needsReview) reviewQueue.push({ setName: candidate.setName, reason: candidate.reviewReason || "Needs source review.", source: candidate.sourceName });
    if (dateChanged) await createReleaseSyncAlert(candidate, "date_changed");
    actions.push({ setName: match.setName, releaseDate: candidate.officialReleaseDate?.toISOString() ?? "TBD", source: candidate.sourceName, confidence: candidate.confidence, needsReview: candidate.needsReview, action: "updated" });
  }

  if (!process.env.POKEMON_RELEASE_FEED_URLS) {
    warnings.push("POKEMON_RELEASE_FEED_URLS is not configured. Set feeds for product-drop news beyond core set releases.");
  }

  return {
    checkedAt,
    sources,
    created,
    updated,
    skipped,
    candidates: actions,
    reviewQueue,
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
