import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE
} from "@/lib/storefront-seo";
import {
  GAMEDAYGRABS_LEGAL_NAME,
  GAMEDAYGRABS_RESPONSE_TIME,
  returnPolicySections
} from "@/lib/storefront-trust";

const returnsUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies/returns`;
const returnsTitle = "Return & Refund Policy | GameDayGrabs LLC";
const returnsDescription =
  "Review GameDayGrabs sealed trading card return limits, damaged or incorrect item support, refund timing, cancellation handling, and return shipping responsibilities.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: returnsTitle,
  description: returnsDescription,
  alternates: {
    canonical: returnsUrl
  },
  openGraph: {
    title: returnsTitle,
    description: returnsDescription,
    url: returnsUrl,
    siteName: GAMEDAYGRABS_LEGAL_NAME,
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

export default async function ReturnPolicyPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Return & Refund Policy</p>
        <h1>Sealed trading card products are generally final sale.</h1>
        <p>
          GameDayGrabs reviews damaged, incorrect, missing, or materially different item claims while keeping sealed
          product return rules clear before purchase.
        </p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        {returnPolicySections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
        <article>
          <h2>Start an Order Issue</h2>
          <p>
            Contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a> before sending any product back. Include your
            order number and photos when the issue involves damage, missing items, or an incorrect product.
          </p>
          <p>{GAMEDAYGRABS_RESPONSE_TIME}</p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
