import type { InventoryItemDTO } from "@/types/radar";

export const POS_PAYMENT_METHOD_VALUES = ["cash", "zelle", "external_card", "other"] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHOD_VALUES)[number];

export const POS_PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  external_card: "External card/manual",
  other: "Other/manual"
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

export function isPosSellableInventoryItem(item: PosSellableItem) {
  const status = `${item.itemStatus} ${item.listingStatus}`.toLowerCase();
  return item.quantityOwned > 0 && posUnitPrice(item) !== null && !/\b(sold|archived|disposed)\b/.test(status);
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
  const subtotal = roundPosMoney(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const tax = roundPosMoney(subtotal * normalizePosTaxRate(taxRate));
  return {
    subtotal,
    tax,
    total: roundPosMoney(subtotal + tax)
  };
}
