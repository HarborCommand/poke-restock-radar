import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { TermsPolicyContent } from "@/components/StorefrontPolicies";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_SEO_SITE_NAME,
  GAMEDAYGRABS_TERMS_URL
} from "@/lib/storefront-seo";

const termsTitle = `Terms of Service | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
const termsDescription =
  "Review GameDayGrabs LLC order acceptance, availability, pricing, sealed product, local pickup, shipping, website use, and contact terms.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: termsTitle,
  description: termsDescription,
  alternates: {
    canonical: GAMEDAYGRABS_TERMS_URL
  },
  openGraph: {
    title: termsTitle,
    description: termsDescription,
    url: GAMEDAYGRABS_TERMS_URL,
    siteName: GAMEDAYGRABS_SEO_SITE_NAME,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: termsTitle,
    description: termsDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function TermsPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Terms of Service</p>
        <h1>Clear terms for orders, products, pickup, and shipping.</h1>
        <p>These terms explain how GameDayGrabs LLC handles order acceptance, availability, pricing errors, sealed products, local pickup, shipping limitations, and website use.</p>
      </section>
      <TermsPolicyContent contactEmail={contactEmail} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
