import { unstable_noStore as noStore } from "next/cache";
import { OrderStatusLookupClient } from "@/components/OrderStatusLookupClient";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const orderStatusUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/order-status`;
const orderStatusTitle = "Check Order Status | GameDayGrabs LLC";
const orderStatusDescription = "Check a GameDayGrabs order status using the order number and checkout email.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: orderStatusTitle,
  description: orderStatusDescription,
  alternates: {
    canonical: orderStatusUrl
  },
  openGraph: {
    title: orderStatusTitle,
    description: orderStatusDescription,
    url: orderStatusUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: orderStatusTitle,
    description: orderStatusDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  robots: {
    index: false,
    follow: false
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function OrderStatusPage() {
  noStore();
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <OrderStatusLookupClient />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
