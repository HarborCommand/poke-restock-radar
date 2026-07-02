import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { ShippingPolicyContent } from "@/components/StorefrontPolicies";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_SEO_SITE_NAME,
  GAMEDAYGRABS_SHIPPING_POLICY_URL
} from "@/lib/storefront-seo";

const shippingTitle = `Shipping Policy | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
const shippingDescription =
  "Review GameDayGrabs LLC US shipping, USPS Ground Advantage, cart-calculated shipping, packing and handling minimums, local pickup, tracking, and order support.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: shippingTitle,
  description: shippingDescription,
  alternates: {
    canonical: GAMEDAYGRABS_SHIPPING_POLICY_URL
  },
  openGraph: {
    title: shippingTitle,
    description: shippingDescription,
    url: GAMEDAYGRABS_SHIPPING_POLICY_URL,
    siteName: GAMEDAYGRABS_SEO_SITE_NAME,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: shippingTitle,
    description: shippingDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ShippingPolicyPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Shipping Policy</p>
        <h1>US shipping, local pickup, and careful packing.</h1>
        <p>GameDayGrabs LLC shows shipping costs in cart or checkout before payment and packs sealed products carefully for collectors.</p>
      </section>
      <ShippingPolicyContent contactEmail={contactEmail} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
