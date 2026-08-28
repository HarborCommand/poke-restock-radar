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

export type SyncedProductImageFieldsOptions = {
  removedUrls?: Array<string | null | undefined>;
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
  const validGalleryImages = uniqueProductImageUrls(galleryImages);
  if (validGalleryImages.length > 0) return validGalleryImages;
  const hiddenGalleryUrls = options.publicOnly
    ? uniqueProductImageUrls((product.productImages ?? []).filter((image) => image.showInStore === false).map((image) => image.url))
    : [];
  const legacyImages = uniqueProductImageUrls([
    product.imageUrl,
    ...parseProductImageList(product.publicImages)
  ]);
  const visibleLegacyImages = hiddenGalleryUrls.length
    ? legacyImages.filter((url) => !hiddenGalleryUrls.includes(url))
    : legacyImages;
  return uniqueProductImageUrls([
    ...validGalleryImages,
    ...visibleLegacyImages
  ]);
}

export function getProductImageUrls(product: ProductImageResolverInput, options: ProductImageResolverOptions = {}) {
  const galleryImages = uniqueProductImageUrls(orderedProductGalleryImages(product.productImages, options).map((image) => image.url ?? null));
  const savedImageUrls = getSavedProductImageUrls(product, options);
  if (galleryImages.length > 0) return savedImageUrls;
  const hiddenGalleryUrls = options.publicOnly
    ? uniqueProductImageUrls((product.productImages ?? []).filter((image) => image.showInStore === false).map((image) => image.url))
    : [];
  const fallbackImages = uniqueProductImageUrls([
    ...savedImageUrls,
    product.liveImageUrl,
    product.retailerImageUrl,
    product.product?.liveImageUrl,
    product.product?.imageUrl
  ]);
  return hiddenGalleryUrls.length
    ? fallbackImages.filter((url) => !hiddenGalleryUrls.includes(url))
    : fallbackImages;
}

export function getPrimaryProductImage(product: ProductImageResolverInput, options: ProductImageResolverOptions = {}) {
  return getProductImageUrls(product, options)[0] ?? null;
}

function productImageUrlSet(values: Array<string | null | undefined>) {
  return new Set(uniqueProductImageUrls(values));
}

export function syncedProductImageFields(product: ProductImageResolverInput, options: SyncedProductImageFieldsOptions = {}) {
  const ordered = orderedProductGalleryImages(product.productImages);
  const publicGalleryImages = ordered.filter((image) => image.showInStore !== false);
  if (ordered.length) {
    const publicImages = uniqueProductImageUrls(publicGalleryImages.map((image) => image.url));
    return {
      imageUrl: publicImages[0] ?? null,
      publicImages
    };
  }
  const blockedUrls = productImageUrlSet([
    ...(options.removedUrls ?? []),
    ...ordered.filter((image) => image.showInStore === false).map((image) => image.url)
  ]);
  const keepPublicUrl = (url: string | null | undefined) => {
    const sanitized = sanitizePublicImageUrl(url, "imageUrl").value;
    return Boolean(sanitized && !blockedUrls.has(sanitized));
  };
  const legacyImageUrl = keepPublicUrl(product.imageUrl) ? product.imageUrl ?? null : null;
  const legacyPublicImages = parseProductImageList(product.publicImages).filter(keepPublicUrl);
  const publicImages = uniqueProductImageUrls([
    ...publicGalleryImages.map((image) => image.url),
    legacyImageUrl,
    ...legacyPublicImages
  ]);
  const primary = ordered.find((image) => image.isPrimary) ?? ordered[0] ?? null;
  const publicPrimary = (primary?.showInStore !== false ? primary : publicGalleryImages[0]) ?? null;
  const primaryUrl = uniqueProductImageUrls([publicPrimary?.url])[0] ?? null;
  const legacyUrl = uniqueProductImageUrls([legacyImageUrl])[0] ?? null;
  return {
    imageUrl: primaryUrl ?? legacyUrl ?? publicImages[0] ?? null,
    publicImages
  };
}
