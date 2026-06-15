import type { PublicStoreProductDTO } from "@/types/radar";

type LimitProduct = Pick<PublicStoreProductDTO, "availableQuantity" | "maxQuantityPerOrder" | "status">;

export function storefrontPurchaseLimit(product: Pick<PublicStoreProductDTO, "maxQuantityPerOrder">) {
  const limit = product.maxQuantityPerOrder;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
}

export function storefrontEffectiveMaxQuantity(product: Pick<PublicStoreProductDTO, "availableQuantity" | "maxQuantityPerOrder">) {
  const availableQuantity = Math.max(0, Math.floor(product.availableQuantity));
  const purchaseLimit = storefrontPurchaseLimit(product);
  return purchaseLimit === null ? availableQuantity : Math.min(availableQuantity, purchaseLimit);
}

export function storefrontPurchaseLimitLabel(product: Pick<PublicStoreProductDTO, "maxQuantityPerOrder">) {
  const purchaseLimit = storefrontPurchaseLimit(product);
  if (purchaseLimit === null) return null;
  return purchaseLimit === 1 ? "Limit 1 per order" : `Maximum ${purchaseLimit} per order`;
}

export function storefrontAvailabilityLabel(product: Pick<LimitProduct, "availableQuantity" | "status">) {
  if (product.status === "sold_out" || product.availableQuantity <= 0) return "Sold Out";
  if (product.availableQuantity <= 2) return "Almost gone";
  if (product.availableQuantity <= 5) return "Low Stock";
  return "In Stock";
}

export function storefrontAvailabilityDetail(product: Pick<LimitProduct, "availableQuantity" | "status">) {
  const label = storefrontAvailabilityLabel(product);
  if (label === "Sold Out") return "Sold out.";
  if (label === "Almost gone") return "Almost gone.";
  if (label === "Low Stock") return "Low stock.";
  return "Available for checkout.";
}
