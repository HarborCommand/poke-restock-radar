import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL, GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";
import { StorefrontHomeView } from "@/components/StorefrontServerViews";

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
    images: ["/icons/icon-512.png"]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ShopPage() {
  return <StorefrontHomeView />;
}
