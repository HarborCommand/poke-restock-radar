import { StorefrontContactForm, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import { getStorefrontSettings } from "@/lib/storefront";
import { GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE } from "@/lib/storefront-disclosures";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

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
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Contact</p>
        <h1>Questions about products, pickup, or invoices?</h1>
        <p>
          Reach out before ordering if you need product details, availability confirmation, local pickup coordination,
          or help with an invoice request.
        </p>
      </section>
      <GrabbyCard
        variant="contact-support"
        compact
        className="grabby-helper-strip gdg-contact-grabby-card"
      />
      <section className="gdg-contact-page-card">
        <div>
          <h2>GameDayGrabs LLC</h2>
          {settings.contactEmail ? (
            <p>
              Email: <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
            </p>
          ) : (
            <p>Public contact email is not configured yet. Use the cart Request Invoice flow for product inquiries.</p>
          )}
          <p>Collector-focused Pokemon TCG, sports card, and collectible card products for customers, players, and fans.</p>
          <p>{GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE}</p>
        </div>
        <a className="gdg-primary-button" href={settings.contactEmail ? `mailto:${settings.contactEmail}` : "/shop"}>
          {settings.contactEmail ? "Email Us" : "Browse Products"}
        </a>
      </section>
      <section className="gdg-contact-page-card gdg-contact-form-card">
        <StorefrontContactForm settings={settings} />
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
