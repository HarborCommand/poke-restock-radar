import type { PublicStoreProductDTO } from "@/types/radar";

type LimitProduct = Pick<PublicStoreProductDTO, "availabilityLevel" | "maxQuantityPerOrder" | "publicMaxQuantity" | "status">;

export const DEFAULT_STOREFRONT_PURCHASE_LIMIT = 4;

export function storefrontPurchaseLimit(product: Pick<PublicStoreProductDTO, "maxQuantityPerOrder">) {
  const limit = product.maxQuantityPerOrder;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
}

export function storefrontConfiguredPurchaseLimit(
  product: Pick<PublicStoreProductDTO, "maxQuantityPerOrder"> & { purchaseLimitEnabled?: boolean | null }
) {
  const limit = storefrontPurchaseLimit(product);
  if (limit === null) return null;
  if (product.purchaseLimitEnabled) return limit;

  // Backward compatibility for listings where the numeric limit was set before
  // the explicit enable flag was saved. The old default was 4.
  return limit !== DEFAULT_STOREFRONT_PURCHASE_LIMIT ? limit : null;
}

export function storefrontEffectiveMaxQuantity(product: Pick<PublicStoreProductDTO, "publicMaxQuantity" | "maxQuantityPerOrder">) {
  const availableQuantity = Math.max(0, Math.floor(product.publicMaxQuantity));
  const purchaseLimit = storefrontPurchaseLimit(product);
  return purchaseLimit === null ? availableQuantity : Math.min(availableQuantity, purchaseLimit);
}

export function storefrontPurchaseLimitLabel(product: Pick<PublicStoreProductDTO, "maxQuantityPerOrder">) {
  const purchaseLimit = storefrontPurchaseLimit(product);
  if (purchaseLimit === null) return null;
  return purchaseLimit === 1 ? "Limit 1 per order" : `Maximum ${purchaseLimit} per order`;
}

export function storefrontAvailabilityLabel(product: Pick<LimitProduct, "availabilityLevel" | "status">) {
  if (product.status === "sold_out" || product.availabilityLevel === "sold_out") return "Sold Out";
  if (product.availabilityLevel === "almost_gone") return "Almost gone";
  if (product.availabilityLevel === "low_stock") return "Low Stock";
  return "In Stock";
}

export function storefrontAvailabilityDetail(product: Pick<LimitProduct, "availabilityLevel" | "status">) {
  const label = storefrontAvailabilityLabel(product);
  if (label === "Sold Out") return "Sold out.";
  if (label === "Almost gone") return "Almost gone.";
  if (label === "Low Stock") return "Low stock.";
  return "Available for checkout.";
}
