import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { StorefrontShopView } from "@/components/StorefrontServerViews";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const shopUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/shop`;
const shopTitle = "Shop Pokémon TCG Products | GameDayGrabs LLC";
const shopDescription =
  "Browse sealed Pokémon TCG products, booster bundles, tins, blisters, premium collections, and collectible card products from GameDayGrabs.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: shopTitle,
  description: shopDescription,
  alternates: {
    canonical: shopUrl
  },
  openGraph: {
    title: shopTitle,
    description: shopDescription,
    url: shopUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: shopTitle,
    description: shopDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type ShopPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = searchParams ? await searchParams : {};
  return (
    <StorefrontShopView
      q={firstParam(params.q)}
      category={firstParam(params.category)}
      set={firstParam(params.set)}
      sort={firstParam(params.sort)}
      availability={firstParam(params.availability)}
      page={firstParam(params.page)}
    />
  );
}
