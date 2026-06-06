import { headers } from "next/headers";
import { RadarApp } from "@/components/RadarApp";
import { StorefrontHomeView } from "@/components/StorefrontServerViews";
import { isGameDayGrabsHost } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return {
      title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
      description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
      openGraph: {
        title: "GameDayGrabs LLC | Pokemon & Sports Card Collectibles",
        description: "Family-owned online card shop specializing in Pokemon sealed products, sports cards, and collectibles.",
        images: ["/icons/icon-512.png"]
      }
    };
  }
  return {
    title: "Poke Restock Radar",
    description: "Private Pokemon TCG restock, release, inventory, and alert radar."
  };
}

export default async function Home() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return <StorefrontHomeView />;
  }
  return <RadarApp />;
}
