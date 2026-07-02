import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { PrivacyPolicyContent } from "@/components/StorefrontPolicies";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_PRIVACY_POLICY_URL,
  GAMEDAYGRABS_SEO_SITE_NAME
} from "@/lib/storefront-seo";

const privacyTitle = `Privacy Policy | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
const privacyDescription =
  "Review how GameDayGrabs LLC handles customer, order, support, payment, cart, and site data for storefront operations.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: privacyTitle,
  description: privacyDescription,
  alternates: {
    canonical: GAMEDAYGRABS_PRIVACY_POLICY_URL
  },
  openGraph: {
    title: privacyTitle,
    description: privacyDescription,
    url: GAMEDAYGRABS_PRIVACY_POLICY_URL,
    siteName: GAMEDAYGRABS_SEO_SITE_NAME,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: privacyTitle,
    description: privacyDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function PrivacyPolicyPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Privacy Policy</p>
        <h1>Simple customer and order data handling.</h1>
        <p>GameDayGrabs LLC uses customer information to process orders, provide support, coordinate shipping or pickup, and keep the storefront working.</p>
      </section>
      <PrivacyPolicyContent contactEmail={contactEmail} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
