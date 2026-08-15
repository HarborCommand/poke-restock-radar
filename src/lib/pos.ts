import type { InventoryItemDTO } from "@/types/radar";
import { calculateConfiguredPosTax, centsToMoney, moneyToCents } from "@/lib/tax";

export const POS_PAYMENT_METHOD_VALUES = ["cash", "zelle", "external_card", "other"] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHOD_VALUES)[number];
export const POS_DISCOUNT_REASON_VALUES = ["customer_discount", "price_match", "damaged_packaging", "promotion", "owner_override", "other"] as const;
export type PosDiscountReason = (typeof POS_DISCOUNT_REASON_VALUES)[number];
export const POS_REFUND_REASON_VALUES = ["customer_return", "damaged_product", "wrong_item", "duplicate_sale", "price_correction", "other"] as const;
export type PosRefundReason = (typeof POS_REFUND_REASON_VALUES)[number];

export const POS_PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  external_card: "Card · Square",
  other: "Other/manual"
};

export const POS_DISCOUNT_REASON_LABELS: Record<PosDiscountReason, string> = {
  customer_discount: "Customer discount",
  price_match: "Price match",
  damaged_packaging: "Damaged packaging",
  promotion: "Promotion",
  owner_override: "Owner override",
  other: "Other"
};

export const POS_REFUND_REASON_LABELS: Record<PosRefundReason, string> = {
  customer_return: "Customer return",
  damaged_product: "Damaged product",
  wrong_item: "Wrong item",
  duplicate_sale: "Duplicate sale",
  price_correction: "Price correction",
  other: "Other"
};

export const POS_TAX_RATE_ENV = "POS_TAX_RATE";
export const POS_DEFAULT_TAX_RATE = 0;

type PosPriceItem = Pick<InventoryItemDTO, "publicPrice" | "targetSellPrice">;
type PosSellableItem = Pick<InventoryItemDTO, "quantityOwned" | "itemStatus" | "listingStatus" | "publicPrice" | "targetSellPrice">;

export function roundPosMoney(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

export function posUnitPrice(item: PosPriceItem) {
  const price = item.publicPrice ?? item.targetSellPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? roundPosMoney(price) : null;
}

function posBlockedStatusReason(item: Pick<PosSellableItem, "itemStatus" | "listingStatus">) {
  const status = `${item.itemStatus} ${item.listingStatus}`.toLowerCase();
  if (/\b(archived|disposed|deleted)\b/.test(status)) return "Archived or disposed";
  if (/\b(closed|not[-_ ]for[-_ ]sale)\b/.test(status)) return "Marked sold";
  return null;
}

export function getPosExcludedReason(item: PosSellableItem) {
  if (item.quantityOwned <= 0) return "No on-hand quantity";
  const blockedStatusReason = posBlockedStatusReason(item);
  if (blockedStatusReason) return blockedStatusReason;
  if (posUnitPrice(item) === null) return "Missing POS sale price";
  return null;
}

export function getPosSellableReason(item: PosSellableItem) {
  return getPosExcludedReason(item) ?? "Ready for POS sale";
}

export function isPosSellableInventoryItem(item: PosSellableItem) {
  return getPosExcludedReason(item) === null;
}

export function normalizePosCode(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function posItemExactCodeMatch(item: Pick<InventoryItemDTO, "upc" | "sku" | "dpci" | "asin" | "productId">, code: string) {
  const normalized = normalizePosCode(code);
  if (!normalized) return false;
  return [item.upc, item.sku, item.dpci, item.asin, item.productId]
    .map((identifier) => normalizePosCode(identifier))
    .filter(Boolean)
    .includes(normalized);
}

export function posItemSearchText(
  item: Pick<InventoryItemDTO, "itemName" | "publicTitle" | "upc" | "sku" | "dpci" | "asin" | "setName" | "category" | "brand" | "retailer">
) {
  return [
    item.itemName,
    item.publicTitle,
    item.upc,
    item.sku,
    item.dpci,
    item.asin,
    item.setName,
    item.category,
    item.brand,
    item.retailer
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function posItemMatchesQuery(
  item: Pick<InventoryItemDTO, "itemName" | "publicTitle" | "upc" | "sku" | "dpci" | "asin" | "setName" | "category" | "brand" | "retailer">,
  query: string
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return posItemSearchText(item).includes(normalized);
}

export function normalizePosPaymentMethod(value: string | null | undefined): PosPaymentMethod | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return POS_PAYMENT_METHOD_VALUES.find((method) => method === normalized) ?? null;
}

export function posPaymentMethodLabel(method: PosPaymentMethod) {
  return POS_PAYMENT_METHOD_LABELS[method];
}

export function normalizePosDiscountReason(value: string | null | undefined): PosDiscountReason | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return POS_DISCOUNT_REASON_VALUES.find((reason) => reason === normalized) ?? null;
}

export function posDiscountReasonLabel(reason: PosDiscountReason) {
  return POS_DISCOUNT_REASON_LABELS[reason];
}

export function normalizePosRefundReason(value: string | null | undefined): PosRefundReason | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return POS_REFUND_REASON_VALUES.find((reason) => reason === normalized) ?? null;
}

export function posRefundReasonLabel(reason: PosRefundReason) {
  return POS_REFUND_REASON_LABELS[reason];
}

export function normalizePosTaxRate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return POS_DEFAULT_TAX_RATE;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric) || numeric < 0) return POS_DEFAULT_TAX_RATE;
  const decimalRate = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(decimalRate, 1);
}

export function getConfiguredPosTaxRate(env: Record<string, string | undefined> = process.env) {
  return normalizePosTaxRate(env[POS_TAX_RATE_ENV]);
}

export function calculatePosTotals(lines: Array<{ quantity: number; unitPrice: number }>, taxRate = POS_DEFAULT_TAX_RATE) {
  const subtotalCents = lines.reduce((sum, line) => sum + Math.max(0, Math.trunc(line.quantity)) * moneyToCents(line.unitPrice), 0);
  const rateBasisPoints = Math.round(normalizePosTaxRate(taxRate) * 10_000);
  const calculated = calculateConfiguredPosTax({
    subtotalCents,
    profile: {
      country: "US",
      state: "FL",
      county: null,
      stateRateBasisPoints: rateBasisPoints,
      countyRateBasisPoints: 0,
      effectiveAt: null,
      sourceNote: null,
      enabled: rateBasisPoints > 0
    }
  });
  return {
    subtotal: centsToMoney(calculated.subtotalCents),
    tax: centsToMoney(calculated.taxCents),
    total: centsToMoney(calculated.totalCents)
  };
}
