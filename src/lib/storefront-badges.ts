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

export function normalizedNewArrivalDays(days: number | null | undefined) {
  if (!Number.isFinite(days ?? Number.NaN)) return NEW_ARRIVAL_DAYS;
  return Math.min(60, Math.max(1, Math.round(days ?? NEW_ARRIVAL_DAYS)));
}

export function storefrontArrivalDate(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt">) {
  return product.publishedAt || product.createdAt;
}

export function isNewArrival(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt">, now = new Date(), days = NEW_ARRIVAL_DAYS) {
  const timestamp = new Date(storefrontArrivalDate(product)).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return now.getTime() - timestamp <= normalizedNewArrivalDays(days) * 24 * 60 * 60 * 1000;
}

function stockBadge(product: Pick<PublicStoreProductDTO, "availableQuantity">): StorefrontImageBadge | null {
  if (product.availableQuantity <= 0) return null;
  if (product.availableQuantity <= 2) return { label: "LOW STOCK", variant: "low-stock" };
  if (product.availableQuantity <= 5) return { label: "LIMITED STOCK", variant: "limited-stock" };
  return null;
}

export function storefrontImageBadges(product: Pick<PublicStoreProductDTO, "availableQuantity" | "status" | "publishedAt" | "createdAt">, newArrivalDays = NEW_ARRIVAL_DAYS) {
  if (isSoldOutProduct(product)) {
    const badges: StorefrontImageBadge[] = [{ label: "SOLD OUT", variant: "sold-out" }];
    if (isNewArrival(product, new Date(), newArrivalDays)) {
      badges.push({ label: "NEW ARRIVAL", variant: "new-arrival" });
    }
    return badges;
  }

  const badges: StorefrontImageBadge[] = [];
  if (isNewArrival(product, new Date(), newArrivalDays)) {
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
