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
  privacyPolicySections
} from "@/lib/storefront-trust";

const privacyUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/privacy`;
const privacyTitle = "Privacy Policy | GameDayGrabs LLC";
const privacyDescription =
  "Learn how GameDayGrabs uses customer contact, checkout, shipping, account, and support information for orders and customer service.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: privacyTitle,
  description: privacyDescription,
  alternates: {
    canonical: privacyUrl
  },
  openGraph: {
    title: privacyTitle,
    description: privacyDescription,
    url: privacyUrl,
    siteName: GAMEDAYGRABS_LEGAL_NAME,
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
        <h1>Customer information is used for checkout, fulfillment, and support.</h1>
        <p>
          GameDayGrabs keeps customer-facing data practices focused on order processing, secure payment, shipping,
          pickup, account access, and customer support.
        </p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        {privacyPolicySections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
        <article>
          <h2>Privacy Questions</h2>
          <p>
            Contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a> for privacy or account questions.
          </p>
          <p>{GAMEDAYGRABS_RESPONSE_TIME}</p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
