import type { PublicStoreProductDTO } from "@/types/radar";

export type StorefrontImageBadge = {
  label: string;
  variant: "sold-out" | "new-arrival" | "low-stock" | "limited-stock";
};

export type StorefrontAvailabilityFilter = "all" | "in-stock" | "sold-out";

export const NEW_ARRIVAL_DAYS = 14;

export function isSoldOutProduct(product: Pick<PublicStoreProductDTO, "availabilityLevel" | "status">) {
  return product.status === "sold_out" || product.availabilityLevel === "sold_out";
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

function stockBadge(product: Pick<PublicStoreProductDTO, "availabilityLevel">): StorefrontImageBadge | null {
  if (product.availabilityLevel === "almost_gone") return { label: "LOW STOCK", variant: "low-stock" };
  if (product.availabilityLevel === "low_stock") return { label: "LIMITED STOCK", variant: "limited-stock" };
  return null;
}

export function storefrontImageBadges(product: Pick<PublicStoreProductDTO, "availabilityLevel" | "status" | "publishedAt" | "createdAt">, newArrivalDays = NEW_ARRIVAL_DAYS) {
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

export function storefrontPrimaryActionDisabled(product: Pick<PublicStoreProductDTO, "availabilityLevel" | "status">) {
  return isSoldOutProduct(product);
}

export function storefrontMatchesAvailability(
  product: Pick<PublicStoreProductDTO, "availabilityLevel" | "status">,
  filter: StorefrontAvailabilityFilter
) {
  if (filter === "all") return true;
  if (filter === "sold-out") return isSoldOutProduct(product);
  return !isSoldOutProduct(product);
}
