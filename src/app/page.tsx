import { headers } from "next/headers";
import { PrivateRadarAppEntry } from "@/components/PrivateRadarAppEntry";
import { StorefrontHomeView } from "@/components/StorefrontServerViews";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL, isGameDayGrabsHost } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const storefrontHomeTitle = "GameDayGrabs LLC | Sealed Pokemon TCG & Collectible Card Products";
const storefrontHomeDescription =
  "Shop sealed Pokemon TCG products, booster bundles, tins, blisters, premium collections, and collectible card products packed carefully for collectors.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return {
      metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
      title: storefrontHomeTitle,
      description: storefrontHomeDescription,
      alternates: {
        canonical: GAMEDAYGRABS_CANONICAL_ORIGIN
      },
      openGraph: {
        title: storefrontHomeTitle,
        description: storefrontHomeDescription,
        url: GAMEDAYGRABS_CANONICAL_ORIGIN,
        siteName: "GameDayGrabs LLC",
        images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
      },
      twitter: {
        card: "summary_large_image",
        title: storefrontHomeTitle,
        description: storefrontHomeDescription,
        images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
      },
      other: {
        "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
      }
    };
  }
  return {
    title: "GameDayGrabs Admin",
    description: "Private GameDayGrabs Admin for products, inventory, orders, shipping, customers, rewards, and reports.",
    robots: {
      index: false,
      follow: false
    }
  };
}

export default async function Home() {
  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    return <StorefrontHomeView />;
  }
  return <PrivateRadarAppEntry />;
}
