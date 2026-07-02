import Link from "next/link";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE
} from "@/lib/storefront-seo";
import { GAMEDAYGRABS_LEGAL_NAME, termsSections } from "@/lib/storefront-trust";

const termsUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/terms`;
const termsTitle = "Terms of Service | GameDayGrabs LLC";
const termsDescription =
  "Review GameDayGrabs storefront terms for orders, listings, checkout, payments, shipping, returns, product issues, and trademarks.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: termsTitle,
  description: termsDescription,
  alternates: {
    canonical: termsUrl
  },
  openGraph: {
    title: termsTitle,
    description: termsDescription,
    url: termsUrl,
    siteName: GAMEDAYGRABS_LEGAL_NAME,
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

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Terms of Service</p>
        <h1>Clear terms for public storefront orders.</h1>
        <p>
          These terms describe how GameDayGrabs handles product listings, checkout, payments, shipping, order support,
          returns, and trademark ownership.
        </p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        {termsSections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
        <article>
          <h2>Related Policies</h2>
          <p>
            Review the <Link href="/policies/shipping">Shipping Policy</Link> and{" "}
            <Link href="/policies/returns">Return & Refund Policy</Link> before ordering.
          </p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
