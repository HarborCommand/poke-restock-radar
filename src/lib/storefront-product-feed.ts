import { createHash } from "node:crypto";
import { cleanStorefrontTitle } from "@/lib/storefront-copy";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_SEO_SITE_NAME,
  GAMEDAYGRABS_SEO_STORE_NAME,
  productCanonicalUrl,
  storefrontProductMetaDescription
} from "@/lib/storefront-seo";
import { isSoldOutProduct } from "@/lib/storefront-badges";
import { resolvedStorefrontCategory } from "@/lib/storefront-categories";
import { effectiveShippingPackageData, type ShippingProfileDefinition } from "@/lib/shipping";
import { normalizeStorefrontSlug } from "@/lib/storefront-slugs";
import type { PublicStoreProductDTO } from "@/types/radar";

type ProductFeedOptions = {
  includeUnavailable?: boolean;
  profileDefinitions?: Record<string, ShippingProfileDefinition>;
};

type ProductFeedItem = {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: "in stock" | "out of stock";
  price: string;
  condition: "new" | "used" | "refurbished";
  brand: string | null;
  productType: string | null;
  gtin: string | null;
  shippingWeight: string | null;
  shippingLength: string | null;
  shippingWidth: string | null;
  shippingHeight: string | null;
};

const GOOGLE_MERCHANT_ID_MAX_LENGTH = 50;
const GOOGLE_MERCHANT_ID_PREFIX = "gdd";
const GOOGLE_MERCHANT_ID_HASH_LENGTH = 8;

function compactText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteHttpUrl(value: string | null | undefined) {
  const trimmed = compactText(value);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, GAMEDAYGRABS_CANONICAL_ORIGIN);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function merchantIdSlug(value: string | null | undefined) {
  return compactText(value) ? normalizeStorefrontSlug(value, "") : "";
}

function trimMerchantIdSlug(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const hardTrimmed = value.slice(0, maxLength).replace(/-+$/g, "");
  const lastDash = hardTrimmed.lastIndexOf("-");
  if (lastDash >= Math.max(12, Math.floor(maxLength * 0.6))) {
    return hardTrimmed.slice(0, lastDash).replace(/-+$/g, "");
  }
  return hardTrimmed || value.slice(0, maxLength).replace(/-+$/g, "") || "product";
}

function merchantIdHash(product: Pick<PublicStoreProductDTO, "id" | "slug" | "title">) {
  const source = compactText(product.id) || compactText(product.slug) || compactText(product.title);
  return createHash("sha256").update(source || "gamedaygrabs-product").digest("hex").slice(0, GOOGLE_MERCHANT_ID_HASH_LENGTH);
}

export function googleMerchantProductId(product: Pick<PublicStoreProductDTO, "id" | "slug" | "title">) {
  const safeSlug = merchantIdSlug(product.slug);
  if (safeSlug && safeSlug.length <= GOOGLE_MERCHANT_ID_MAX_LENGTH) return safeSlug;

  const hash = merchantIdHash(product);
  const slugSource = safeSlug || merchantIdSlug(product.title) || "product";
  const slugMaxLength = GOOGLE_MERCHANT_ID_MAX_LENGTH - GOOGLE_MERCHANT_ID_PREFIX.length - 2 - hash.length;
  const slugPart = trimMerchantIdSlug(slugSource, slugMaxLength);
  const id = `${GOOGLE_MERCHANT_ID_PREFIX}-${slugPart}-${hash}`;
  return id.length <= GOOGLE_MERCHANT_ID_MAX_LENGTH ? id : `${GOOGLE_MERCHANT_ID_PREFIX}-${hash}`;
}

function productFeedImage(product: Pick<PublicStoreProductDTO, "primaryImageUrl" | "imageUrl" | "images">) {
  const candidates = [product.primaryImageUrl, product.imageUrl, ...(product.images ?? [])];
  for (const candidate of candidates) {
    const image = absoluteHttpUrl(candidate);
    if (image) return image;
  }
  return null;
}

function googleMerchantCondition(product: Pick<PublicStoreProductDTO, "condition">) {
  const condition = compactText(product.condition).toLowerCase();
  if (/refurbished|refurb/.test(condition)) return "refurbished" as const;
  if (/used|pre[-\s]?owned|opened/.test(condition)) return "used" as const;
  return "new" as const;
}

function googleMerchantGtin(product: Pick<PublicStoreProductDTO, "upc">) {
  const digits = compactText(product.upc).replace(/\D/g, "");
  return /^\d{12,14}$/.test(digits) ? digits : null;
}

function pokemonTcgSignal(product: Pick<PublicStoreProductDTO, "title" | "category" | "tags" | "brand" | "manufacturer">) {
  const text = [product.title, product.category, product.brand, product.manufacturer, ...(product.tags ?? [])].join(" ").toLowerCase();
  return /pok[eé]mon|tcg|booster|blister|tin|premium collection|deck|sealed/.test(text);
}

export function googleMerchantBrand(product: Pick<PublicStoreProductDTO, "title" | "category" | "tags" | "brand" | "manufacturer">) {
  return compactText(product.brand) || compactText(product.manufacturer) || (pokemonTcgSignal(product) ? "Pokemon" : null);
}

export function googleMerchantProductType(product: Pick<PublicStoreProductDTO, "title" | "category" | "tags">) {
  const category = compactText(resolvedStorefrontCategory(product));
  if (category === "Booster Bundles") return "Pokemon TCG > Booster Bundles";
  if (category === "Sleeved Boosters") return "Pokemon TCG > Sleeved Boosters";
  if (category === "Premium Collections") return "Pokemon TCG > Premium Collections";
  if (category === "Collection Boxes") return "Pokemon TCG > Collection Boxes";
  if (category === "Blisters") return "Pokemon TCG > Blisters";
  if (category === "Tins") return "Pokemon TCG > Tins";
  if (category === "Elite Trainer Boxes") return "Pokemon TCG > Elite Trainer Boxes";
  if (category === "Booster Boxes") return "Pokemon TCG > Booster Boxes";
  if (category === "Accessories") return "Pokemon TCG > Accessories";
  if (category === "Graded Cards") return "Pokemon TCG > Graded Cards";
  if (/\bdecks?\b/i.test([product.title, category, ...(product.tags ?? [])].join(" "))) return "Pokemon TCG > Decks";
  return category ? `Pokemon TCG > ${category}` : "Pokemon TCG > Sealed Products";
}

function measuredUnit(value: number | null | undefined, unit: "oz" | "in") {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${Number(value.toFixed(2))} ${unit}`;
}

function productFeedItem(product: PublicStoreProductDTO, options: ProductFeedOptions = {}): ProductFeedItem | null {
  if (product.price <= 0 || !Number.isFinite(product.price)) return null;
  const imageLink = productFeedImage(product);
  if (!imageLink) return null;
  const title = cleanStorefrontTitle(product.title);
  const description = storefrontProductMetaDescription(product);
  const packageData = effectiveShippingPackageData(product, options.profileDefinitions);
  return {
    id: googleMerchantProductId(product),
    title,
    description,
    link: productCanonicalUrl(product.slug),
    imageLink,
    availability: isSoldOutProduct(product) ? "out of stock" : "in stock",
    price: `${product.price.toFixed(2)} USD`,
    condition: googleMerchantCondition(product),
    brand: googleMerchantBrand(product),
    productType: googleMerchantProductType(product),
    gtin: googleMerchantGtin(product),
    shippingWeight: measuredUnit(packageData.packageWeightOz, "oz"),
    shippingLength: measuredUnit(packageData.packageLengthIn, "in"),
    shippingWidth: measuredUnit(packageData.packageWidthIn, "in"),
    shippingHeight: measuredUnit(packageData.packageHeightIn, "in")
  };
}

export function storefrontProductFeedItems(products: PublicStoreProductDTO[], options: ProductFeedOptions = {}) {
  const includeUnavailable = options.includeUnavailable ?? false;
  return products
    .filter((product) => includeUnavailable || !isSoldOutProduct(product))
    .map((product) => productFeedItem(product, options))
    .filter((item): item is ProductFeedItem => Boolean(item));
}

function xmlElement(name: string, value: string | null | undefined) {
  if (!value) return null;
  return `    <${name}>${escapeXml(value)}</${name}>`;
}

function productFeedItemXml(item: ProductFeedItem) {
  return [
    "  <item>",
    xmlElement("g:id", item.id),
    xmlElement("title", item.title),
    xmlElement("description", item.description),
    xmlElement("link", item.link),
    xmlElement("g:image_link", item.imageLink),
    xmlElement("g:availability", item.availability),
    xmlElement("g:price", item.price),
    xmlElement("g:condition", item.condition),
    xmlElement("g:brand", item.brand),
    xmlElement("g:product_type", item.productType),
    xmlElement("g:gtin", item.gtin),
    xmlElement("g:shipping_weight", item.shippingWeight),
    xmlElement("g:shipping_length", item.shippingLength),
    xmlElement("g:shipping_width", item.shippingWidth),
    xmlElement("g:shipping_height", item.shippingHeight),
    "  </item>"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function storefrontProductFeedXml(products: PublicStoreProductDTO[], options: ProductFeedOptions = {}) {
  const items = storefrontProductFeedItems(products, options).map(productFeedItemXml).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "<channel>",
    `  <title>${escapeXml(`${GAMEDAYGRABS_SEO_SITE_NAME} Product Feed`)}</title>`,
    `  <link>${escapeXml(GAMEDAYGRABS_CANONICAL_ORIGIN)}</link>`,
    `  <description>${escapeXml(`Public storefront products from ${GAMEDAYGRABS_SEO_STORE_NAME}.`)}</description>`,
    items,
    "</channel>",
    "</rss>"
  ]
    .filter(Boolean)
    .join("\n");
}
