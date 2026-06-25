import type { Metadata } from "next";
import { isNewArrival, isSoldOutProduct } from "@/lib/storefront-badges";
import { storefrontCategoryMatches } from "@/lib/storefront-categories";
import { cleanStorefrontTitle } from "@/lib/storefront-copy";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_SEO_SITE_NAME,
  productCanonicalUrl,
  storefrontJsonLdScript
} from "@/lib/storefront-seo";
import type { PublicStoreProductDTO } from "@/types/radar";

export type StorefrontCollectionMode = "category" | "new_arrivals" | "almost_gone" | "local_pickup";

export type StorefrontCollectionDefinition = {
  slug: string;
  title: string;
  shortTitle: string;
  seoTitle: string;
  metaDescription: string;
  intro: string;
  detail: string;
  category?: string;
  mode: StorefrontCollectionMode;
  relatedSlugs: string[];
};

export const storefrontCollections: StorefrontCollectionDefinition[] = [
  {
    slug: "pokemon-sealed-products",
    title: "Pokemon Sealed Products",
    shortTitle: "Pokemon Sealed",
    seoTitle: "Pokemon Sealed Products | GameDayGrabs LLC",
    metaDescription: "Shop sealed Pokemon TCG products packed carefully for collectors. Browse booster bundles, tins, blisters, and premium collections from GameDayGrabs.",
    intro: "Shop sealed Pokemon TCG products packed carefully for collectors.",
    detail: "Browse booster bundles, tins, blisters, and premium collections available through GameDayGrabs. Availability can change quickly, and items are confirmed at checkout.",
    category: "Pokemon Sealed",
    mode: "category",
    relatedSlugs: ["booster-bundles", "tins", "blisters", "premium-collections", "new-arrivals"]
  },
  {
    slug: "booster-bundles",
    title: "Booster Bundles",
    shortTitle: "Booster Bundles",
    seoTitle: "Pokemon Booster Bundles | GameDayGrabs LLC",
    metaDescription: "Browse Pokemon booster bundles from GameDayGrabs with secure checkout, careful packaging, and product availability confirmed before payment.",
    intro: "Browse Pokemon booster bundles for compact sealed pack openings.",
    detail: "Booster bundles are listed with customer-facing availability and clear product pages. Final shipping is shown before payment.",
    category: "Booster Bundles",
    mode: "category",
    relatedSlugs: ["pokemon-sealed-products", "blisters", "premium-collections", "new-arrivals"]
  },
  {
    slug: "tins",
    title: "Pokemon Tins",
    shortTitle: "Tins",
    seoTitle: "Pokemon Tins | GameDayGrabs LLC",
    metaDescription: "Shop Pokemon tins and Pokeball tins from GameDayGrabs. Products are packed carefully and availability is confirmed during checkout.",
    intro: "Shop Pokemon tins, mini tins, and Pokeball-style sealed products.",
    detail: "Tins are useful collector gifts and sealed product pickups. Listings keep inventory quantity private while keeping sold-out items clearly labeled.",
    category: "Tins",
    mode: "category",
    relatedSlugs: ["pokemon-sealed-products", "booster-bundles", "premium-collections", "local-pickup-eligible"]
  },
  {
    slug: "blisters",
    title: "Pokemon Blisters",
    shortTitle: "Blisters",
    seoTitle: "Pokemon Blisters | GameDayGrabs LLC",
    metaDescription: "Find Pokemon blister packs, checklane blisters, and multi-pack blisters from GameDayGrabs with secure checkout and careful packaging.",
    intro: "Find Pokemon blister packs, checklane blisters, and multi-pack sealed products.",
    detail: "Blister listings focus on product type, price, availability, and clear checkout expectations without exposing internal inventory quantity.",
    category: "Blisters",
    mode: "category",
    relatedSlugs: ["pokemon-sealed-products", "booster-bundles", "premium-collections", "almost-gone"]
  },
  {
    slug: "premium-collections",
    title: "Premium Collections",
    shortTitle: "Premium Collections",
    seoTitle: "Pokemon Premium Collections | GameDayGrabs LLC",
    metaDescription: "Shop Pokemon premium collections and collector boxes from GameDayGrabs with careful packaging, secure checkout, and order support.",
    intro: "Shop Pokemon premium collections and collector-focused boxed products.",
    detail: "Premium collection pages link directly to canonical product pages with shipping, checkout hold, and support details shown before purchase.",
    category: "Premium Collections",
    mode: "category",
    relatedSlugs: ["pokemon-sealed-products", "booster-bundles", "tins", "blisters"]
  },
  {
    slug: "new-arrivals",
    title: "New Arrivals",
    shortTitle: "New Arrivals",
    seoTitle: "New Pokemon TCG Arrivals | GameDayGrabs LLC",
    metaDescription: "Browse recently published Pokemon TCG products from GameDayGrabs. Availability is confirmed at checkout and sold-out products are not shown as active arrivals.",
    intro: "Browse recently added Pokemon TCG products from GameDayGrabs.",
    detail: "New arrivals are based on recently published storefront listings. Availability can change quickly, and checkout confirms items before payment.",
    mode: "new_arrivals",
    relatedSlugs: ["pokemon-sealed-products", "booster-bundles", "premium-collections", "almost-gone"]
  },
  {
    slug: "almost-gone",
    title: "Almost Gone",
    shortTitle: "Almost Gone",
    seoTitle: "Low Stock Pokemon Products | GameDayGrabs LLC",
    metaDescription: "Browse low-stock Pokemon products from GameDayGrabs. Internal inventory quantity stays private, and availability is confirmed before payment.",
    intro: "Browse Pokemon products that are low in available inventory.",
    detail: "This page keeps internal inventory quantity private. Products appear here only while available, and checkout confirms the final hold before payment.",
    mode: "almost_gone",
    relatedSlugs: ["new-arrivals", "blisters", "premium-collections", "pokemon-sealed-products"]
  },
  {
    slug: "local-pickup-eligible",
    title: "Local Pickup Eligible",
    shortTitle: "Local Pickup",
    seoTitle: "Local Pickup Eligible Pokemon Products | GameDayGrabs LLC",
    metaDescription: "Browse GameDayGrabs products that may be eligible for local pickup when shown at checkout. Pickup is separate from shipping.",
    intro: "Browse products that may be eligible for local pickup at checkout.",
    detail: "Local pickup is available only when offered during checkout. Pickup is not shipping, and instructions are provided after purchase when the order is ready.",
    mode: "local_pickup",
    relatedSlugs: ["pokemon-sealed-products", "new-arrivals", "tins", "premium-collections"]
  }
];

export function storefrontCollectionPath(slug: string) {
  return `/collections/${encodeURIComponent(slug)}`;
}

export function storefrontCollectionUrl(slug: string) {
  return `${GAMEDAYGRABS_CANONICAL_ORIGIN}${storefrontCollectionPath(slug)}`;
}

export function getStorefrontCollection(slug: string) {
  return storefrontCollections.find((collection) => collection.slug === slug) ?? null;
}

export function storefrontCollectionPathForCategory(category: string) {
  const collection = storefrontCollections.find((entry) => entry.category === category);
  return collection ? storefrontCollectionPath(collection.slug) : null;
}

function productTime(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt">) {
  const time = Date.parse(product.publishedAt ?? product.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

export function storefrontCollectionProducts(
  collection: StorefrontCollectionDefinition,
  products: PublicStoreProductDTO[],
  options: { newArrivalDays?: number; now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const newArrivalDays = options.newArrivalDays ?? 14;
  const filtered = products.filter((product) => {
    if (collection.mode === "category") {
      return collection.category ? storefrontCategoryMatches(product, collection.category) : false;
    }
    if (collection.mode === "new_arrivals") return !isSoldOutProduct(product) && isNewArrival(product, now, newArrivalDays);
    if (collection.mode === "almost_gone") return !isSoldOutProduct(product) && product.availabilityLevel === "almost_gone";
    if (collection.mode === "local_pickup") return !isSoldOutProduct(product) && product.localPickupEligible;
    return false;
  });

  return filtered.sort((left, right) => {
    if (collection.mode === "almost_gone") return productTime(right) - productTime(left);
    return productTime(right) - productTime(left);
  });
}

export function relatedStorefrontCollections(collection: StorefrontCollectionDefinition) {
  return collection.relatedSlugs
    .map((slug) => getStorefrontCollection(slug))
    .filter((entry): entry is StorefrontCollectionDefinition => Boolean(entry));
}

export function storefrontCollectionMetadata(collection: StorefrontCollectionDefinition): Metadata {
  const canonicalUrl = storefrontCollectionUrl(collection.slug);
  return {
    metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
    title: collection.seoTitle,
    description: collection.metaDescription,
    alternates: {
      canonical: canonicalUrl
    },
    openGraph: {
      type: "website",
      title: collection.seoTitle,
      description: collection.metaDescription,
      url: canonicalUrl,
      siteName: GAMEDAYGRABS_SEO_SITE_NAME,
      images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
    },
    twitter: {
      card: "summary_large_image",
      title: collection.seoTitle,
      description: collection.metaDescription,
      images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
    }
  };
}

export function storefrontCollectionBreadcrumbJsonLd(collection: StorefrontCollectionDefinition) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: GAMEDAYGRABS_CANONICAL_ORIGIN
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Shop",
        item: `${GAMEDAYGRABS_CANONICAL_ORIGIN}/shop`
      },
      {
        "@type": "ListItem",
        position: 3,
        name: collection.title,
        item: storefrontCollectionUrl(collection.slug)
      }
    ]
  };
}

export function storefrontCollectionItemListJsonLd(collection: StorefrontCollectionDefinition, products: PublicStoreProductDTO[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: collection.title,
    url: storefrontCollectionUrl(collection.slug),
    itemListElement: products.slice(0, 24).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: cleanStorefrontTitle(product.title),
      url: productCanonicalUrl(product.slug)
    }))
  };
}

export function storefrontCollectionJsonLdScripts(collection: StorefrontCollectionDefinition, products: PublicStoreProductDTO[]) {
  return [
    storefrontJsonLdScript(storefrontCollectionBreadcrumbJsonLd(collection)),
    storefrontJsonLdScript(storefrontCollectionItemListJsonLd(collection, products))
  ];
}
