import { prisma } from "@/lib/db";
import { daysUntil } from "@/lib/calculations";

type ReleaseCandidate = {
  setName: string;
  productType: string;
  officialReleaseDate: Date;
  productTypes: string;
  productLinks: string | null;
  notes: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
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
    action: "created" | "updated" | "skipped";
  }>;
  warnings: string[];
};

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

function priorityForRelease(date: Date) {
  const remaining = daysUntil(date);
  if (remaining >= 0 && remaining <= 45) return "HIGH";
  if (remaining >= 0 && remaining <= 120) return "MEDIUM";
  return "LOW";
}

function releaseNotes(source: string, extra: string[] = []) {
  return [`Auto-synced from ${source}. Verify regional product dates before chasing drops.`, ...extra].join(" ");
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
          productType: "Expansion",
          officialReleaseDate: date,
          productTypes: "Booster packs, Elite Trainer Boxes, booster bundles, collection products",
          productLinks: setLink,
          priority: priorityForRelease(date),
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
        if (!date || date < start || date > end) continue;
        candidates.push({
          setName: title.replace(/\s+-\s+.*$/, "").trim() || "Pokemon TCG Release",
          productType: "News",
          officialReleaseDate: date,
          productTypes: "Release news, product drop, preorder window",
          productLinks: link || url,
          priority: priorityForRelease(date),
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
    if (!existing || candidate.officialReleaseDate < existing.officialReleaseDate) {
      byName.set(key, candidate);
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.officialReleaseDate.getTime() - b.officialReleaseDate.getTime());
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
  const sources = ["Pokemon TCG API", ...releaseFeedUrls()];
  const candidates = mergeCandidates([...api.candidates, ...feeds.candidates]);
  const existing = await prisma.release.findMany();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const actions: ReleaseSyncResult["candidates"] = [];

  for (const candidate of candidates) {
    const key = normalizeReleaseName(candidate.setName);
    const match = existing.find((release) => normalizeReleaseName(release.setName) === key);
    if (!match) {
      await prisma.release.create({
        data: {
          setName: candidate.setName,
          productType: candidate.productType,
          officialReleaseDate: candidate.officialReleaseDate,
          productTypes: candidate.productTypes,
          pokemonCenterExclusiveVersion: false,
          chaseCards: null,
          demandRating: candidate.priority,
          estimatedDemand: candidate.priority,
          priority: candidate.priority,
          sealedProductPriority: candidate.priority,
          notes: candidate.notes,
          productLinks: candidate.productLinks
        }
      });
      created += 1;
      actions.push({ setName: candidate.setName, releaseDate: candidate.officialReleaseDate.toISOString(), source: "public", action: "created" });
      continue;
    }

    const nextLinks = mergeLinks(match.productLinks, candidate.productLinks);
    const shouldUpdate =
      match.officialReleaseDate.getTime() !== candidate.officialReleaseDate.getTime() ||
      !match.productType ||
      !match.productLinks?.includes(candidate.productLinks || "__no_link__") ||
      !match.notes?.includes("Auto-synced");

    if (!shouldUpdate) {
      skipped += 1;
      actions.push({ setName: match.setName, releaseDate: match.officialReleaseDate.toISOString(), source: "public", action: "skipped" });
      continue;
    }

    await prisma.release.update({
      where: { id: match.id },
      data: {
        officialReleaseDate: candidate.officialReleaseDate,
        productType: match.productType || candidate.productType,
        productTypes: match.productTypes || candidate.productTypes,
        productLinks: nextLinks,
        notes: match.notes?.includes("Auto-synced") ? candidate.notes : `${match.notes || ""}\n\n${candidate.notes}`.trim(),
        priority: match.priority || candidate.priority,
        estimatedDemand: match.estimatedDemand || candidate.priority,
        sealedProductPriority: match.sealedProductPriority || candidate.priority
      }
    });
    updated += 1;
    actions.push({ setName: match.setName, releaseDate: candidate.officialReleaseDate.toISOString(), source: "public", action: "updated" });
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
    warnings
  };
}
