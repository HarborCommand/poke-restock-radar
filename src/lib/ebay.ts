import type { GradeType } from "@/types/radar";

export type EbayCompMode = "api" | "manual";

export type EbayCompletedSale = {
  saleTitle: string;
  salePrice: number;
  soldAt: Date;
  sourceUrl: string | null;
  gradeType: GradeType;
  matchScore: number;
};

type EbayConfig = {
  clientId: string;
  clientSecret: string;
  environment: "production" | "sandbox";
  marketplaceId: string;
};

const gradeQueries: Array<{ gradeType: GradeType; suffix: string }> = [
  { gradeType: "RAW", suffix: "raw ungraded" },
  { gradeType: "PSA_9", suffix: "PSA 9" },
  { gradeType: "PSA_10", suffix: "PSA 10" },
  { gradeType: "BGS_9_5", suffix: "BGS 9.5" },
  { gradeType: "BGS_10", suffix: "BGS 10" },
  { gradeType: "BGS_BLACK_LABEL", suffix: "BGS Black Label" }
];

function ebayConfig(): EbayConfig | null {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const environment = process.env.EBAY_ENVIRONMENT?.toLowerCase() === "sandbox" ? "sandbox" : "production";
  return {
    clientId,
    clientSecret,
    environment,
    marketplaceId: process.env.EBAY_MARKETPLACE_ID || "EBAY_US"
  };
}

export function ebayMode(): EbayCompMode {
  return ebayConfig() ? "api" : "manual";
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
    })
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `eBay OAuth failed with HTTP ${response.status}`);
  }
  return body.access_token;
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

function matchScoreForTitle(title: string, card: { cardName: string; setName: string; cardNumber: string }, gradeSuffix: string) {
  const normalized = title.toLowerCase();
  const tokens = [card.cardName, card.setName, card.cardNumber, gradeSuffix]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9.]+/))
    .filter((value) => value.length >= 2);
  const unique = [...new Set(tokens)];
  const matched = unique.filter((token) => normalized.includes(token)).length;
  return unique.length ? Math.round((matched / unique.length) * 100) : 0;
}

async function searchCompletedSales(input: {
  token: string;
  config: EbayConfig;
  query: string;
  gradeType: GradeType;
  gradeSuffix: string;
  card: { cardName: string; setName: string; cardNumber: string };
}) {
  const url = new URL(`${apiHost(input.config)}/buy/marketplace_insights/v1_beta/item_sales/search`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("limit", "20");
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
  return (data.itemSales || [])
    .map((item) => {
      const saleTitle = typeof item.title === "string" ? item.title : "";
      const salePrice = numberFromAmount(item.price || item.itemPrice || item.soldPrice);
      const soldAt = dateFromSale(item);
      if (!saleTitle || salePrice === null || !soldAt) return null;
      return {
        saleTitle,
        salePrice,
        soldAt,
        sourceUrl: itemUrl(item),
        gradeType: input.gradeType,
        matchScore: matchScoreForTitle(saleTitle, input.card, input.gradeSuffix)
      };
    })
    .filter((sale): sale is EbayCompletedSale => Boolean(sale))
    .filter((sale) => sale.matchScore >= 45)
    .slice(0, 3);
}

export async function fetchLastThreeEbayComps(card: { cardName: string; setName: string; cardNumber: string }) {
  const config = ebayConfig();
  if (!config) {
    return {
      mode: "manual" as const,
      message: "Manual comp mode. EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured.",
      sales: [] as EbayCompletedSale[]
    };
  }
  const token = await ebayAccessToken(config);
  const sales: EbayCompletedSale[] = [];
  for (const grade of gradeQueries) {
    const query = `${card.cardName} ${card.setName} ${card.cardNumber} ${grade.suffix} pokemon card`;
    sales.push(
      ...(await searchCompletedSales({
        token,
        config,
        query,
        gradeType: grade.gradeType,
        gradeSuffix: grade.suffix,
        card
      }))
    );
  }
  return {
    mode: "api" as const,
    message: `Fetched ${sales.length} eBay sold comps through Marketplace Insights.`,
    sales
  };
}
