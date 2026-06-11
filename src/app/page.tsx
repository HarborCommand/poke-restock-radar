import { headers } from "next/headers";
import { RadarApp } from "@/components/RadarApp";
import { StorefrontHomeView } from "@/components/StorefrontServerViews";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL, GAMEDAYGRABS_WWW_DOMAIN, isGameDayGrabsHost } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return {
      metadataBase: new URL(`https://${GAMEDAYGRABS_WWW_DOMAIN}`),
      title: "GameDayGrabs LLC | Pokémon & Sports Card Collectibles",
      description: "Family-owned online card shop specializing in Pokémon sealed products, sports cards, and collectibles.",
      openGraph: {
        title: "GameDayGrabs LLC | Pokémon & Sports Card Collectibles",
        description: "Family-owned online card shop specializing in Pokémon sealed products, sports cards, and collectibles.",
        url: `https://${GAMEDAYGRABS_WWW_DOMAIN}`,
        siteName: "GameDayGrabs LLC",
        images: ["/brand/gamedaygrabs-icon.png?v=gdg-icons-v1"]
      },
      other: {
        "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
      }
    };
  }
  return {
    title: "Poke Restock Radar",
    description: "Private Pokémon TCG restock, release, inventory, and alert radar."
  };
}

export default async function Home() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return <StorefrontHomeView />;
  }
  return <RadarApp />;
}
