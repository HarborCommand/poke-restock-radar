import type { Metadata } from "next";
import { cleanStorefrontTitle } from "@/lib/storefront-copy";
import { GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";
import { isSoldOutProduct } from "@/lib/storefront-badges";
import type { PublicStoreProductDTO } from "@/types/radar";

export const GAMEDAYGRABS_SEO_STORE_NAME = "GameDayGrabs";
export const GAMEDAYGRABS_SEO_SITE_NAME = "GameDayGrabs LLC";
export const GAMEDAYGRABS_CANONICAL_ORIGIN = `https://${GAMEDAYGRABS_WWW_DOMAIN}`;
export const GAMEDAYGRABS_OG_FALLBACK_IMAGE = "/brand/gamedaygrabs-icon.png?v=gdg-icons-v1";

type SeoProduct = PublicStoreProductDTO & {
  brand?: string | null;
  manufacturer?: string | null;
  sku?: string | null;
  upc?: string | null;
};

function absoluteStorefrontUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${GAMEDAYGRABS_CANONICAL_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function compactText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function trimForMeta(value: string, maxLength = 158) {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  const sliced = compact.slice(0, maxLength - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 90 ? lastSpace : maxLength - 1).trim()}.`;
}

function moneyForMeta(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function productCanonicalPath(slug: string) {
  return `/product/${encodeURIComponent(slug)}`;
}

export function productCanonicalUrl(slug: string) {
  return absoluteStorefrontUrl(productCanonicalPath(slug));
}

export function storefrontProductTitle(product: Pick<SeoProduct, "title">) {
  return `${cleanStorefrontTitle(product.title)} | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
}

export function storefrontProductAvailabilityText(product: Pick<SeoProduct, "availabilityLevel" | "status">) {
  return isSoldOutProduct(product) ? "Out of stock" : "In stock";
}

export function storefrontProductSchemaAvailability(product: Pick<SeoProduct, "availabilityLevel" | "status">) {
  return isSoldOutProduct(product) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock";
}

export function storefrontProductMetaDescription(product: Pick<SeoProduct, "title" | "description" | "category" | "price" | "availabilityLevel" | "status">) {
  const title = cleanStorefrontTitle(product.title);
  const description = compactText(product.description);
  const prefix = `Shop ${title} from ${GAMEDAYGRABS_SEO_STORE_NAME}. ${product.category}. ${moneyForMeta(product.price)}. ${storefrontProductAvailabilityText(product)}.`;
  return trimForMeta(description ? `${prefix} ${description}` : prefix);
}

function productMetadataImages(product: Pick<SeoProduct, "primaryImageUrl" | "imageUrl" | "images">) {
  const images = [product.primaryImageUrl, product.imageUrl, ...(product.images ?? [])]
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .map(absoluteStorefrontUrl);
  return images.length ? Array.from(new Set(images)) : [absoluteStorefrontUrl(GAMEDAYGRABS_OG_FALLBACK_IMAGE)];
}

export function storefrontProductMetadata(product: SeoProduct): Metadata {
  const title = storefrontProductTitle(product);
  const description = storefrontProductMetaDescription(product);
  const canonicalUrl = productCanonicalUrl(product.slug);
  const images = productMetadataImages(product);
  return {
    metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
    title,
    description,
    alternates: {
      canonical: canonicalUrl
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonicalUrl,
      siteName: GAMEDAYGRABS_SEO_SITE_NAME,
      images
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images
    }
  };
}

function cleanIdentifier(value: string | null | undefined) {
  const cleaned = compactText(value);
  return cleaned.length > 0 && cleaned.length <= 80 ? cleaned : null;
}

function productIdentifierFields(product: Pick<SeoProduct, "sku" | "upc">) {
  const fields: Record<string, string> = {};
  const sku = cleanIdentifier(product.sku);
  const upc = cleanIdentifier(product.upc)?.replace(/\D/g, "") ?? null;
  if (sku) fields.sku = sku;
  if (upc && /^\d{12}$/.test(upc)) fields.gtin12 = upc;
  if (upc && /^\d{13}$/.test(upc)) fields.gtin13 = upc;
  if (upc && /^\d{14}$/.test(upc)) fields.gtin14 = upc;
  return fields;
}

export function storefrontProductJsonLd(product: SeoProduct) {
  const canonicalUrl = productCanonicalUrl(product.slug);
  const description = storefrontProductMetaDescription(product);
  const brand = cleanIdentifier(product.brand);
  const manufacturer = cleanIdentifier(product.manufacturer);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: cleanStorefrontTitle(product.title),
    description,
    image: productMetadataImages(product),
    category: product.category,
    url: canonicalUrl,
    ...productIdentifierFields(product),
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      price: product.price.toFixed(2),
      priceCurrency: "USD",
      availability: storefrontProductSchemaAvailability(product),
      seller: {
        "@type": "Organization",
        name: GAMEDAYGRABS_SEO_STORE_NAME
      }
    }
  };
  if (brand) data.brand = { "@type": "Brand", name: brand };
  if (manufacturer && manufacturer !== brand) data.manufacturer = { "@type": "Organization", name: manufacturer };
  return data;
}

export function storefrontJsonLdScript(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
