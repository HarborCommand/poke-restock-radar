import type { InventoryItemDTO } from "@/types/radar";

export type MarketIdentityStatus = "Exact Match" | "Manually Confirmed" | "Strong Suggested Match" | "Needs Review" | "No Match";
export type MarketFreshnessLabel = "Fresh" | "Aging" | "Stale" | "Unavailable";
export type UnsafeMarketReason =
  | "trusted"
  | "Match needs review"
  | "Product identity mismatch"
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
  item: Pick<InventoryItemDTO, "marketProviderIdentityStatus" | "marketProviderMatchStatus">
): MarketIdentityStatus {
  if (item.marketProviderIdentityStatus) return item.marketProviderIdentityStatus;
  if (item.marketProviderMatchStatus === "LOCKED") return "Manually Confirmed";
  if (item.marketProviderMatchStatus === "MATCHED") return "Exact Match";
  if (item.marketProviderMatchStatus === "REVIEW") return "Needs Review";
  return "No Match";
}

export function unsafeMarketReason(item: Pick<
  InventoryItemDTO,
  | "marketProviderIdentityStatus"
  | "marketProviderIdentityValid"
  | "marketProvider"
  | "marketProviderMatchStatus"
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
>, now?: Date | number): UnsafeMarketReason {
  if (item.marketProvider !== "TCGCSV") {
    if ((finiteNumber(item.currentMarketEstimate) === null && finiteNumber(item.grossMarketValue) === null) || item.marketCompCount <= 0) return "Unopened price unavailable";
    if (finiteNumber(item.averageCost) === null || item.averageCost <= 0 || item.quantityOwned <= 0) return "Cost basis unavailable";
    return "trusted";
  }
  const identityStatus = effectiveMarketIdentityStatus(item);
  const identityValid = item.marketProviderIdentityValid === undefined
    ? identityStatus === "Exact Match" || identityStatus === "Manually Confirmed"
    : item.marketProviderIdentityValid;
  if (!identityValid || (identityStatus !== "Exact Match" && identityStatus !== "Manually Confirmed")) {
    return identityStatus === "No Match" ? "Product identity mismatch" : "Match needs review";
  }
  if (!isUnopenedSubtype(item.marketProviderPriceSubtype) || finiteNumber(item.currentMarketEstimate) === null) return "Unopened price unavailable";
  if (inventoryMarketFreshness(item, now).label === "Stale") return "Market data stale";
  if (inventoryMarketFreshness(item, now).label === "Unavailable") return "Market data stale";
  if (finiteNumber(item.averageCost) === null || item.averageCost <= 0 || item.quantityOwned <= 0) return "Cost basis unavailable";
  if (finiteNumber(item.netMarketValue) === null) return "Estimated net unavailable";
  return "trusted";
}

export function isTrustedInventoryMarketPrice(item: Parameters<typeof unsafeMarketReason>[0], now?: Date | number) {
  return unsafeMarketReason(item, now) === "trusted";
}
