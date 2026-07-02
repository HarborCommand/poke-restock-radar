import Link from "next/link";
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
  shippingPolicySections
} from "@/lib/storefront-trust";

const shippingUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies/shipping`;
const shippingTitle = "Shipping Policy | GameDayGrabs LLC";
const shippingDescription =
  "Review GameDayGrabs shipping carriers, processing time, calculated shipping costs, local pickup, tracking, lost package support, and U.S. shipping limits.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: shippingTitle,
  description: shippingDescription,
  alternates: {
    canonical: shippingUrl
  },
  openGraph: {
    title: shippingTitle,
    description: shippingDescription,
    url: shippingUrl,
    siteName: GAMEDAYGRABS_LEGAL_NAME,
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
        <h1>Shipping costs are shown before payment.</h1>
        <p>
          GameDayGrabs ships eligible orders in the United States, quotes shipping from packed product weight and
          package size, and provides tracking when a shipment is created.
        </p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        {shippingPolicySections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
        <article>
          <h2>Order Support</h2>
          <p>
            For shipping questions, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with your order
            number.
          </p>
          <p>{GAMEDAYGRABS_RESPONSE_TIME}</p>
          <p>
            You can also use the <Link href="/order-status">order status page</Link> for public order lookup.
          </p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
