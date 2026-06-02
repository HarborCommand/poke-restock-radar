import { prisma } from "@/lib/db";
import type { InventoryItemDTO, MarketMatchCandidateDTO, MarketMatchReviewDTO, MarketSyncLogDTO, SessionUser } from "@/types/radar";

const POKEMON_CATEGORY_ID = 3;
const DEFAULT_TCGCSV_BASE_URL = "https://tcgcsv.com/tcgplayer";
const SEALED_KEYWORDS = [
  "booster bundle",
  "booster box",
  "elite trainer box",
  "etb",
  "premium collection",
  "checklane blister",
  "blister",
  "tin",
  "mini tin",
  "sleeved booster",
  "3 pack booster",
  "3-pack booster",
  "three booster blister",
  "collection box"
];

const GENERIC_PRODUCT_WORDS = new Set([
  "pokemon",
  "trading",
  "card",
  "game",
  "tcg",
  "english",
  "ean",
  "sku",
  "upc",
  "best",
  "buy",
  "target",
  "walmart",
  "gamestop",
  "amazon",
  "center",
  "product",
  "sealed",
  "pack",
  "packs"
]);

const PRODUCT_TYPE_ALIASES: Array<{ type: string; aliases: string[] }> = [
  { type: "premium_checklane_blister", aliases: ["premium checklane blister"] },
  { type: "checklane_blister", aliases: ["checklane blister"] },
  { type: "three_booster_blister", aliases: ["three booster blister", "3 booster blister", "3 pack booster", "3 pack blister", "3pk", "3 pk"] },
  { type: "elite_trainer_box", aliases: ["elite trainer box", "etb"] },
  { type: "booster_bundle", aliases: ["booster bundle", "bb"] },
  { type: "booster_box", aliases: ["booster box", "booster display box", "display box"] },
  { type: "sleeved_booster", aliases: ["sleeved booster", "sleeved pack"] },
  { type: "premium_collection", aliases: ["premium collection"] },
  { type: "collection_box", aliases: ["collection box", "ex box"] },
  { type: "mini_tin", aliases: ["mini tin"] },
  { type: "tin", aliases: ["poke ball tin", "pokeball tin", "tin"] },
  { type: "single_card", aliases: ["single card", "illustration rare", "secret rare", "promo card"] }
];

export type TcgcsvProviderStats = {
  enabled: boolean;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  productsCached: number;
  pricesCached: number;
  itemsMatched: number;
  itemsNeedingReview: number;
};

type TcgcsvGroup = {
  groupId: number;
  name: string;
};

type TcgcsvProductPayload = Record<string, unknown>;
type TcgcsvPricePayload = Record<string, unknown>;

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function tcgcsvEnabled() {
  return envValue("TCGCSV_ENABLED") === "true";
}

function tcgcsvBaseUrl() {
  return (envValue("TCGCSV_BASE_URL") || DEFAULT_TCGCSV_BASE_URL).replace(/\/+$/g, "");
}

function tcgcsvUrl(path: string) {
  return `${tcgcsvBaseUrl()}/${POKEMON_CATEGORY_ID}/${path.replace(/^\/+/g, "")}`;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

export function normalizeText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeProductText(value: string | null | undefined) {
  return (value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/PokÃ©mon/gi, "Pokemon")
    .replace(/PokÃ©/gi, "Poke")
    .replace(/â€“|â€”|–|—/g, "-")
    .replace(/â€™/g, "'")
    .replace(/Â·/g, "·");
}

function normalizeProductSynonyms(value: string) {
  return value
    .replace(/\bpok[eé]mon\b/gi, "pokemon")
    .replace(/\bpokemon\s+tcg\b/gi, "pokemon trading card game")
    .replace(/\btcg\b/gi, "trading card game")
    .replace(/\betb\b/gi, "elite trainer box")
    .replace(/\b3\s*pk\b/gi, "3 pack")
    .replace(/\b3\s*-\s*pack\b/gi, "3 pack")
    .replace(/\bthree\s*-\s*booster\b/gi, "three booster")
    .replace(/\bbb\b/gi, "booster bundle")
    .replace(/\bbooster display box\b/gi, "booster box")
    .replace(/\bpoke ball\b/gi, "pokeball");
}

function stripProductNoise(value: string) {
  return value
    .replace(/\bpokemon trading card game\s*:?\s*/gi, " ")
    .replace(/\bpokemon\s*:?\s*/gi, " ")
    .replace(/\bmega evolution\s*[-:]?\s*/gi, " ")
    .replace(/\bme\d+\s*:?\s*/gi, " ")
    .replace(/\benglish ean\s*:?\s*/gi, " ")
    .replace(/\bflygon english ean\s*:?\s*/gi, " ")
    .replace(/\b(best buy|target|walmart|gamestop|amazon|pokemon center)\b/gi, " ")
    .replace(/\bsku\s*:?\s*[a-z0-9-]+\b/gi, " ")
    .replace(/\bupc\s*:?\s*\d+\b/gi, " ")
    .replace(/\bean\s*:?\s*\d+\b/gi, " ")
    .replace(/\b\d{8,14}\b/g, " ");
}

export function normalizeTcgcsvProductText(value: string | null | undefined) {
  return stripProductNoise(normalizeProductSynonyms(decodeProductText(value)))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function richCompactText(value: string | null | undefined) {
  return normalizeTcgcsvProductText(value).replace(/\s+/g, "");
}

function tokenList(value: string | null | undefined) {
  return normalizeTcgcsvProductText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !GENERIC_PRODUCT_WORDS.has(token));
}

export function inferTcgcsvProductType(value: string | null | undefined) {
  const normalized = normalizeTcgcsvProductText(value);
  for (const entry of PRODUCT_TYPE_ALIASES) {
    if (entry.aliases.some((alias) => normalized.includes(normalizeTcgcsvProductText(alias)))) return entry.type;
  }
  return null;
}

function upcVariants(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.length === 12) variants.add(`0${digits}`);
  if (digits.length === 13 && digits.startsWith("0")) variants.add(digits.slice(1));
  return [...variants];
}

function productPayloadHasUpc(product: { extendedData?: string | null }, variants: string[]) {
  if (!product.extendedData || !variants.length) return false;
  const digitsOnly = product.extendedData.replace(/\D/g, " ");
  return variants.some((variant) => digitsOnly.includes(variant));
}

function productNameFromPayload(product: TcgcsvProductPayload) {
  return (
    toStringValue(product.name) ||
    toStringValue(product.productName) ||
    toStringValue(product.cleanName) ||
    toStringValue(product.cleanProductName) ||
    "Unknown TCGCSV product"
  );
}

function productIdFromPayload(row: Record<string, unknown>) {
  const value = row.productId ?? row.id ?? row.tcgplayerProductId;
  return value === null || value === undefined ? null : String(value);
}

function imageFromPayload(product: TcgcsvProductPayload) {
  return (
    toStringValue(product.imageUrl) ||
    toStringValue(product.image) ||
    toStringValue(product.imageURL) ||
    toStringValue(product.url)
  );
}

function productUrl(productId: string) {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(productId)}`;
}

async function fetchTcgcsvJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "PokeRadar/1.0 private-inventory-market-sync"
    },
    signal: AbortSignal.timeout(25000)
  });
  const payload = (await response.json().catch(() => ({}))) as T | { results?: T };
  if (!response.ok) throw new Error(`TCGCSV request failed with HTTP ${response.status} for ${url}`);
  if (Array.isArray((payload as { results?: unknown }).results)) return (payload as { results: T }).results;
  return payload as T;
}

async function fetchTcgcsvGroups() {
  const rows = await fetchTcgcsvJson<Array<Record<string, unknown>>>(tcgcsvUrl("groups"));
  return rows
    .map((row): TcgcsvGroup | null => {
      const groupId = toNumber(row.groupId ?? row.id);
      const name = toStringValue(row.name ?? row.groupName);
      return groupId && name ? { groupId, name } : null;
    })
    .filter((row): row is TcgcsvGroup => row !== null);
}

async function fetchTcgcsvProducts(groupId: number) {
  return fetchTcgcsvJson<TcgcsvProductPayload[]>(tcgcsvUrl(`${groupId}/products`));
}

async function fetchTcgcsvPrices(groupId: number) {
  return fetchTcgcsvJson<TcgcsvPricePayload[]>(tcgcsvUrl(`${groupId}/prices`));
}

function bestPriceFromRows(rows: TcgcsvPricePayload[]) {
  const marketRow = rows.find((row) => toNumber(row.marketPrice) !== null) ?? rows.find((row) => toNumber(row.midPrice) !== null) ?? rows[0];
  if (!marketRow) {
    return {
      marketPrice: null,
      lowPrice: null,
      midPrice: null,
      highPrice: null,
      directLowPrice: null,
      subTypeName: null
    };
  }
  return {
    marketPrice: toNumber(marketRow.marketPrice),
    lowPrice: toNumber(marketRow.lowPrice),
    midPrice: toNumber(marketRow.midPrice),
    highPrice: toNumber(marketRow.highPrice),
    directLowPrice: toNumber(marketRow.directLowPrice),
    subTypeName: toStringValue(marketRow.subTypeName)
  };
}

function estimateFromCachedProduct(product: {
  marketPrice: number | null;
  midPrice: number | null;
  lowPrice: number | null;
}) {
  return product.marketPrice ?? product.midPrice ?? product.lowPrice ?? null;
}

function matchConfidence(
  item: Pick<InventoryItemDTO, "itemName" | "setName" | "category" | "upc" | "sku" | "dpci" | "asin">,
  product: { productName: string; cleanProductName: string | null; normalizedName: string; groupName: string; extendedData?: string | null }
) {
  const itemName = normalizeTcgcsvProductText(item.itemName);
  const itemCompact = richCompactText(item.itemName);
  const setName = normalizeTcgcsvProductText(item.setName);
  const category = normalizeTcgcsvProductText(item.category);
  const productName = normalizeTcgcsvProductText(`${product.productName} ${product.cleanProductName || ""} ${product.groupName}`);
  const productCompact = richCompactText(product.productName);
  const groupName = normalizeTcgcsvProductText(product.groupName);
  const itemType = inferTcgcsvProductType(`${item.itemName} ${item.category}`);
  const productType = inferTcgcsvProductType(`${product.productName} ${product.cleanProductName || ""}`);
  const variants = [...upcVariants(item.upc), ...upcVariants(item.sku), ...upcVariants(item.dpci), ...upcVariants(item.asin)];
  let score = 0;
  const reasons: string[] = [];

  if (productPayloadHasUpc(product, variants)) {
    return { confidence: 100, reason: "exact UPC/identifier match in TCGCSV payload" };
  }

  if (itemCompact && productCompact === itemCompact) {
    score += 58;
    reasons.push("exact normalized product name");
  } else if (itemCompact && (productCompact.includes(itemCompact) || itemCompact.includes(productCompact))) {
    score += 48;
    reasons.push("product name contains match");
  } else {
    const itemTokens = tokenList(item.itemName);
    const productTokens = new Set(tokenList(`${product.productName} ${product.cleanProductName || ""} ${product.groupName}`));
    const overlap = itemTokens.filter((token) => productTokens.has(token)).length;
    score += Math.min(42, overlap * 7);
    if (overlap) reasons.push(`${overlap} shared name tokens`);
  }

  if (itemType && productType && itemType !== productType) {
    score -= 36;
    reasons.push(`type mismatch ${itemType} vs ${productType}`);
  } else if (itemType && productType === itemType) {
    score += 26;
    reasons.push(`${itemType.replace(/_/g, " ")} type match`);
  } else if (itemType && productName.includes(itemType.replace(/_/g, " "))) {
    score += 16;
    reasons.push("product type text match");
  }

  if (setName && (productName.includes(setName) || groupName.includes(setName) || setName.includes(groupName))) {
    score += 22;
    reasons.push("set/group match");
  } else if (setName) {
    const setTokens = tokenList(setName);
    const groupTokens = new Set(tokenList(groupName));
    const setOverlap = setTokens.filter((token) => groupTokens.has(token) || productName.includes(token)).length;
    score += Math.min(18, setOverlap * 6);
    if (setOverlap) reasons.push(`${setOverlap} set/group tokens`);
  }

  const matchedKeyword = SEALED_KEYWORDS.find((keyword) => itemName.includes(keyword) && productName.includes(keyword));
  if (matchedKeyword) {
    score += 10;
    reasons.push(`${matchedKeyword} keyword`);
  }

  if (category.includes("card") && productType !== "single_card" && productType) {
    score -= 30;
    reasons.push("single card category rejected sealed candidate");
  } else if ((category.includes("sealed") || category.includes("booster") || category.includes("box") || category.includes("tin")) && productType === "single_card") {
    score -= 35;
    reasons.push("sealed category rejected single-card candidate");
  }

  if (productName.includes("pokemon")) {
    score += 4;
    reasons.push("pokemon product");
  }

  return { confidence: Math.max(0, Math.min(100, Math.round(score))), reason: reasons.join(", ") || "weak fuzzy match" };
}

export async function getTcgcsvProviderStats(): Promise<TcgcsvProviderStats> {
  const [lastSuccess, lastError, productsCached, pricesCached, itemsMatched, itemsNeedingReview] = await Promise.all([
    prisma.tcgcsvSyncLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
    prisma.tcgcsvSyncLog.findFirst({ where: { status: "ERROR" }, orderBy: { startedAt: "desc" } }),
    prisma.tcgcsvProduct.count(),
    prisma.tcgcsvProduct.count({ where: { OR: [{ marketPrice: { not: null } }, { midPrice: { not: null } }, { lowPrice: { not: null } }] } }),
    prisma.inventoryItem.count({ where: { marketProvider: "TCGCSV", marketProviderMatchStatus: { in: ["MATCHED", "LOCKED"] } } }),
    prisma.inventoryItem.count({ where: { marketProvider: "TCGCSV", marketProviderMatchStatus: "REVIEW" } })
  ]);
  return {
    enabled: tcgcsvEnabled(),
    lastSuccessfulSyncAt: lastSuccess?.finishedAt?.toISOString() ?? lastSuccess?.startedAt.toISOString() ?? null,
    lastError: lastError?.error ?? null,
    productsCached,
    pricesCached,
    itemsMatched,
    itemsNeedingReview
  };
}

export async function syncTcgcsvCatalog(options: { limitGroups?: number } = {}) {
  if (!tcgcsvEnabled()) {
    throw new Error("TCGCSV is not enabled. Set TCGCSV_ENABLED=true.");
  }

  const syncLog = await prisma.tcgcsvSyncLog.create({
    data: { status: "RUNNING", message: "TCGCSV sync started." }
  });
  let groupsFetched = 0;
  let productsCached = 0;
  let pricesCached = 0;

  try {
    const groups = (await fetchTcgcsvGroups()).slice(0, options.limitGroups ?? undefined);
    for (const group of groups) {
      groupsFetched += 1;
      const [products, prices] = await Promise.all([fetchTcgcsvProducts(group.groupId), fetchTcgcsvPrices(group.groupId)]);
      const priceRowsByProduct = new Map<string, TcgcsvPricePayload[]>();
      for (const price of prices) {
        const productId = productIdFromPayload(price);
        if (!productId) continue;
        const current = priceRowsByProduct.get(productId) ?? [];
        current.push(price);
        priceRowsByProduct.set(productId, current);
      }

      const productIds = products.map(productIdFromPayload).filter((id): id is string => Boolean(id));
      if (productIds.length) {
        await prisma.tcgcsvProduct.deleteMany({ where: { tcgcsvProductId: { in: productIds } } });
      }

      const rows = products
        .map((product) => {
          const tcgcsvProductId = productIdFromPayload(product);
          if (!tcgcsvProductId) return null;
          const productName = productNameFromPayload(product);
          const cleanProductName = toStringValue(product.cleanName ?? product.cleanProductName);
          const price = bestPriceFromRows(priceRowsByProduct.get(tcgcsvProductId) ?? []);
          return {
            tcgcsvProductId,
            categoryId: POKEMON_CATEGORY_ID,
            groupId: group.groupId,
            groupName: group.name,
            productName,
            cleanProductName,
            normalizedName: normalizeTcgcsvProductText(`${productName} ${cleanProductName || ""} ${group.name}`),
            imageUrl: imageFromPayload(product),
            productUrl: productUrl(tcgcsvProductId),
            extendedData: JSON.stringify(product),
            ...price,
            lastSyncedAt: new Date()
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length) {
        await prisma.tcgcsvProduct.createMany({ data: rows });
        productsCached += rows.length;
        pricesCached += rows.filter((row) => estimateFromCachedProduct(row) !== null).length;
      }
    }

    await prisma.tcgcsvSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        groupsFetched,
        productsCached,
        pricesCached,
        message: `Cached ${productsCached} Pokemon products from ${groupsFetched} TCGCSV groups.`
      }
    });
    return { status: "SUCCESS" as const, groupsFetched, productsCached, pricesCached };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TCGCSV sync failed.";
    await prisma.tcgcsvSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "ERROR", finishedAt: new Date(), groupsFetched, productsCached, pricesCached, error: message, message }
    });
    throw error;
  }
}

export async function findTcgcsvCandidates(item: InventoryItemDTO, options: { limit?: number; query?: string; group?: string; productType?: string } = {}) {
  const limit = options.limit ?? 6;
  const searchBase = options.query || `${item.itemName} ${item.setName || ""} ${item.category || ""}`;
  const normalizedName = normalizeTcgcsvProductText(searchBase);
  const setName = normalizeTcgcsvProductText(options.group || item.setName);
  const itemType = options.productType || inferTcgcsvProductType(`${item.itemName} ${item.category}`);
  const terms = [...new Set([...tokenList(searchBase), ...tokenList(item.setName), ...(itemType ? itemType.split("_") : [])])]
    .filter((term) => term.length > 2)
    .slice(0, 14);
  const variants = [...new Set([...upcVariants(item.upc), ...upcVariants(item.sku), ...upcVariants(item.dpci), ...upcVariants(item.asin)])];
  const upcCandidates = variants.length
    ? await prisma.tcgcsvProduct.findMany({
        where: {
          AND: [
            { OR: variants.map((variant) => ({ extendedData: { contains: variant } })) },
            { OR: [{ marketPrice: { not: null } }, { midPrice: { not: null } }, { lowPrice: { not: null } }] }
          ]
        },
        orderBy: [{ lastSyncedAt: "desc" }],
        take: 20
      })
    : [];
  const searchOr = [
    ...(normalizedName ? [{ normalizedName: { contains: normalizedName } }] : []),
    ...(setName ? [{ groupName: { contains: options.group || item.setName || "" } }] : []),
    ...terms.map((term) => ({ normalizedName: { contains: term } })),
    ...terms.map((term) => ({ groupName: { contains: term } }))
  ];
  const fuzzyCandidates = searchOr.length
    ? await prisma.tcgcsvProduct.findMany({
        where: {
          AND: [
            { OR: searchOr },
            { OR: [{ marketPrice: { not: null } }, { midPrice: { not: null } }, { lowPrice: { not: null } }] }
          ]
        },
        orderBy: [{ lastSyncedAt: "desc" }],
        take: 140
      })
    : [];
  const byId = new Map([...upcCandidates, ...fuzzyCandidates].map((candidate) => [candidate.tcgcsvProductId, candidate]));
  const compactName = richCompactText(item.itemName);
  return [...byId.values()]
    .map((candidate) => ({ candidate, ...matchConfidence(item, candidate) }))
    .filter((entry) => entry.confidence >= 45 || richCompactText(entry.candidate.productName).includes(compactName.slice(0, 18)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export async function findBestTcgcsvMatch(item: InventoryItemDTO) {
  if (item.marketProvider === "TCGCSV" && item.marketProviderProductId) {
    const locked = await prisma.tcgcsvProduct.findUnique({ where: { tcgcsvProductId: item.marketProviderProductId } });
    if (locked) {
      return {
        product: locked,
        confidence: item.marketProviderMatchStatus === "LOCKED" ? 100 : Math.max(item.marketProviderConfidenceScore, 90),
        reason: item.marketProviderMatchReason || "locked TCGCSV product ID"
      };
    }
  }

  const scored = await findTcgcsvCandidates(item, { limit: 1 });
  return scored[0] ? { product: scored[0].candidate, confidence: scored[0].confidence, reason: scored[0].reason } : null;
}

function marketStatusFromConfidence(confidence: number) {
  if (confidence >= 85) return "MATCHED";
  if (confidence >= 50) return "REVIEW";
  return "UNMATCHED";
}

function confidenceLabel(confidence: number) {
  if (confidence >= 85) return "HIGH";
  if (confidence >= 70) return "MEDIUM";
  if (confidence >= 50) return "LOW";
  return "NONE";
}

export async function applyTcgcsvEstimateToInventoryItem(currentUser: SessionUser, item: InventoryItemDTO) {
  if (!tcgcsvEnabled()) {
    return {
      status: "MANUAL_MODE" as const,
      item,
      message: "TCGCSV is not enabled. Set TCGCSV_ENABLED=true to use automatic market estimates.",
      matchedProduct: null,
      priceFound: null,
      confidence: null
    };
  }

  const match = await findBestTcgcsvMatch(item);
  if (!match) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderMatchStatus: "UNMATCHED",
        marketProviderConfidenceScore: 0,
        marketProviderMatchReason: "No TCGCSV product matched the saved name/set/category.",
        marketProviderLastPricedAt: new Date()
      }
    });
    return {
      status: "MISSING" as const,
      item,
      message: "No TCGCSV product match found.",
      matchedProduct: null,
      priceFound: null,
      confidence: null
    };
  }

  const price = estimateFromCachedProduct(match.product);
  const status = marketStatusFromConfidence(match.confidence);
  if (status === "REVIEW") {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: match.product.tcgcsvProductId,
        marketProviderProductName: match.product.productName,
        marketProviderMatchStatus: "REVIEW",
        marketProviderConfidenceScore: match.confidence,
        marketProviderMatchReason: match.reason,
        marketProviderMatchedAt: new Date(),
        marketProviderLastPricedAt: new Date()
      }
    });
    return {
      status: "LOW_CONFIDENCE" as const,
      item,
      message: `Possible TCGCSV match needs review: ${match.reason}.`,
      matchedProduct: match.product.productName,
      priceFound: price,
      confidence: match.confidence
    };
  }

  if (!price) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: match.product.tcgcsvProductId,
        marketProviderProductName: match.product.productName,
        marketProviderMatchStatus: "MATCHED",
        marketProviderConfidenceScore: match.confidence,
        marketProviderMatchReason: `${match.reason}; no market price available.`,
        marketProviderMatchedAt: new Date(),
        marketProviderLastPricedAt: new Date(),
        currentMarketEstimate: null,
        marketAverageSalePrice: null,
        marketCompCount: 0,
        marketLastRefreshedAt: new Date(),
        marketConfidence: "NONE"
      }
    });
    return {
      status: "MISSING" as const,
      item,
      message: "TCGCSV match found, but market price was not collected.",
      matchedProduct: match.product.productName,
      priceFound: null,
      confidence: match.confidence
    };
  }

  await prisma.inventoryMarketComp.deleteMany({ where: { inventoryItemId: item.id, sourceQuality: "TCGCSV_ESTIMATE" } });
  await prisma.inventoryMarketComp.create({
    data: {
      inventoryItemId: item.id,
      saleTitle: match.product.productName,
      salePrice: price,
      soldAt: new Date(),
      sourceUrl: match.product.productUrl,
      sourceQuality: "TCGCSV_ESTIMATE",
      matchScore: match.confidence,
      notes: `TCGCSV Market Estimate. Not a sold comp. Group: ${match.product.groupName}. ${match.reason}.`
    }
  });
  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      marketProvider: "TCGCSV",
      marketProviderProductId: match.product.tcgcsvProductId,
      marketProviderProductName: match.product.productName,
      marketProviderMatchStatus: item.marketProviderMatchStatus === "LOCKED" ? "LOCKED" : "MATCHED",
      marketProviderConfidenceScore: match.confidence,
      marketProviderMatchReason: match.reason,
      marketProviderMatchedAt: new Date(),
      marketProviderLastPricedAt: new Date(),
      currentMarketEstimate: price,
      marketAverageSalePrice: price,
      marketCompCount: 1,
      marketLastRefreshedAt: new Date(),
      marketConfidence: confidenceLabel(match.confidence)
    }
  });
  return {
    status: "PRICED" as const,
    item,
    message: `TCGCSV estimated ${item.itemName} at $${price.toFixed(2)} with ${match.confidence}% confidence.`,
    matchedProduct: match.product.productName,
    priceFound: price,
    confidence: match.confidence
  };
}

function tcgcsvCandidateToDTO(entry: Awaited<ReturnType<typeof findTcgcsvCandidates>>[number]): MarketMatchCandidateDTO {
  return {
    providerProductId: entry.candidate.tcgcsvProductId,
    productName: entry.candidate.productName,
    groupName: entry.candidate.groupName,
    imageUrl: entry.candidate.imageUrl,
    productUrl: entry.candidate.productUrl,
    marketPrice: estimateFromCachedProduct(entry.candidate),
    lowPrice: entry.candidate.lowPrice,
    midPrice: entry.candidate.midPrice,
    highPrice: entry.candidate.highPrice,
    confidence: entry.confidence,
    reason: entry.reason
  };
}

export async function searchTcgcsvCandidatesForItem(
  item: InventoryItemDTO,
  options: { limit?: number; query?: string; group?: string; productType?: string } = {}
): Promise<MarketMatchCandidateDTO[]> {
  const candidates = await findTcgcsvCandidates(item, { limit: options.limit ?? 8, query: options.query, group: options.group, productType: options.productType });
  return candidates.map(tcgcsvCandidateToDTO);
}

export async function listTcgcsvMatchReview(items: InventoryItemDTO[]): Promise<MarketMatchReviewDTO[]> {
  const reviewItems = items.filter(
    (item) =>
      item.quantityOwned > 0 &&
      item.marketProvider === "TCGCSV" &&
      ["REVIEW", "UNMATCHED", "ERROR"].includes(item.marketProviderMatchStatus)
  );
  return Promise.all(
    reviewItems.map(async (item) => {
      const product = item.marketProviderProductId
        ? await prisma.tcgcsvProduct.findUnique({ where: { tcgcsvProductId: item.marketProviderProductId } })
        : null;
      const candidates = product
        ? [
            {
              candidate: product,
              confidence: item.marketProviderConfidenceScore,
              reason: item.marketProviderMatchReason || "saved TCGCSV candidate"
            }
          ]
        : await findTcgcsvCandidates(item, { limit: 4 });
      return {
        inventoryItemId: item.id,
        itemName: item.itemName,
        itemImageUrl: item.imageUrl,
        quantityOwned: item.quantityOwned,
        averageCost: item.averageCost,
        setName: item.setName,
        category: item.category,
        upc: item.upc,
        provider: "TCGCSV" as const,
        providerProductId: item.marketProviderProductId,
        providerProductName: item.marketProviderProductName,
        providerGroupName: product?.groupName ?? null,
        providerImageUrl: product?.imageUrl ?? null,
        providerProductUrl: product?.productUrl ?? null,
        marketPrice: product ? estimateFromCachedProduct(product) : item.currentMarketEstimate,
        confidence: item.marketProviderConfidenceScore,
        reason: item.marketProviderMatchReason,
        status: item.marketProviderMatchStatus,
        lastRefreshedAt: item.marketProviderLastPricedAt,
        candidates: candidates.map(tcgcsvCandidateToDTO)
      };
    })
  );
}

export async function updateTcgcsvMatch(
  currentUser: SessionUser,
  itemId: string,
  action: "accept" | "reject" | "lock" | "search_again" | "mark_unmatched",
  providerProductId?: string | null
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: {
      stockLots: true,
      sales: true,
      marketComps: true,
      product: { include: { retailer: true } },
      card: true
    }
  });
  if (!item) throw new Error("Inventory item not found");
  if (action === "mark_unmatched") {
    await prisma.inventoryMarketComp.deleteMany({ where: { inventoryItemId: item.id, sourceQuality: "TCGCSV_ESTIMATE" } });
    return prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: null,
        marketProviderProductName: null,
        marketProviderMatchStatus: "UNMATCHED",
        marketProviderConfidenceScore: 0,
        marketProviderMatchReason: "Marked unmatched by admin.",
        currentMarketEstimate: null,
        marketAverageSalePrice: null,
        marketCompCount: 0,
        marketConfidence: "NONE"
      }
    });
  }
  if (action === "reject") {
    await prisma.inventoryMarketComp.deleteMany({ where: { inventoryItemId: item.id, sourceQuality: "TCGCSV_ESTIMATE" } });
    return prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: null,
        marketProviderProductName: null,
        marketProviderMatchStatus: "REJECTED",
        marketProviderConfidenceScore: 0,
        marketProviderMatchReason: "Rejected by admin.",
        currentMarketEstimate: null,
        marketAverageSalePrice: null,
        marketCompCount: 0,
        marketConfidence: "NONE"
      }
    });
  }
  const selectedProduct = providerProductId
    ? await prisma.tcgcsvProduct.findUnique({ where: { tcgcsvProductId: providerProductId } })
    : null;
  if (providerProductId && !selectedProduct) throw new Error("Selected TCGCSV product was not found.");
  if (selectedProduct) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: selectedProduct.tcgcsvProductId,
        marketProviderProductName: selectedProduct.productName,
        marketProviderMatchStatus: action === "lock" ? "LOCKED" : "MATCHED",
        marketProviderConfidenceScore: action === "lock" ? 100 : Math.max(item.marketProviderConfidenceScore, 90),
        marketProviderMatchReason: `Manual TCGCSV match selected: ${selectedProduct.groupName}.`,
        marketProviderMatchedAt: new Date()
      }
    });
  }
  const dto = {
    id: item.id,
    itemName: item.itemName,
    setName: item.setName,
    category: item.category,
    upc: item.upc,
    sku: item.sku,
    dpci: item.dpci,
    asin: item.asin,
    marketProvider: "TCGCSV",
    marketProviderProductId: selectedProduct?.tcgcsvProductId ?? item.marketProviderProductId,
    marketProviderMatchStatus: action === "lock" ? "LOCKED" : item.marketProviderMatchStatus,
    marketProviderConfidenceScore: selectedProduct ? Math.max(item.marketProviderConfidenceScore, action === "lock" ? 100 : 90) : item.marketProviderConfidenceScore
  } as InventoryItemDTO;
  if (action === "search_again") {
    await prisma.inventoryMarketComp.deleteMany({ where: { inventoryItemId: item.id, sourceQuality: "TCGCSV_ESTIMATE" } });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderProductId: null,
        marketProviderProductName: null,
        marketProviderMatchStatus: "UNMATCHED",
        marketProviderConfidenceScore: 0,
        marketProviderMatchReason: "Queued for search again."
      }
    });
  } else if (action === "lock" || action === "accept") {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        marketProvider: "TCGCSV",
        marketProviderMatchStatus: action === "lock" ? "LOCKED" : "MATCHED",
        marketProviderConfidenceScore: Math.max(item.marketProviderConfidenceScore, action === "lock" ? 100 : 90),
        marketProviderMatchedAt: new Date()
      }
    });
  }
  return applyTcgcsvEstimateToInventoryItem(currentUser, dto);
}

export function tcgcsvMarketLog(result: Awaited<ReturnType<typeof applyTcgcsvEstimateToInventoryItem>>, item: InventoryItemDTO): MarketSyncLogDTO {
  return {
    provider: "TCGCSV",
    inventoryItemId: item.id,
    itemName: item.itemName,
    status: result.status,
    matchedProduct: result.matchedProduct,
    priceFound: result.priceFound,
    confidence: result.confidence,
    message: result.message,
    createdAt: new Date().toISOString()
  };
}
