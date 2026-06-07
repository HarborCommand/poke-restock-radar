import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { StorefrontHomeView } from "@/components/StorefrontServerViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
  description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
  openGraph: {
    title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
    description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
    images: ["/icons/icon-512.png"]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ShopPage() {
  return <StorefrontHomeView />;
}
