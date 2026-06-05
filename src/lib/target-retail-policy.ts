export type TargetSellerType = "target" | "marketplace" | "unknown";
export type TargetFulfillmentType = "target_ship" | "pickup" | "marketplace_ship" | "unknown";
export type TargetPriceStatus = "msrp" | "near_retail" | "over_msrp" | "marketplace_price" | "unknown";
export type TargetAlertEligibility =
  | "eligible"
  | "suppressed_over_msrp"
  | "suppressed_marketplace"
  | "needs_review";

export type TargetRetailPolicyInput = {
  retailerName?: string | null;
  title?: string | null;
  productType?: string | null;
  price?: number | null;
  sellerName?: string | null;
  sellerType?: string | null;
  fulfillmentType?: string | null;
  sellerVerified?: boolean | null;
  confidenceScore?: number | null;
  exactUrl?: boolean | null;
  isPokemonTcg?: boolean | null;
  expectedRetailPrice?: number | null;
  maxAlertPrice?: number | null;
  allowOverMsrp?: boolean | null;
};

export type TargetRetailPolicyResult = {
  sellerName: string | null;
  sellerType: TargetSellerType;
  fulfillmentType: TargetFulfillmentType;
  sellerVerified: boolean;
  priceStatus: TargetPriceStatus;
  alertEligibility: TargetAlertEligibility;
  expectedRetailPrice: number | null;
  maxAlertPrice: number | null;
  targetRetailMin: number | null;
  targetRetailMax: number | null;
  targetRetailReason: string;
  watchReady: boolean;
  alertEligible: boolean;
  suppressed: boolean;
};

type MsrpRange = {
  min: number;
  max: number;
  reason: string;
  expectedRetailPrice: number;
};

function normalized(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/pok(?:e|é)mon/g, "pokemon")
    .replace(/\s+/g, " ")
    .trim();
}

function finitePrice(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function cleanSellerName(value: string | null | undefined) {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function sellerTypeFromValue(value: string | null | undefined): TargetSellerType {
  const lower = normalized(value);
  if (lower === "target" || lower === "target.com") return "target";
  if (lower === "marketplace") return "marketplace";
  return "unknown";
}

function fulfillmentTypeFromValue(value: string | null | undefined): TargetFulfillmentType {
  const lower = normalized(value);
  if (lower === "target_ship" || lower === "pickup") return lower as TargetFulfillmentType;
  if (lower === "marketplace_ship") return "marketplace_ship";
  return "unknown";
}

function packCountFromTitle(title: string) {
  const text = normalized(title);
  if (/\b(one of each artwork|art set)\b/.test(text)) return 4;
  const explicit = text.match(/\b(2|3|4|5|6|8|10|12)\s*(?:x|pack|packs|pk|ct|count|sleeved|booster)/);
  if (explicit?.[1]) return Number(explicit[1]);
  const beforePack = text.match(/\b(2|3|4|5|6|8|10|12)\s*[- ]?(?:sleeved )?booster packs?\b/);
  if (beforePack?.[1]) return Number(beforePack[1]);
  return 1;
}

export function isPokemonTcgTargetText(input: { title?: string | null; productType?: string | null }) {
  const text = normalized(`${input.title || ""} ${input.productType || ""}`);
  if (!text.includes("pokemon")) return false;
  return /tcg|trading card|booster|elite trainer|etb|blister|checklane|tin|collection|deck|card pack|build.*battle/.test(text);
}

export function targetMsrpRangeForProduct(input: {
  title?: string | null;
  productType?: string | null;
  expectedRetailPrice?: number | null;
  maxAlertPrice?: number | null;
}): MsrpRange | null {
  const title = normalized(input.title);
  const type = normalized(input.productType);
  const text = `${title} ${type}`;
  const expected = finitePrice(input.expectedRetailPrice);
  const maxOverride = finitePrice(input.maxAlertPrice);
  if (expected !== null || maxOverride !== null) {
    const max = maxOverride ?? Math.max((expected ?? 0) * 1.1, expected ?? 0);
    const min = expected !== null ? Math.max(0, expected * 0.75) : 0;
    return {
      min,
      max,
      expectedRetailPrice: expected ?? max,
      reason: "Manual Target retail guardrail."
    };
  }

  if (text.includes("pokemon center") && (text.includes("elite trainer") || /\betb\b/.test(text))) {
    return { min: 59.99, max: 69.99, expectedRetailPrice: 59.99, reason: "Pokemon Center ETB range; Target normally needs review." };
  }
  if (text.includes("elite trainer") || /\betb\b/.test(text)) {
    return { min: 44.99, max: 59.99, expectedRetailPrice: 49.99, reason: "Target ETB MSRP range." };
  }
  if (text.includes("booster box") || text.includes("booster display")) {
    return null;
  }
  if (text.includes("booster bundle")) {
    return { min: 24.99, max: 32.99, expectedRetailPrice: 29.99, reason: "Target booster bundle MSRP range." };
  }
  if (text.includes("3 pack") || text.includes("3 packs") || text.includes("3-pack") || text.includes("three booster") || text.includes("three-booster")) {
    return { min: 12.99, max: 17.99, expectedRetailPrice: 13.99, reason: "Target 3-pack blister MSRP range." };
  }
  if (text.includes("checklane")) {
    return { min: 4.49, max: 9.99, expectedRetailPrice: 6.99, reason: "Target checklane blister retail range." };
  }
  if (text.includes("sleeved booster") || text.includes("booster pack") || text.includes("single booster") || text.includes("card pack")) {
    const packCount = packCountFromTitle(title);
    const min = packCount * 4.49;
    const max = packCount * 6.49 + (packCount > 1 ? 2 : 0);
    return {
      min,
      max,
      expectedRetailPrice: packCount * 4.99,
      reason: packCount > 1 ? `Target multi-pack booster MSRP range (${packCount} packs).` : "Target single booster MSRP range."
    };
  }
  if (text.includes("premium collection")) {
    return { min: 29.99, max: 59.99, expectedRetailPrice: 39.99, reason: "Target premium collection MSRP range." };
  }
  if (text.includes("collection box") || text.includes("collection")) {
    return { min: 19.99, max: 39.99, expectedRetailPrice: 24.99, reason: "Target collection box MSRP range." };
  }
  if (text.includes("mini tin")) {
    return { min: 8.99, max: 12.99, expectedRetailPrice: 9.99, reason: "Target mini tin MSRP range." };
  }
  if (text.includes("tin")) {
    return { min: 9.99, max: 29.99, expectedRetailPrice: 14.99, reason: "Target tin MSRP range." };
  }
  return null;
}

function targetPriceStatus(input: {
  price: number | null;
  sellerType: TargetSellerType;
  range: MsrpRange | null;
  allowOverMsrp: boolean;
}): TargetPriceStatus {
  if (input.sellerType === "marketplace") return "marketplace_price";
  if (input.price === null || !input.range) return "unknown";
  if (input.allowOverMsrp) return input.price <= input.range.max ? "msrp" : "near_retail";
  if (input.price <= input.range.max) return "msrp";
  if (input.price <= input.range.max + 2 || input.price <= input.range.max * 1.05) return "near_retail";
  return "over_msrp";
}

export function detectTargetSellerInfoFromText(input: unknown): Pick<
  TargetRetailPolicyResult,
  "sellerName" | "sellerType" | "fulfillmentType" | "sellerVerified"
> {
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? {});
  const text = normalized(raw);
  const sellerMatch =
    raw.match(/sold\s*(?:and|&)?\s*shipped\s*by["':\s]+([^"',<>{}\]]{2,80})/i) ||
    raw.match(/sold\s*by["':\s]+([^"',<>{}\]]{2,80})/i) ||
    raw.match(/seller(?:Name|_name)?["']?\s*:\s*["']([^"']{2,80})["']/i);
  const sellerName = cleanSellerName(sellerMatch?.[1]);
  const normalizedSeller = normalized(sellerName);

  const marketplace =
    /marketplace|third party|third-party|partner seller|external seller|seller_name|sold by (?!target\b)[a-z0-9 ]{3,}/i.test(raw) &&
    normalizedSeller !== "target" &&
    !/sold\s*(?:and|&)?\s*shipped\s*by\s*target/i.test(raw);
  const targetSeller =
    /sold\s*(?:and|&)?\s*shipped\s*by\s*target|sold\s*by\s*target|target\s*retail|target\.com/i.test(raw) ||
    normalizedSeller === "target";
  const pickup = /pickup|store pickup|order pickup|drive up/.test(text);

  if (marketplace) {
    return {
      sellerName: sellerName || "Marketplace seller",
      sellerType: "marketplace",
      fulfillmentType: "marketplace_ship",
      sellerVerified: true
    };
  }
  if (targetSeller) {
    return {
      sellerName: sellerName || "Target",
      sellerType: "target",
      fulfillmentType: pickup ? "pickup" : "target_ship",
      sellerVerified: true
    };
  }
  return {
    sellerName,
    sellerType: "unknown",
    fulfillmentType: "unknown",
    sellerVerified: false
  };
}

export function evaluateTargetRetailPolicy(input: TargetRetailPolicyInput): TargetRetailPolicyResult {
  const sellerType = sellerTypeFromValue(input.sellerType);
  const sellerName = cleanSellerName(input.sellerName) || (sellerType === "target" ? "Target" : null);
  const fulfillmentType = fulfillmentTypeFromValue(input.fulfillmentType);
  const title = input.title || "";
  const productType = input.productType || "";
  const price = finitePrice(input.price);
  const range = targetMsrpRangeForProduct({
    title,
    productType,
    expectedRetailPrice: input.expectedRetailPrice,
    maxAlertPrice: input.maxAlertPrice
  });
  const allowOverMsrp = Boolean(input.allowOverMsrp);
  const priceStatus = targetPriceStatus({ price, sellerType, range, allowOverMsrp });
  const exactUrl = input.exactUrl !== false;
  const tcg = input.isPokemonTcg ?? isPokemonTcgTargetText({ title, productType });
  const confidence = input.confidenceScore ?? 0;

  let alertEligibility: TargetAlertEligibility = "eligible";
  let reason = range?.reason || "No Target MSRP guardrail matched; manual review required.";
  if (!exactUrl || !tcg || confidence < 70 || !range || priceStatus === "unknown") {
    alertEligibility = "needs_review";
  }
  if (sellerType === "marketplace") {
    alertEligibility = "suppressed_marketplace";
    reason = "Suppressed because Target seller is marketplace/third-party.";
  } else if (!allowOverMsrp && (priceStatus === "over_msrp" || priceStatus === "marketplace_price")) {
    alertEligibility = "suppressed_over_msrp";
    reason = range
      ? `Suppressed because price ${price === null ? "unknown" : `$${price.toFixed(2)}`} is above ${range.reason} max $${range.max.toFixed(2)}.`
      : "Suppressed because price is outside Target retail guardrails.";
  } else if (sellerType === "unknown" && priceStatus === "near_retail") {
    alertEligibility = "eligible";
    reason = `${range?.reason || "Target retail range"} Seller unknown, but price is near retail.`;
  } else if (sellerType === "unknown" && priceStatus === "msrp") {
    alertEligibility = "eligible";
    reason = `${range?.reason || "Target retail range"} Seller unknown, but price is MSRP/retail.`;
  } else if (sellerType === "target" && (priceStatus === "msrp" || priceStatus === "near_retail")) {
    alertEligibility = "eligible";
    reason = `${range?.reason || "Target retail range"} Sold by Target.`;
  }

  const alertEligible = alertEligibility === "eligible";
  return {
    sellerName,
    sellerType,
    fulfillmentType,
    sellerVerified: Boolean(input.sellerVerified || sellerType !== "unknown"),
    priceStatus,
    alertEligibility,
    expectedRetailPrice: input.expectedRetailPrice ?? range?.expectedRetailPrice ?? null,
    maxAlertPrice: input.maxAlertPrice ?? range?.max ?? null,
    targetRetailMin: range?.min ?? null,
    targetRetailMax: range?.max ?? null,
    targetRetailReason: reason,
    watchReady: alertEligible && exactUrl && tcg && confidence >= 70,
    alertEligible,
    suppressed: alertEligibility === "suppressed_marketplace" || alertEligibility === "suppressed_over_msrp"
  };
}
