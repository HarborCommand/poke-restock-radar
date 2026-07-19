import type { Metadata } from "next";
import { cleanStorefrontDescription, cleanStorefrontTitle } from "@/lib/storefront-copy";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL, GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";
import { isSoldOutProduct } from "@/lib/storefront-badges";
import { calculateCartShipping } from "@/lib/shipping";
import type { PublicStoreProductDTO } from "@/types/radar";

export const GAMEDAYGRABS_SEO_STORE_NAME = "GameDayGrabs";
export const GAMEDAYGRABS_LEGAL_NAME = "GameDayGrabs LLC";
export const GAMEDAYGRABS_SEO_SITE_NAME = GAMEDAYGRABS_SEO_STORE_NAME;
export const GAMEDAYGRABS_CANONICAL_ORIGIN = `https://${GAMEDAYGRABS_WWW_DOMAIN}`;
export const GAMEDAYGRABS_OG_FALLBACK_IMAGE = "/brand/gamedaygrabs-icon.png?v=gdg-icons-v1";
export const GAMEDAYGRABS_POLICIES_URL = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies`;
export const GAMEDAYGRABS_SHIPPING_POLICY_URL = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies/shipping`;
export const GAMEDAYGRABS_RETURNS_POLICY_URL = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies/returns`;
export const GAMEDAYGRABS_PRIVACY_POLICY_URL = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/privacy`;
export const GAMEDAYGRABS_TERMS_URL = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/terms`;
export const GAMEDAYGRABS_SINGLE_ITEM_SHIPPING_SCHEMA_MINIMUM = 7.99;

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
  const trimmed = sliced.slice(0, lastSpace > 90 ? lastSpace : maxLength - 1).trim().replace(/[.!?]+$/g, "");
  return `${trimmed}.`;
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
  const description = compactText(cleanStorefrontDescription(product));
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

function positiveMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

export function storefrontOfferShippingDetails(product: Pick<SeoProduct, "shippingAvailable" | "shippingProfile" | "packageWeightOz" | "packageLengthIn" | "packageWidthIn" | "packageHeightIn" | "freeShippingEligible" | "requiresBox" | "insuranceRecommended" | "localPickupEligible" | "localPickupAvailable">) {
  if (product.shippingAvailable === false) return null;
  const calculated = calculateCartShipping([product], { fulfillmentMethod: "shipping" });
  const shippingOption = calculated.shippingOptions.find((option) => option.id !== "local_pickup") ?? calculated.defaultShippingOption;
  if (!shippingOption || shippingOption.id === "local_pickup") return null;
  const shippingAmount = positiveMoney(shippingOption.amount);
  if (shippingAmount === null) return null;
  const policyAlignedShippingAmount = Math.max(shippingAmount, GAMEDAYGRABS_SINGLE_ITEM_SHIPPING_SCHEMA_MINIMUM);

  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: policyAlignedShippingAmount.toFixed(2),
      currency: "USD"
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: "US"
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      businessDays: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "https://schema.org/Monday",
          "https://schema.org/Tuesday",
          "https://schema.org/Wednesday",
          "https://schema.org/Thursday",
          "https://schema.org/Friday"
        ]
      },
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: 1,
        maxValue: 2,
        unitCode: "d"
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: 2,
        maxValue: 5,
        unitCode: "d"
      }
    }
  };
}

export function storefrontOfferReturnPolicy() {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "US",
    returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
    merchantReturnLink: GAMEDAYGRABS_RETURNS_POLICY_URL
  };
}

export function storefrontProductJsonLd(product: SeoProduct) {
  const canonicalUrl = productCanonicalUrl(product.slug);
  const description = storefrontProductMetaDescription(product);
  const brand = cleanIdentifier(product.brand);
  const manufacturer = cleanIdentifier(product.manufacturer);
  const shippingDetails = storefrontOfferShippingDetails(product);
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
      ...(shippingDetails ? { shippingDetails } : {}),
      hasMerchantReturnPolicy: storefrontOfferReturnPolicy(),
      seller: {
        "@type": "Organization",
        name: GAMEDAYGRABS_SEO_STORE_NAME,
        legalName: GAMEDAYGRABS_LEGAL_NAME,
        url: GAMEDAYGRABS_CANONICAL_ORIGIN
      }
    }
  };
  if (brand) data.brand = { "@type": "Brand", name: brand };
  if (manufacturer && manufacturer !== brand) data.manufacturer = { "@type": "Organization", name: manufacturer };
  // Reviews and aggregateRating stay omitted until real, visible first-party product reviews exist.
  return data;
}

export function storefrontJsonLdScript(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function storefrontOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: GAMEDAYGRABS_SEO_STORE_NAME,
    legalName: GAMEDAYGRABS_LEGAL_NAME,
    url: GAMEDAYGRABS_CANONICAL_ORIGIN,
    logo: absoluteStorefrontUrl(GAMEDAYGRABS_OG_FALLBACK_IMAGE),
    email: GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  };
}
