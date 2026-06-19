import { cleanStorefrontTitle } from "@/lib/storefront-copy";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_SEO_SITE_NAME,
  GAMEDAYGRABS_SEO_STORE_NAME,
  productCanonicalUrl,
  storefrontProductMetaDescription
} from "@/lib/storefront-seo";
import { isSoldOutProduct } from "@/lib/storefront-badges";
import { effectiveShippingPackageData, type ShippingProfileDefinition } from "@/lib/shipping";
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
  const text = [product.title, product.category, ...(product.tags ?? [])].join(" ").toLowerCase();
  if (/booster bundle/.test(text)) return "Pokemon TCG > Booster Bundles";
  if (/sleeved booster|sleeved/.test(text)) return "Pokemon TCG > Sleeved Boosters";
  if (/premium collection|collection box|premium box/.test(text)) return "Pokemon TCG > Premium Collections";
  if (/checklane|blister/.test(text)) return "Pokemon TCG > Blisters";
  if (/\btins?\b/.test(text)) return "Pokemon TCG > Tins";
  if (/\bdecks?\b/.test(text)) return "Pokemon TCG > Decks";
  const category = compactText(product.category);
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
  const description = compactText(product.description) || storefrontProductMetaDescription(product);
  const packageData = effectiveShippingPackageData(product, options.profileDefinitions);
  return {
    id: product.slug,
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
