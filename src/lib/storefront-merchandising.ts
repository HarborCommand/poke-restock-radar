import { isSoldOutProduct } from "@/lib/storefront-badges";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import type { PublicStoreProductDTO } from "@/types/radar";

export function storefrontMerchandisingText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function storefrontMerchandisingTime(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt" | "updatedAt">) {
  const timestamp = Date.parse(product.publishedAt ?? product.createdAt ?? product.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function isSellableStorefrontProduct(product: Pick<PublicStoreProductDTO, "status" | "availabilityLevel" | "publicMaxQuantity">) {
  return !isSoldOutProduct(product) && product.status === "active" && product.publicMaxQuantity > 0;
}

export function storefrontProductStableKey(product: Pick<PublicStoreProductDTO, "slug" | "id" | "title">) {
  return storefrontMerchandisingText(product.slug || product.id || product.title);
}

export function compareStorefrontStableProductTie(left: PublicStoreProductDTO, right: PublicStoreProductDTO) {
  return (
    storefrontProductStableKey(left).localeCompare(storefrontProductStableKey(right), undefined, { sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
  );
}

export function storefrontProductTypeSignal(product: Pick<PublicStoreProductDTO, "productType" | "category" | "tags" | "title">) {
  const explicitType = storefrontMerchandisingText(product.productType);
  if (explicitType) return explicitType;
  const category = storefrontMerchandisingText(displayStorefrontCategory(product));
  if (category) return category;
  const joinedTags = product.tags.map(storefrontMerchandisingText).filter(Boolean).join(" ");
  if (joinedTags) return joinedTags;
  return storefrontMerchandisingText(product.title);
}

export function storefrontProductSetSignal(product: Pick<PublicStoreProductDTO, "setName">) {
  return storefrontMerchandisingText(product.setName);
}

export function storefrontProductCategorySignal(product: Pick<PublicStoreProductDTO, "category" | "tags" | "title">) {
  return storefrontMerchandisingText(displayStorefrontCategory(product));
}

export function compareStorefrontFeaturedProducts(left: PublicStoreProductDTO, right: PublicStoreProductDTO) {
  const sellableDelta = Number(isSellableStorefrontProduct(right)) - Number(isSellableStorefrontProduct(left));
  if (sellableDelta !== 0) return sellableDelta;
  const newestDelta = storefrontMerchandisingTime(right) - storefrontMerchandisingTime(left);
  if (newestDelta !== 0) return newestDelta;
  return compareStorefrontStableProductTie(left, right);
}

export function compareStorefrontNewestProducts(left: PublicStoreProductDTO, right: PublicStoreProductDTO) {
  const newestDelta = storefrontMerchandisingTime(right) - storefrontMerchandisingTime(left);
  if (newestDelta !== 0) return newestDelta;
  return compareStorefrontStableProductTie(left, right);
}

function relatedPriceScore(source: PublicStoreProductDTO, candidate: PublicStoreProductDTO) {
  return Math.abs(candidate.price - source.price);
}

export function compareRelatedStorefrontProducts(source: PublicStoreProductDTO) {
  const sourceSet = storefrontProductSetSignal(source);
  const sourceCategory = storefrontProductCategorySignal(source);
  const sourceType = storefrontProductTypeSignal(source);

  return (left: PublicStoreProductDTO, right: PublicStoreProductDTO) => {
    const leftSetScore = sourceSet && storefrontProductSetSignal(left) === sourceSet ? 0 : 1;
    const rightSetScore = sourceSet && storefrontProductSetSignal(right) === sourceSet ? 0 : 1;
    if (leftSetScore !== rightSetScore) return leftSetScore - rightSetScore;

    const leftCategoryScore = sourceCategory && storefrontProductCategorySignal(left) === sourceCategory ? 0 : 1;
    const rightCategoryScore = sourceCategory && storefrontProductCategorySignal(right) === sourceCategory ? 0 : 1;
    if (leftCategoryScore !== rightCategoryScore) return leftCategoryScore - rightCategoryScore;

    const leftTypeScore = sourceType && storefrontProductTypeSignal(left) === sourceType ? 0 : 1;
    const rightTypeScore = sourceType && storefrontProductTypeSignal(right) === sourceType ? 0 : 1;
    if (leftTypeScore !== rightTypeScore) return leftTypeScore - rightTypeScore;

    const priceDelta = relatedPriceScore(source, left) - relatedPriceScore(source, right);
    if (priceDelta !== 0) return priceDelta;

    const newestDelta = storefrontMerchandisingTime(right) - storefrontMerchandisingTime(left);
    if (newestDelta !== 0) return newestDelta;

    return compareStorefrontStableProductTie(left, right);
  };
}

export function uniqueStorefrontProducts(products: PublicStoreProductDTO[]) {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = product.id || product.slug;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
