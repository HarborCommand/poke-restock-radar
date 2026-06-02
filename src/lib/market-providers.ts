import type { EbayConnectionStatusDTO, InventoryItemDTO, MarketProviderStatusDTO } from "@/types/radar";

export type MarketProviderName = "PRICECHARTING" | "TCGPLAYER" | "TCGCSV" | "EBAY_SOLD" | "MANUAL";

export type MarketProviderPrice = {
  provider: Exclude<MarketProviderName, "MANUAL">;
  providerProductId: string | null;
  matchedTitle: string;
  price: number;
  sourceUrl: string | null;
  confidence: number;
  notes: string;
};

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function hasEnv(name: string) {
  return envValue(name) !== null;
}

function compact(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function moneyFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1000 ? value / 100 : value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1000 ? parsed / 100 : parsed;
}

function pickFirstPrice(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = moneyFromUnknown(record[key]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

function titleConfidence(title: string, item: Pick<InventoryItemDTO, "itemName" | "setName" | "upc" | "sku" | "dpci" | "asin">) {
  const titleCompact = compact(title);
  const nameCompact = compact(item.itemName);
  const setCompact = compact(item.setName);
  const idTokens = [item.upc, item.sku, item.dpci, item.asin].map(compact).filter(Boolean);
  let score = 0;
  if (nameCompact && titleCompact.includes(nameCompact.slice(0, Math.min(nameCompact.length, 18)))) score += 50;
  if (setCompact && titleCompact.includes(setCompact)) score += 20;
  if (idTokens.some((token) => titleCompact.includes(token))) score += 30;
  if (titleCompact.includes("pokemon") || titleCompact.includes("pokmon")) score += 10;
  return Math.min(100, Math.max(0, score || 45));
}

export function marketProviderStatuses(ebayStatus: EbayConnectionStatusDTO, tcgcsvStats?: Partial<MarketProviderStatusDTO>): MarketProviderStatusDTO[] {
  const tcgcsvEnabled = envValue("TCGCSV_ENABLED") === "true";
  return [
    {
      provider: "TCGCSV",
      label: "TCGCSV",
      enabled: tcgcsvEnabled,
      configured: tcgcsvEnabled,
      mode: tcgcsvEnabled ? "trusted_market" : "not_configured",
      priority: 1,
      supportedCategories: ["Pokemon sealed products", "cards", "inventory products"],
      message: tcgcsvEnabled
        ? "Primary provider. TCGplayer-derived market estimates are cached server-side."
        : "TCGCSV not configured. Set TCGCSV_ENABLED=true to use automatic market estimates.",
      lastSuccessfulSyncAt: tcgcsvStats?.lastSuccessfulSyncAt,
      lastError: tcgcsvStats?.lastError,
      productsCached: tcgcsvStats?.productsCached,
      pricesCached: tcgcsvStats?.pricesCached,
      itemsMatched: tcgcsvStats?.itemsMatched,
      itemsNeedingReview: tcgcsvStats?.itemsNeedingReview
    },
    {
      provider: "PRICECHARTING",
      label: "PriceCharting",
      enabled: hasEnv("PRICECHARTING_API_TOKEN"),
      configured: hasEnv("PRICECHARTING_API_TOKEN"),
      mode: hasEnv("PRICECHARTING_API_TOKEN") ? "trusted_market" : "not_configured",
      priority: 2,
      supportedCategories: ["sealed products", "raw cards", "graded cards", "slabs", "collectibles"],
      message: hasEnv("PRICECHARTING_API_TOKEN") ? "Configured as optional fallback." : "PriceCharting not configured."
    },
    {
      provider: "TCGPLAYER",
      label: "TCGplayer",
      enabled: hasEnv("TCGPLAYER_ACCESS_TOKEN") || (hasEnv("TCGPLAYER_PUBLIC_KEY") && hasEnv("TCGPLAYER_PRIVATE_KEY")),
      configured: hasEnv("TCGPLAYER_ACCESS_TOKEN") || (hasEnv("TCGPLAYER_PUBLIC_KEY") && hasEnv("TCGPLAYER_PRIVATE_KEY")),
      mode: hasEnv("TCGPLAYER_ACCESS_TOKEN") || (hasEnv("TCGPLAYER_PUBLIC_KEY") && hasEnv("TCGPLAYER_PRIVATE_KEY")) ? "trusted_market" : "not_configured",
      priority: 3,
      supportedCategories: ["cards", "sealed products"],
      message: hasEnv("TCGPLAYER_ACCESS_TOKEN") || (hasEnv("TCGPLAYER_PUBLIC_KEY") && hasEnv("TCGPLAYER_PRIVATE_KEY")) ? "Configured as optional fallback." : "TCGplayer not configured."
    },
    {
      provider: "EBAY_SOLD",
      label: "eBay Sold Comps",
      enabled: ebayStatus.ready,
      configured: ebayStatus.ready,
      mode: ebayStatus.ready ? "sold_comps" : hasEnv("EBAY_CLIENT_ID") || hasEnv("EBAY_CLIENT_SECRET") ? "active_only" : "not_configured",
      priority: 4,
      supportedCategories: ["sealed products", "raw cards", "graded cards", "collectibles"],
      message: ebayStatus.ready
        ? "Marketplace Insights sold-comp access configured."
        : "Optional sold-comp provider disabled."
    },
    {
      provider: "MANUAL",
      label: "Manual Comps",
      enabled: true,
      configured: true,
      mode: "manual",
      priority: 5,
      supportedCategories: ["all inventory"],
      message: "Manual estimates are hidden from the main Market page and kept as admin fallback."
    }
  ];
}

export function activeMarketProvider(statuses: MarketProviderStatusDTO[]) {
  return statuses.find((status) => status.enabled && status.provider !== "MANUAL") ?? statuses.find((status) => status.provider === "MANUAL") ?? null;
}

export async function fetchPriceChartingMarketPrice(item: InventoryItemDTO): Promise<MarketProviderPrice | null> {
  const token = envValue("PRICECHARTING_API_TOKEN");
  if (!token) return null;
  const query = item.upc || `${item.itemName} ${item.setName || ""}`.trim();
  const url = new URL("https://www.pricecharting.com/api/product");
  url.searchParams.set("t", token);
  url.searchParams.set("q", query);
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.status === "error") {
    throw new Error(typeof data["error-message"] === "string" ? data["error-message"] : `PriceCharting lookup failed with HTTP ${response.status}`);
  }
  const title = String(data["product-name"] || data.productName || data.name || item.itemName);
  const price = pickFirstPrice(data, ["new-price", "complete-in-box-price", "loose-price", "used-price", "graded-price", "manual-only-price"]);
  if (!price) return null;
  const productId = data.id === undefined ? null : String(data.id);
  return {
    provider: "PRICECHARTING",
    providerProductId: productId,
    matchedTitle: title,
    price,
    sourceUrl: productId ? `https://www.pricecharting.com/game/${productId}` : null,
    confidence: Math.max(65, titleConfidence(title, item)),
    notes: `PriceCharting market price snapshot. Provider product ID: ${productId || "unknown"}.`
  };
}

async function fetchTcgplayerMarketPrice(item: InventoryItemDTO): Promise<MarketProviderPrice | null> {
  const token = envValue("TCGPLAYER_ACCESS_TOKEN");
  if (!token) return null;
  const query = encodeURIComponent(`${item.itemName} ${item.setName || ""}`.trim());
  const url = new URL(`https://api.tcgplayer.com/v1.39.0/catalog/products?productName=${query}&getExtendedFields=true`);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const data = (await response.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>>; errors?: Array<string> };
  if (!response.ok) throw new Error(data.errors?.[0] || `TCGplayer lookup failed with HTTP ${response.status}`);
  const first = data.results?.[0];
  if (!first) return null;
  const productId = String(first.productId || first.cleanProductName || first.name || "");
  const priceUrl = new URL(`https://api.tcgplayer.com/v1.39.0/pricing/product/${encodeURIComponent(productId)}`);
  const priceResponse = await fetch(priceUrl, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const priceData = (await priceResponse.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>> };
  const priceRow = priceData.results?.find((row) => moneyFromUnknown(row.marketPrice) || moneyFromUnknown(row.midPrice)) ?? priceData.results?.[0];
  const price = priceRow ? pickFirstPrice(priceRow, ["marketPrice", "midPrice", "lowPrice"]) : null;
  if (!price) return null;
  const title = String(first.name || first.cleanProductName || item.itemName);
  return {
    provider: "TCGPLAYER",
    providerProductId: productId || null,
    matchedTitle: title,
    price,
    sourceUrl: productId ? `https://www.tcgplayer.com/product/${productId}` : null,
    confidence: titleConfidence(title, item),
    notes: "TCGplayer market price snapshot."
  };
}

export async function fetchTrustedProviderMarketPrice(item: InventoryItemDTO) {
  const attempts: Array<{ provider: Exclude<MarketProviderName, "MANUAL">; run: () => Promise<MarketProviderPrice | null> }> = [
    { provider: "PRICECHARTING", run: () => fetchPriceChartingMarketPrice(item) },
    { provider: "TCGPLAYER", run: () => fetchTcgplayerMarketPrice(item) }
  ];
  const failures: Array<{ provider: string; reason: string }> = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      if (result) return { result, failures };
      failures.push({ provider: attempt.provider, reason: "not_found_or_not_configured" });
    } catch (error) {
      failures.push({ provider: attempt.provider, reason: error instanceof Error ? error.message : "provider_failed" });
    }
  }
  return { result: null, failures };
}
