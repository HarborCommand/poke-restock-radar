import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL, GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";
import { StorefrontShopView } from "@/components/StorefrontServerViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(`https://${GAMEDAYGRABS_WWW_DOMAIN}`),
  title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
  description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
  openGraph: {
    title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
    description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
    url: `https://${GAMEDAYGRABS_WWW_DOMAIN}/shop`,
    siteName: "GameDayGrabs LLC",
    images: ["/brand/gamedaygrabs-logo-horizontal.png"]
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
  return <StorefrontShopView category={firstParam(params.category)} sort={firstParam(params.sort)} availability={firstParam(params.availability)} />;
}
