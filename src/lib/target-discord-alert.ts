import type { AlertDTO, ProductDTO } from "@/types/radar";

export type TargetDiscordAlertInput = {
  productName?: string | null;
  price?: number | null;
  skuOrTcin?: string | null;
  productUrl?: string | null;
  timestamp?: string | null;
};

export type TargetDiscordCompareStatus =
  | "not_watched"
  | "exact_url_missing"
  | "suppressed_over_msrp"
  | "suppressed_marketplace"
  | "sold_out_at_latest_check"
  | "parser_failed"
  | "cron_not_run_recently"
  | "live_drop_created"
  | "deduped_currently_buyable"
  | "watched_not_buyable";

export type TargetDiscordComparison = {
  status: TargetDiscordCompareStatus;
  watched: boolean;
  productId: string | null;
  productName: string | null;
  matchedBy: string | null;
  exactUrl: string | null;
  lastCheckedAt: string | null;
  latestStockStatus: string | null;
  livePrice: number | null;
  confidence: number | null;
  alertCreated: boolean;
  currentlyBuyable: boolean;
  retailEligible: boolean;
  stale: boolean;
  reasons: string[];
};

export type TargetDiscordCompareOptions = {
  now?: Date;
  staleMinutes?: number;
  buyableProductIds?: Set<string>;
  retailEligibleProductIds?: Set<string>;
  exactUrlByProductId?: Map<string, string>;
};

const BUYABLE_STATUSES = new Set(["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"]);

export function normalizeTargetIdentifier(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function targetUrlFromTcin(value: string | null | undefined) {
  const tcin = normalizeTargetIdentifier(value);
  return tcin ? `https://www.target.com/p/-/A-${tcin}` : "";
}

export function targetIdentifierFromUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.pathname.match(/A-(\d{5,})/i)?.[1] ?? "";
  } catch {
    return value.match(/A-(\d{5,})/i)?.[1] ?? "";
  }
}

export function targetIdentifierVariants(value: string | null | undefined) {
  const normalized = normalizeTargetIdentifier(value);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  variants.add(normalized.replace(/^0+/, ""));
  if (normalized.length < 13) variants.add(normalized.padStart(13, "0"));
  if (normalized.length < 12) variants.add(normalized.padStart(12, "0"));
  if (normalized.length === 13 && normalized.startsWith("0")) variants.add(normalized.slice(1));
  return Array.from(variants).filter(Boolean);
}

function compactText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleWords(value: string | null | undefined) {
  return compactText(value)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["pokemon", "tcg", "trading", "card", "game"].includes(word));
}

function targetExactUrl(product: ProductDTO, override?: string | null) {
  const url = override || product.verifiedFinalUrl || product.url || "";
  return /target\.com\/p\//i.test(url) ? url : "";
}

function productIdentifiers(product: ProductDTO) {
  const values = [
    product.retailerProductId,
    product.sku,
    product.dpci,
    product.upc,
    targetIdentifierFromUrl(product.verifiedFinalUrl || product.url)
  ];
  return values.flatMap(targetIdentifierVariants);
}

function matchProduct(input: TargetDiscordAlertInput, products: ProductDTO[]) {
  const inputId = normalizeTargetIdentifier(input.skuOrTcin) || targetIdentifierFromUrl(input.productUrl);
  const inputVariants = targetIdentifierVariants(inputId);
  if (inputVariants.length) {
    const byIdentifier = products.find((product) => productIdentifiers(product).some((identifier) => inputVariants.includes(identifier)));
    if (byIdentifier) return { product: byIdentifier, matchedBy: "SKU/TCIN" };
    return { product: null, matchedBy: null };
  }

  const urlTcin = targetIdentifierFromUrl(input.productUrl);
  if (urlTcin) {
    const byUrl = products.find((product) => productIdentifiers(product).includes(urlTcin));
    if (byUrl) return { product: byUrl, matchedBy: "Target URL" };
    return { product: null, matchedBy: null };
  }

  const words = titleWords(input.productName);
  if (words.length >= 2) {
    const byTitle = products.find((product) => {
      const text = compactText(`${product.name} ${product.liveTitle || ""} ${product.productType || ""}`);
      return words.slice(0, 5).filter((word) => text.includes(word)).length >= Math.min(3, words.length);
    });
    if (byTitle) return { product: byTitle, matchedBy: "title" };
  }

  return { product: null, matchedBy: null };
}

function alertMatchesProduct(alert: AlertDTO, product: ProductDTO) {
  const identifiers = productIdentifiers(product);
  const text = compactText(`${alert.title} ${alert.reason} ${alert.dedupeKey || ""} ${alert.actionUrl || ""} ${alert.entityId || ""}`);
  return (
    alert.entityId === product.id ||
    alert.dedupeKey?.includes(product.id) ||
    identifiers.some((identifier) => identifier && text.includes(identifier)) ||
    Boolean(product.name && text.includes(compactText(product.name).slice(0, 24)))
  );
}

export function compareTargetDiscordAlert(
  input: TargetDiscordAlertInput,
  products: ProductDTO[],
  alerts: AlertDTO[],
  options: TargetDiscordCompareOptions = {}
): TargetDiscordComparison {
  const targetProducts = products.filter((product) => /target/i.test(product.retailerName) && !product.archivedAt);
  const { product, matchedBy } = matchProduct(input, targetProducts);
  if (!product) {
    return {
      status: "not_watched",
      watched: false,
      productId: null,
      productName: null,
      matchedBy: null,
      exactUrl: input.productUrl || targetUrlFromTcin(input.skuOrTcin) || null,
      lastCheckedAt: null,
      latestStockStatus: null,
      livePrice: input.price ?? null,
      confidence: null,
      alertCreated: false,
      currentlyBuyable: false,
      retailEligible: false,
      stale: true,
      reasons: ["Not watched by Poke Radar yet."]
    };
  }

  const exactUrl = targetExactUrl(product, options.exactUrlByProductId?.get(product.id));
  const stockStatus = product.liveStockStatus || product.stockStatus || null;
  const lastCheckedAt = product.liveStockVerifiedAt || product.lastSuccessfulCheckedAt || product.lastCheckedAt;
  const now = options.now ?? new Date();
  const staleMinutes = options.staleMinutes ?? 30;
  const stale = !lastCheckedAt || now.getTime() - new Date(lastCheckedAt).getTime() > staleMinutes * 60 * 1000;
  const currentlyBuyable = options.buyableProductIds?.has(product.id) ?? BUYABLE_STATUSES.has(stockStatus || "");
  const retailEligible =
    options.retailEligibleProductIds?.has(product.id) ??
    (product.alertEligibility === "eligible" || (!/marketplace/i.test(product.sellerType || "") && product.priceStatus !== "over_msrp"));
  const alertCreated = alerts.some((alert) => {
    const isTrackerDrop = alert.dedupeKey?.startsWith("tracker_online_drop:") || compactText(`${alert.title} ${alert.reason}`).includes("tracker online drop");
    return isTrackerDrop && alertMatchesProduct(alert, product);
  });

  const reasons: string[] = [];
  let status: TargetDiscordCompareStatus = "watched_not_buyable";

  if (!exactUrl) {
    status = "exact_url_missing";
    reasons.push("Exact Target /p/ product URL is missing or not verified.");
  } else if (product.liveBlockedType || product.lastMonitorError) {
    status = "parser_failed";
    reasons.push(product.liveBlockedType ? `Latest check was blocked: ${product.liveBlockedType}.` : product.lastMonitorError || "Latest parser check failed.");
  } else if (product.alertEligibility === "suppressed_marketplace" || product.sellerType === "marketplace") {
    status = "suppressed_marketplace";
    reasons.push("Suppressed because the listing appears to be marketplace/vendor, not Target retail.");
  } else if (product.alertEligibility === "suppressed_over_msrp" || product.priceStatus === "over_msrp") {
    status = "suppressed_over_msrp";
    reasons.push(product.targetRetailReason || "Suppressed because price is above Target retail/MSRP guardrails.");
  } else if (alertCreated) {
    status = "live_drop_created";
    reasons.push("A tracker_online_drop alert exists for this product.");
  } else if (currentlyBuyable && retailEligible) {
    status = "deduped_currently_buyable";
    reasons.push("Current state is buyable and retail/MSRP eligible. Repeat alert may be deduped, but the product belongs in Target Retail In Stock Now.");
  } else if (["SOLD_OUT", "UNAVAILABLE"].includes(stockStatus || "")) {
    status = "sold_out_at_latest_check";
    reasons.push(`Latest Target check is ${stockStatus?.replaceAll("_", " ").toLowerCase()}.`);
  } else if (stale) {
    status = "cron_not_run_recently";
    reasons.push(`No Target check in the last ${staleMinutes} minutes.`);
  } else {
    reasons.push("Product is watched, but latest check did not prove buyable retail stock.");
  }

  return {
    status,
    watched: true,
    productId: product.id,
    productName: product.name,
    matchedBy,
    exactUrl: exactUrl || null,
    lastCheckedAt,
    latestStockStatus: stockStatus,
    livePrice: product.livePrice ?? product.retailPrice ?? input.price ?? null,
    confidence: product.liveConfidenceScore,
    alertCreated,
    currentlyBuyable,
    retailEligible,
    stale,
    reasons
  };
}
