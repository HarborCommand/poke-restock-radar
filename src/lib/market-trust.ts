import type { InventoryItemDTO } from "@/types/radar";

export type MarketIdentityStatus = "Exact Match" | "Manually Confirmed" | "Strong Suggested Match" | "Needs Review" | "No Match";
export type MarketFreshnessLabel = "Fresh" | "Aging" | "Stale" | "Unavailable";
export type MarketPriceDisplayReason =
  | "displayable"
  | "Match needs review"
  | "Product identity mismatch"
  | "Matched product unavailable"
  | "Unopened price unavailable";
export type CurrentMarketPriceReason = MarketPriceDisplayReason | "current" | "Market data stale";
export type PotentialMarketProjectionReason =
  | "trusted"
  | "Match needs review"
  | "Product identity mismatch"
  | "Matched product unavailable"
  | "Unopened price unavailable"
  | "Market data stale"
  | "Cost basis unavailable"
  | "Estimated net unavailable";

const FRESH_HOURS = 36;
const AGING_HOURS = 96;

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isUnopenedSubtype(value: string | null | undefined) {
  return (value || "").trim().toLowerCase() === "unopened";
}

export function marketFreshness(
  timestamp: string | null | undefined,
  now: Date | number = Date.now()
): { label: MarketFreshnessLabel; ageHours: number | null } {
  if (!timestamp) return { label: "Unavailable", ageHours: null };
  const then = new Date(timestamp).getTime();
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return { label: "Unavailable", ageHours: null };
  const ageHours = (nowMs - then) / (1000 * 60 * 60);
  if (!Number.isFinite(ageHours) || ageHours < 0) return { label: "Unavailable", ageHours: null };
  if (ageHours <= FRESH_HOURS) return { label: "Fresh", ageHours };
  if (ageHours <= AGING_HOURS) return { label: "Aging", ageHours };
  return { label: "Stale", ageHours };
}

export function inventoryMarketFreshness(item: Pick<InventoryItemDTO, "marketProviderPriceSyncedAt" | "marketProviderLastPricedAt" | "marketLastRefreshedAt">, now?: Date | number) {
  return marketFreshness(item.marketProviderPriceSyncedAt || item.marketProviderLastPricedAt || item.marketLastRefreshedAt, now);
}

export function effectiveMarketIdentityStatus(
  item: Pick<
    InventoryItemDTO,
    | "marketProvider"
    | "marketProviderIdentityStatus"
    | "marketProviderIdentityValid"
    | "marketProviderMatchStatus"
    | "marketProviderProductId"
    | "marketProviderPriceSubtype"
  >
): MarketIdentityStatus {
  if (item.marketProviderIdentityStatus) return item.marketProviderIdentityStatus;
  if (item.marketProvider !== "TCGCSV") return item.marketProviderMatchStatus === "MATCHED" ? "Exact Match" : "No Match";
  if (!item.marketProviderProductId) return "No Match";
  if (item.marketProviderIdentityValid === false) return item.marketProviderMatchStatus === "MATCHED" ? "Needs Review" : "No Match";
  if (item.marketProviderMatchStatus === "LOCKED") return "Manually Confirmed";
  if (item.marketProviderMatchStatus === "MATCHED") return "Needs Review";
  if (item.marketProviderMatchStatus === "REVIEW") return "Needs Review";
  return "No Match";
}

type MarketTrustItem = Pick<
  InventoryItemDTO,
  | "marketProvider"
  | "marketProviderIdentityStatus"
  | "marketProviderIdentityValid"
  | "marketProviderMatchStatus"
  | "marketProviderProductId"
  | "marketProviderProductName"
  | "marketProviderPriceSubtype"
  | "currentMarketEstimate"
  | "grossMarketValue"
  | "marketCompCount"
  | "marketProviderPriceSyncedAt"
  | "marketProviderLastPricedAt"
  | "marketLastRefreshedAt"
  | "averageCost"
  | "quantityOwned"
  | "netMarketValue"
  | "marketProfitLoss"
  | "marketRoiPercent"
>;

export function marketPriceDisplayReason(item: MarketTrustItem): MarketPriceDisplayReason {
  if (item.marketProvider !== "TCGCSV") {
    return (finiteNumber(item.currentMarketEstimate) !== null || finiteNumber(item.grossMarketValue) !== null) && item.marketCompCount > 0
      ? "displayable"
      : "Unopened price unavailable";
  }
  const identityStatus = effectiveMarketIdentityStatus(item);
  const identityValid = item.marketProviderIdentityValid === undefined
    ? identityStatus === "Exact Match" || identityStatus === "Manually Confirmed"
    : item.marketProviderIdentityValid;
  if (!identityValid || (identityStatus !== "Exact Match" && identityStatus !== "Manually Confirmed")) {
    return identityStatus === "No Match" ? "Product identity mismatch" : "Match needs review";
  }
  if (!item.marketProviderProductId || !item.marketProviderProductName) return "Matched product unavailable";
  if (!isUnopenedSubtype(item.marketProviderPriceSubtype) || finiteNumber(item.currentMarketEstimate) === null) return "Unopened price unavailable";
  return "displayable";
}

export function hasDisplayableExactMarketPrice(item: MarketTrustItem) {
  return marketPriceDisplayReason(item) === "displayable";
}

export function currentMarketPriceReason(item: MarketTrustItem, now?: Date | number): CurrentMarketPriceReason {
  const displayReason = marketPriceDisplayReason(item);
  if (displayReason !== "displayable") return displayReason;
  if (item.marketProvider !== "TCGCSV") return "current";
  const freshness = inventoryMarketFreshness(item, now).label;
  if (freshness === "Stale" || freshness === "Unavailable") return "Market data stale";
  return "current";
}

export function isCurrentExactMarketPrice(item: MarketTrustItem, now?: Date | number) {
  return currentMarketPriceReason(item, now) === "current";
}

export function potentialMarketProjectionReason(item: MarketTrustItem, now?: Date | number): PotentialMarketProjectionReason {
  const currentReason = currentMarketPriceReason(item, now);
  if (currentReason !== "current") return currentReason === "displayable" ? "Market data stale" : currentReason;
  if (finiteNumber(item.averageCost) === null || item.averageCost <= 0 || item.quantityOwned <= 0) return "Cost basis unavailable";
  if (item.marketProvider !== "TCGCSV") {
    return finiteNumber(item.marketProfitLoss) !== null || finiteNumber(item.grossMarketValue) !== null ? "trusted" : "Estimated net unavailable";
  }
  if (finiteNumber(item.netMarketValue) === null) return "Estimated net unavailable";
  if (finiteNumber(item.marketProfitLoss) === null || finiteNumber(item.marketRoiPercent) === null) return "Estimated net unavailable";
  return "trusted";
}

export function canCalculatePotentialMarketFinancials(item: MarketTrustItem, now?: Date | number) {
  return potentialMarketProjectionReason(item, now) === "trusted";
}
