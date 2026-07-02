import Link from "next/link";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";
import {
  GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY,
  GAMEDAYGRABS_RESPONSE_TIME,
  storefrontPolicyLinks
} from "@/lib/storefront-trust";

const policiesUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies`;
const policiesTitle = "GameDayGrabs Policies | Shipping, Pickup, Payment & Returns";
const policiesDescription =
  "Review GameDayGrabs shipping, local pickup, payment security, checkout holds, returns, privacy, terms, and product issue policies before ordering collectible card products.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: policiesTitle,
  description: policiesDescription,
  alternates: {
    canonical: policiesUrl
  },
  openGraph: {
    title: policiesTitle,
    description: policiesDescription,
    url: policiesUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: policiesTitle,
    description: policiesDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function PoliciesPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Store Policies</p>
        <h1>Clear ordering, shipping, pickup, and return expectations.</h1>
        <p>
          GameDayGrabs keeps customer-facing policies visible so customers can understand shipping costs, local pickup,
          payment security, returns, privacy, and terms before placing an order.
        </p>
      </section>
      <GrabbyCard
        variant="policies-support"
        ctaHref="/order-status"
        compact
        className="grabby-helper-strip gdg-policy-grabby-card"
      />
      <section className="gdg-policies gdg-policy-page">
        <article>
          <h2>Policy Pages</h2>
          <p>Review the detailed policy pages before ordering.</p>
          <ul className="gdg-policy-link-list">
            {storefrontPolicyLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </article>
        <article>
          <h2>Shipping Summary</h2>
          <p>Shipping is calculated from product weight, package size, destination ZIP code, and store shipping rules.</p>
          <p>Final shipping is shown before payment. Tracking is added when a shipment is created and tracking is available.</p>
          <p>
            <Link href="/policies/shipping">Read the full shipping policy</Link>.
          </p>
        </article>
        <article>
          <h2>Return & Refund Summary</h2>
          <p>Sealed trading card products are generally final sale and are not eligible for buyer-remorse returns or exchanges.</p>
          <p>Damaged, incorrect, missing, or materially different item claims must be sent within 3 calendar days of delivery.</p>
          <p>
            <Link href="/policies/returns">Read the full return and refund policy</Link>.
          </p>
        </article>
        <article>
          <h2>Local Pickup</h2>
          <p>{GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY}</p>
          <p>Local pickup is separate from shipping and is not available for every item or every order.</p>
        </article>
        <article>
          <h2>Payment Security</h2>
          <p>Stripe securely handles payment when Stripe Checkout is used. GameDayGrabs does not store card numbers or CVC.</p>
          <p>Stripe session and payment references may be stored for order support, but raw card details are not stored.</p>
        </article>
        <article>
          <h2>Privacy / Customer Information</h2>
          <p>Email, phone when provided, shipping address, order details, and support messages are used to process orders and provide support.</p>
          <p>Card numbers and CVC codes are handled by Stripe when Stripe Checkout is used.</p>
          <p>
            <Link href="/privacy">Read the privacy policy</Link>.
          </p>
        </article>
        <article>
          <h2>Terms of Service</h2>
          <p>The Terms of Service explain storefront use, checkout, payments, availability, order support, and trademark ownership.</p>
          <p>
            <Link href="/terms">Read the terms of service</Link>.
          </p>
        </article>
        <article>
          <h2>Trademark Notice</h2>
          <p>GameDayGrabs is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners.</p>
        </article>
        <article>
          <h2>Contact</h2>
          <p>
            For order questions, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
          <p>{GAMEDAYGRABS_RESPONSE_TIME}</p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
