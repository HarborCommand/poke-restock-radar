import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { ReturnsPolicyContent } from "@/components/StorefrontPolicies";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_RETURNS_POLICY_URL,
  GAMEDAYGRABS_SEO_SITE_NAME
} from "@/lib/storefront-seo";

const returnsTitle = `Returns Policy | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
const returnsDescription =
  "Review GameDayGrabs LLC final-sale sealed collectible return terms and support process for damaged, wrong, missing, or order issue cases.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: returnsTitle,
  description: returnsDescription,
  alternates: {
    canonical: GAMEDAYGRABS_RETURNS_POLICY_URL
  },
  openGraph: {
    title: returnsTitle,
    description: returnsDescription,
    url: GAMEDAYGRABS_RETURNS_POLICY_URL,
    siteName: GAMEDAYGRABS_SEO_SITE_NAME,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: returnsTitle,
    description: returnsDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ReturnsPolicyPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Returns Policy</p>
        <h1>Final-sale sealed collectibles with clear issue support.</h1>
        <p>Returns and exchanges are not accepted for sealed collectible products, but customers should contact support for wrong, damaged, missing, or order issue cases.</p>
      </section>
      <ReturnsPolicyContent contactEmail={contactEmail} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
