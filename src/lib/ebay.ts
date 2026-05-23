import type { EbayConnectionStatusDTO, GradeType } from "@/types/radar";

export type EbayCompMode = "api" | "manual";

export type EbaySearchTuning = {
  includeWords?: string | null;
  excludeWords?: string | null;
  exactSetName?: boolean;
  cardNumberRequired?: boolean;
  rawKeywords?: string | null;
  psa9Keywords?: string | null;
  psa10Keywords?: string | null;
  allowNonEnglish?: boolean;
};

export type EbayCompletedSale = {
  saleTitle: string;
  salePrice: number;
  soldAt: Date;
  sourceUrl: string | null;
  gradeType: GradeType;
  matchScore: number;
  conditionNotes: string;
};

export type EbayInventoryCompletedSale = {
  saleTitle: string;
  salePrice: number;
  soldAt: Date;
  sourceUrl: string | null;
  matchScore: number;
  notes: string;
};

type EbayConfig = {
  clientId: string;
  clientSecret: string;
  environment: "production" | "sandbox";
  marketplaceId: string;
};

const gradeQueries: Array<{ gradeType: GradeType; suffix: string; fallbackKeywords: string }> = [
  { gradeType: "RAW", suffix: "raw ungraded", fallbackKeywords: "raw, ungraded" },
  { gradeType: "PSA_9", suffix: "PSA 9", fallbackKeywords: "PSA 9, PSA Mint 9" },
  { gradeType: "PSA_10", suffix: "PSA 10", fallbackKeywords: "PSA 10, PSA Gem Mint 10" },
  { gradeType: "BGS_9_5", suffix: "BGS 9.5", fallbackKeywords: "BGS 9.5, Beckett 9.5" },
  { gradeType: "BGS_10", suffix: "BGS 10", fallbackKeywords: "BGS 10, Beckett 10" },
  { gradeType: "BGS_BLACK_LABEL", suffix: "BGS Black Label", fallbackKeywords: "BGS Black Label, Beckett Black Label" }
];

const hardRejectWords = [
  "lot",
  "lots",
  "bundle",
  "proxy",
  "proxies",
  "digital",
  "online code",
  "code card",
  "jumbo",
  "oversized",
  "custom",
  "orica",
  "fan art",
  "sticker",
  "metal card",
  "gold card"
];

const nonEnglishCues = [
  "japanese",
  "korean",
  "chinese",
  "spanish",
  "german",
  "french",
  "italian",
  "thai",
  "indonesian",
  "portuguese"
];

function configuredEnvironment() {
  const value = process.env.EBAY_ENVIRONMENT?.trim().toLowerCase();
  return value === "sandbox" ? "sandbox" : "production";
}

function ebayConfig(): EbayConfig | null {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  const environment = process.env.EBAY_ENVIRONMENT?.trim();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID?.trim();
  if (!clientId || !clientSecret || !environment || !marketplaceId) return null;
  return {
    clientId,
    clientSecret,
    environment: configuredEnvironment(),
    marketplaceId
  };
}

function maskSecret(value: string | undefined, label: string) {
  if (!value) return "Missing";
  if (label === "EBAY_ENVIRONMENT" || label === "EBAY_MARKETPLACE_ID") return value;
  if (value.length <= 8) return "Configured";
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

export function ebayConnectionStatus(): EbayConnectionStatusDTO {
  const environment = configuredEnvironment();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID?.trim() || "Not configured";
  const variables = (["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_ENVIRONMENT", "EBAY_MARKETPLACE_ID"] as const).map((name) => {
    const value = process.env[name]?.trim();
    return {
      name,
      configured: Boolean(value),
      masked: maskSecret(value, name)
    };
  });
  const ready = variables.every((variable) => variable.configured);
  return {
    mode: ready ? "api" : "manual",
    ready,
    environment,
    marketplaceId,
    variables,
    message: ready
      ? `eBay Marketplace Insights is configured for ${marketplaceId}.`
      : "Manual comp mode. Add all eBay credentials to enable live last-3 completed sales refreshes."
  };
}

export function ebayMode(): EbayCompMode {
  return ebayConnectionStatus().ready ? "api" : "manual";
}

function apiHost(config: EbayConfig) {
  return config.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

async function ebayAccessToken(config: EbayConfig) {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${apiHost(config)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
    }),
    signal: AbortSignal.timeout(12000)
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `eBay OAuth failed with HTTP ${response.status}`);
  }
  return body.access_token;
}

export async function testEbayConnection() {
  const status = ebayConnectionStatus();
  const config = ebayConfig();
  if (!config) {
    return {
      ok: false,
      status,
      message: "eBay API credentials are incomplete. The app will stay in manual comp mode."
    };
  }

  try {
    await ebayAccessToken(config);
    return {
      ok: true,
      status,
      message: `Connected to eBay ${config.marketplaceId} in ${config.environment} mode.`
    };
  } catch (error) {
    return {
      ok: false,
      status,
      message: error instanceof Error ? error.message : "eBay connection test failed."
    };
  }
}

function numberFromAmount(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const amount = Number((value as { value?: string | number }).value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function dateFromSale(item: Record<string, unknown>) {
  const dateValue =
    (typeof item.itemEndDate === "string" && item.itemEndDate) ||
    (typeof item.lastSoldDate === "string" && item.lastSoldDate) ||
    (typeof item.soldDate === "string" && item.soldDate) ||
    "";
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function itemUrl(item: Record<string, unknown>) {
  return (
    (typeof item.itemWebUrl === "string" && item.itemWebUrl) ||
    (typeof item.itemAffiliateWebUrl === "string" && item.itemAffiliateWebUrl) ||
    null
  );
}

function words(value: string | null | undefined) {
  return (value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9./\s-]+/g, " ").replace(/\s+/g, " ").trim();
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function significantTokens(value: string) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !["the", "and", "with", "card", "pokemon"].includes(token));
}

function titleContainsPhrase(title: string, phrase: string) {
  const normalizedTitle = normalize(title);
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return true;
  return normalizedTitle.includes(normalizedPhrase);
}

function titleContainsAllTokens(title: string, value: string) {
  const normalizedTitle = normalize(title);
  const tokens = significantTokens(value);
  return tokens.length === 0 || tokens.every((token) => normalizedTitle.includes(token));
}

function cardNumberVariants(cardNumber: string) {
  const normalized = cardNumber.trim();
  const variants = new Set<string>([normalized, compact(normalized)]);
  const match = normalized.match(/^0*(\d+)\s*\/\s*0*(\d+)$/);
  if (match) {
    variants.add(`${Number(match[1])}/${Number(match[2])}`);
    variants.add(`${Number(match[1])}${Number(match[2])}`);
  }
  return [...variants].filter(Boolean);
}

function titleHasCardNumber(title: string, cardNumber: string) {
  const normalizedTitle = normalize(title);
  const compactTitle = compact(title);
  return cardNumberVariants(cardNumber).some((variant) => normalizedTitle.includes(normalize(variant)) || compactTitle.includes(compact(variant)));
}

function includesTerm(title: string, term: string) {
  const normalizedTitle = ` ${normalize(title)} `;
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return true;
  if (normalizedTerm.includes(" ")) return normalizedTitle.includes(` ${normalizedTerm} `);
  return new RegExp(`\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalizedTitle);
}

function titleLooksNonEnglish(title: string) {
  const normalizedTitle = normalize(title);
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(title) || nonEnglishCues.some((cue) => normalizedTitle.includes(cue));
}

function gradeMatches(title: string, gradeType: GradeType) {
  const normalizedTitle = normalize(title);
  const hasPsa = /\bpsa\b/.test(normalizedTitle);
  const hasBgs = /\bbgs\b|\bbeckett\b/.test(normalizedTitle);
  if (gradeType === "RAW") return !/\bpsa\b|\bbgs\b|\bbeckett\b|\bcgc\b|\bgraded\b|\bslab\b|black label/.test(normalizedTitle);
  if (gradeType === "PSA_9") return hasPsa && /\b9\b/.test(normalizedTitle) && !/\b10\b/.test(normalizedTitle);
  if (gradeType === "PSA_10") return hasPsa && /\b10\b/.test(normalizedTitle);
  if (gradeType === "BGS_9_5") return hasBgs && (/\b9\.5\b/.test(normalizedTitle) || normalizedTitle.includes("9 5"));
  if (gradeType === "BGS_10") return hasBgs && /\b10\b/.test(normalizedTitle) && !normalizedTitle.includes("black label");
  return hasBgs && normalizedTitle.includes("black label");
}

function matchScoreForTitle(title: string, card: { cardName: string; setName: string; cardNumber: string }, gradeSuffix: string) {
  const normalized = normalize(title);
  const tokens = [card.cardName, card.setName, card.cardNumber, gradeSuffix]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9.]+/))
    .filter((value) => value.length >= 2);
  const unique = [...new Set(tokens)];
  const matched = unique.filter((token) => normalized.includes(token)).length;
  return unique.length ? Math.round((matched / unique.length) * 100) : 0;
}

function gradeKeywords(gradeType: GradeType, tuning: EbaySearchTuning) {
  if (gradeType === "RAW" && tuning.rawKeywords) return tuning.rawKeywords;
  if (gradeType === "PSA_9" && tuning.psa9Keywords) return tuning.psa9Keywords;
  if (gradeType === "PSA_10" && tuning.psa10Keywords) return tuning.psa10Keywords;
  return gradeQueries.find((grade) => grade.gradeType === gradeType)?.fallbackKeywords || "";
}

function assessSaleQuality(input: {
  title: string;
  card: { cardName: string; setName: string; cardNumber: string };
  gradeType: GradeType;
  gradeSuffix: string;
  tuning: EbaySearchTuning;
}) {
  const reasons: string[] = [];
  const title = input.title;
  for (const term of hardRejectWords) {
    if (includesTerm(title, term)) reasons.push(`Rejected ${term}`);
  }
  for (const term of words(input.tuning.excludeWords)) {
    if (includesTerm(title, term)) reasons.push(`Excluded word: ${term}`);
  }
  if (!input.tuning.allowNonEnglish && titleLooksNonEnglish(title)) reasons.push("Rejected non-English listing");
  if (input.tuning.cardNumberRequired !== false && !titleHasCardNumber(title, input.card.cardNumber)) {
    reasons.push("Wrong or missing card number");
  }
  if (input.tuning.exactSetName !== false && !titleContainsPhrase(title, input.card.setName) && !titleContainsAllTokens(title, input.card.setName)) {
    reasons.push("Wrong or missing set name");
  }
  if (!titleContainsAllTokens(title, input.card.cardName)) reasons.push("Wrong or missing card name");
  if (!gradeMatches(title, input.gradeType)) reasons.push(`Wrong grade for ${input.gradeSuffix}`);

  for (const term of words(input.tuning.includeWords)) {
    if (!includesTerm(title, term)) reasons.push(`Missing required include word: ${term}`);
  }

  const keywordTerms = words(gradeKeywords(input.gradeType, input.tuning));
  const hasGradeKeyword = keywordTerms.length === 0 || keywordTerms.some((term) => includesTerm(title, term));
  if (!hasGradeKeyword) reasons.push(`Missing grade keyword for ${input.gradeSuffix}`);

  const baseScore = matchScoreForTitle(title, input.card, input.gradeSuffix);
  const score = Math.max(0, Math.min(100, reasons.length ? baseScore - reasons.length * 18 : baseScore + 12));
  return {
    accepted: reasons.length === 0 && score >= 60,
    score,
    reasons
  };
}

async function searchCompletedSales(input: {
  token: string;
  config: EbayConfig;
  query: string;
  gradeType: GradeType;
  gradeSuffix: string;
  card: { cardName: string; setName: string; cardNumber: string };
  tuning: EbaySearchTuning;
}) {
  const url = new URL(`${apiHost(input.config)}/buy/marketplace_insights/v1_beta/item_sales/search`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "-date");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.token}`,
      "x-ebay-c-marketplace-id": input.config.marketplaceId,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(12000)
  });
  const data = (await response.json().catch(() => ({}))) as { itemSales?: Array<Record<string, unknown>>; errors?: Array<{ message?: string }> };
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message || `eBay completed sales search failed with HTTP ${response.status}`);
  }
  let rejected = 0;
  const sales = (data.itemSales || [])
    .map((item) => {
      const saleTitle = typeof item.title === "string" ? item.title : "";
      const salePrice = numberFromAmount(item.price || item.itemPrice || item.soldPrice);
      const soldAt = dateFromSale(item);
      if (!saleTitle || salePrice === null || !soldAt) {
        rejected += 1;
        return null;
      }
      const quality = assessSaleQuality({
        title: saleTitle,
        card: input.card,
        gradeType: input.gradeType,
        gradeSuffix: input.gradeSuffix,
        tuning: input.tuning
      });
      if (!quality.accepted) {
        rejected += 1;
        return null;
      }
      return {
        saleTitle,
        salePrice,
        soldAt,
        sourceUrl: itemUrl(item),
        gradeType: input.gradeType,
        matchScore: quality.score,
        conditionNotes: `Accepted by eBay QA: ${quality.score}% match.`
      };
    })
    .filter((sale): sale is EbayCompletedSale => Boolean(sale))
    .slice(0, 3);
  return { sales, rejected };
}

export async function fetchLastThreeEbayComps(
  card: { cardName: string; setName: string; cardNumber: string },
  tuning: EbaySearchTuning = {}
) {
  const config = ebayConfig();
  if (!config) {
    return {
      mode: "manual" as const,
      message: "Manual comp mode. Configure EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENVIRONMENT, and EBAY_MARKETPLACE_ID.",
      sales: [] as EbayCompletedSale[],
      rejected: 0
    };
  }
  const token = await ebayAccessToken(config);
  const sales: EbayCompletedSale[] = [];
  let rejected = 0;
  for (const grade of gradeQueries) {
    const tunedKeywords = gradeKeywords(grade.gradeType, tuning)
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ");
    const includeWords = words(tuning.includeWords).join(" ");
    const query = `${card.cardName} ${card.setName} ${card.cardNumber} ${tunedKeywords || grade.suffix} ${includeWords} pokemon card sold`.trim();
    const result = await searchCompletedSales({
      token,
      config,
      query,
      gradeType: grade.gradeType,
      gradeSuffix: grade.suffix,
      card,
      tuning
    });
    sales.push(...result.sales);
    rejected += result.rejected;
  }
  return {
    mode: "api" as const,
    message: `Fetched ${sales.length} accepted eBay sold comps through Marketplace Insights; rejected ${rejected} weak or wrong matches.`,
    sales,
    rejected
  };
}

function inventoryMatchScore(title: string, input: { itemName: string; setName?: string | null; upc?: string | null; sku?: string | null }) {
  const titleText = normalize(title);
  const itemTokens = significantTokens(input.itemName);
  const setTokens = significantTokens(input.setName || "");
  const idTokens = [input.upc, input.sku].filter((value): value is string => Boolean(value)).map(compact);
  const allTokens = [...itemTokens, ...setTokens];
  const matchedTokens = allTokens.filter((token) => titleText.includes(token)).length;
  const tokenScore = allTokens.length ? Math.round((matchedTokens / allTokens.length) * 82) : 50;
  const idBonus = idTokens.some((token) => token && compact(title).includes(token)) ? 18 : 0;
  return Math.max(0, Math.min(100, tokenScore + idBonus));
}

function inventoryRejected(title: string) {
  const reject = ["proxy", "digital", "code card", "empty box", "wrapper only", "damaged", "custom", "orica"];
  return reject.find((term) => includesTerm(title, term)) || null;
}

export async function fetchLastThreeInventoryEbayComps(input: {
  itemName: string;
  setName?: string | null;
  category?: string | null;
  upc?: string | null;
  sku?: string | null;
}) {
  const config = ebayConfig();
  if (!config) {
    return {
      mode: "manual" as const,
      message: "Manual comp mode. Configure EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENVIRONMENT, and EBAY_MARKETPLACE_ID.",
      sales: [] as EbayInventoryCompletedSale[],
      rejected: 0
    };
  }
  const token = await ebayAccessToken(config);
  const query = `${input.itemName} ${input.setName || ""} ${input.upc || ""} ${input.sku || ""} pokemon tcg sold`.trim();
  const url = new URL(`${apiHost(config)}/buy/marketplace_insights/v1_beta/item_sales/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "-date");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": config.marketplaceId,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(12000)
  });
  const data = (await response.json().catch(() => ({}))) as { itemSales?: Array<Record<string, unknown>>; errors?: Array<{ message?: string }> };
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message || `eBay completed sales search failed with HTTP ${response.status}`);
  }
  let rejected = 0;
  const sales = (data.itemSales || [])
    .map((item) => {
      const saleTitle = typeof item.title === "string" ? item.title : "";
      const salePrice = numberFromAmount(item.price || item.itemPrice || item.soldPrice);
      const soldAt = dateFromSale(item);
      const rejectReason = saleTitle ? inventoryRejected(saleTitle) : "missing title";
      const matchScore = saleTitle ? inventoryMatchScore(saleTitle, input) : 0;
      if (!saleTitle || salePrice === null || !soldAt || rejectReason || matchScore < 58) {
        rejected += 1;
        return null;
      }
      return {
        saleTitle,
        salePrice,
        soldAt,
        sourceUrl: itemUrl(item),
        matchScore,
        notes: `Accepted by inventory eBay QA: ${matchScore}% match.`
      };
    })
    .filter((sale): sale is EbayInventoryCompletedSale => Boolean(sale))
    .slice(0, 3);

  return {
    mode: "api" as const,
    message: `Fetched ${sales.length} accepted eBay sold comps for inventory; rejected ${rejected} weak or wrong matches.`,
    sales,
    rejected
  };
}
