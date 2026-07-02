import { StorefrontContactForm, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";
import {
  GAMEDAYGRABS_LEGAL_NAME,
  GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY,
  GAMEDAYGRABS_NO_STOREFRONT_HOURS,
  GAMEDAYGRABS_RESPONSE_TIME,
  GAMEDAYGRABS_SERVICE_AREA,
  GAMEDAYGRABS_SUPPORT_HOURS
} from "@/lib/storefront-trust";

const contactUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/contact`;
const contactTitle = "Contact GameDayGrabs LLC | Order & Product Support";
const contactDescription =
  "Contact GameDayGrabs for Pokemon TCG product questions, order support, local pickup coordination, invoice requests, and collectible card product help.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: contactTitle,
  description: contactDescription,
  alternates: {
    canonical: contactUrl
  },
  openGraph: {
    title: contactTitle,
    description: contactDescription,
    url: contactUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: contactTitle,
    description: contactDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ContactPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Contact</p>
        <h1>Questions about products, pickup, shipping, or an order?</h1>
        <p>
          Reach out before ordering if you need product details, availability confirmation, local pickup coordination,
          shipping help, or support for an existing order.
        </p>
      </section>
      <GrabbyCard
        variant="contact-support"
        compact
        className="grabby-helper-strip gdg-contact-grabby-card"
      />
      <section className="gdg-contact-page-card">
        <div>
          <h2>{GAMEDAYGRABS_LEGAL_NAME}</h2>
          <p>
            Email: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
          <p>{GAMEDAYGRABS_SUPPORT_HOURS}</p>
          <p>{GAMEDAYGRABS_RESPONSE_TIME}</p>
          <p>Service area: {GAMEDAYGRABS_SERVICE_AREA}</p>
          <p>{GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY}</p>
          <p>{GAMEDAYGRABS_NO_STOREFRONT_HOURS}</p>
        </div>
        <a className="gdg-primary-button" href={`mailto:${contactEmail}`}>
          Email Us
        </a>
      </section>
      <section className="gdg-contact-page-card gdg-contact-instructions-card">
        <div>
          <h2>Order support</h2>
          <p>For existing orders, include the order number and the email address used at checkout.</p>
          <p>For damaged, incorrect, or missing items, include photos of the package, product condition, shipping label, and a short explanation.</p>
          <p>For pickup questions, wait for pickup instructions after purchase and contact support before traveling.</p>
        </div>
        <a className="gdg-secondary-button" href="/order-status">
          Check Order Status
        </a>
      </section>
      <section className="gdg-contact-page-card gdg-contact-form-card">
        <StorefrontContactForm settings={settings} />
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
