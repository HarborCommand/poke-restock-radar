import { sanitizePublicImageUrl } from "@/lib/validation";

export type ProductImageCandidate = {
  url?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
  createdAt?: Date | string | null;
  showInStore?: boolean | null;
};

export type ProductImageResolverInput = {
  productImages?: ProductImageCandidate[] | null;
  imageUrl?: string | null;
  publicImages?: string | string[] | null;
  liveImageUrl?: string | null;
  retailerImageUrl?: string | null;
  product?: {
    liveImageUrl?: string | null;
    imageUrl?: string | null;
  } | null;
};

export type ProductImageResolverOptions = {
  publicOnly?: boolean;
};

export function parseProductImageList(value: string | string[] | null | undefined) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
  } catch {
    return value.split(",");
  }
  return [];
}

export function uniqueProductImageUrls(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => sanitizePublicImageUrl(value, "imageUrl").value)
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function imageCreatedAtTime(value: ProductImageCandidate) {
  if (!value.createdAt) return 0;
  const timestamp = value.createdAt instanceof Date ? value.createdAt.getTime() : Date.parse(value.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function orderedProductGalleryImages(images: ProductImageCandidate[] | null | undefined, options: ProductImageResolverOptions = {}) {
  return [...(images ?? [])]
    .filter((image) => Boolean(image.url))
    .filter((image) => (options.publicOnly ? image.showInStore !== false : true))
    .sort((left, right) => {
      if (Boolean(left.isPrimary) !== Boolean(right.isPrimary)) return left.isPrimary ? -1 : 1;
      const leftSort = left.sortOrder ?? 0;
      const rightSort = right.sortOrder ?? 0;
      if (leftSort !== rightSort) return leftSort - rightSort;
      return imageCreatedAtTime(left) - imageCreatedAtTime(right);
    });
}

export function getSavedProductImageUrls(product: ProductImageResolverInput, options: ProductImageResolverOptions = {}) {
  const galleryImages = orderedProductGalleryImages(product.productImages, options).map((image) => image.url ?? null);
  return uniqueProductImageUrls([
    ...galleryImages,
    product.imageUrl,
    ...parseProductImageList(product.publicImages)
  ]);
}

export function getProductImageUrls(product: ProductImageResolverInput, options: ProductImageResolverOptions = {}) {
  return uniqueProductImageUrls([
    ...getSavedProductImageUrls(product, options),
    product.liveImageUrl,
    product.retailerImageUrl,
    product.product?.liveImageUrl,
    product.product?.imageUrl
  ]);
}

export function getPrimaryProductImage(product: ProductImageResolverInput, options: ProductImageResolverOptions = {}) {
  return getProductImageUrls(product, options)[0] ?? null;
}
