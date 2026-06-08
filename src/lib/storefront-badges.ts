import type { PublicStoreProductDTO } from "@/types/radar";

export type StorefrontImageBadge = {
  label: string;
  variant: "sold-out" | "new-arrival" | "low-stock" | "limited-stock";
};

export type StorefrontAvailabilityFilter = "all" | "in-stock" | "sold-out";

export const NEW_ARRIVAL_DAYS = 14;

export function isSoldOutProduct(product: Pick<PublicStoreProductDTO, "availableQuantity" | "status">) {
  return product.status === "sold_out" || product.availableQuantity <= 0;
}

export function isNewArrival(product: Pick<PublicStoreProductDTO, "createdAt" | "updatedAt">, now = new Date()) {
  const created = new Date(product.createdAt).getTime();
  const updated = new Date(product.updatedAt).getTime();
  const timestamp = Math.max(created, updated);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return now.getTime() - timestamp <= NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000;
}

function stockBadge(product: Pick<PublicStoreProductDTO, "availableQuantity">): StorefrontImageBadge | null {
  if (product.availableQuantity <= 0) return null;
  if (product.availableQuantity <= 2) return { label: "LOW STOCK", variant: "low-stock" };
  if (product.availableQuantity <= 5) return { label: "LIMITED STOCK", variant: "limited-stock" };
  return null;
}

export function storefrontImageBadges(product: Pick<PublicStoreProductDTO, "availableQuantity" | "status" | "createdAt" | "updatedAt">) {
  if (isSoldOutProduct(product)) {
    const badges: StorefrontImageBadge[] = [{ label: "SOLD OUT", variant: "sold-out" }];
    if (isNewArrival(product)) {
      badges.push({ label: "NEW ARRIVAL", variant: "new-arrival" });
    }
    return badges;
  }

  const badges: StorefrontImageBadge[] = [];
  if (isNewArrival(product)) {
    badges.push({ label: "NEW ARRIVAL", variant: "new-arrival" });
  }

  const quantityBadge = stockBadge(product);
  if (quantityBadge) {
    badges.push(quantityBadge);
  }

  return badges;
}

export function storefrontPrimaryActionDisabled(product: Pick<PublicStoreProductDTO, "availableQuantity" | "status">) {
  return isSoldOutProduct(product);
}

export function storefrontMatchesAvailability(
  product: Pick<PublicStoreProductDTO, "availableQuantity" | "status">,
  filter: StorefrontAvailabilityFilter
) {
  if (filter === "all") return true;
  if (filter === "sold-out") return isSoldOutProduct(product);
  return !isSoldOutProduct(product);
}
