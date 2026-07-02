import { MarketplaceFeedbackSection, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";
import {
  GAMEDAYGRABS_LEGAL_NAME,
  GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY,
  GAMEDAYGRABS_SERVICE_AREA
} from "@/lib/storefront-trust";

const aboutUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/about`;
const aboutTitle = "About GameDayGrabs LLC | Collector-Focused Pokemon TCG Shop";
const aboutDescription =
  "Learn about GameDayGrabs, a collector-focused shop for sealed Pokemon TCG products, collectible card products, careful packaging, secure checkout, and order support.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: aboutTitle,
  description: aboutDescription,
  alternates: {
    canonical: aboutUrl
  },
  openGraph: {
    title: aboutTitle,
    description: aboutDescription,
    url: aboutUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: aboutTitle,
    description: aboutDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function AboutPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero">
        <p className="gdg-overline">About {GAMEDAYGRABS_LEGAL_NAME}</p>
        <h1>Independent collectibles retail for Pokemon and sports card collectors.</h1>
        <p>
          GameDayGrabs is an independent online collectibles shop. We sell sealed Pokemon TCG products, sports cards,
          and collectible card products from stocked inventory that is listed, packed, and fulfilled by GameDayGrabs.
        </p>
      </section>
      <section className="gdg-section gdg-values">
        <div className="gdg-section-header">
          <div>
            <h2>How the store operates</h2>
            <p>Clear listings, secure payment, practical fulfillment, and careful packaging for collectors.</p>
          </div>
        </div>
        <div className="gdg-value-grid">
          {[
            ["Stocked Inventory", "Public listings are tied to GameDayGrabs inventory and current customer-facing availability."],
            ["Secure Checkout", "Stripe securely handles card checkout when card payment is available."],
            ["Careful Packaging", "Orders are packed carefully so sealed Pokemon TCG products and premium collections are protected in transit."],
            ["Fulfillment", `${GAMEDAYGRABS_SERVICE_AREA} ${GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY}`],
            ["No Affiliation Claims", "GameDayGrabs does not claim to be an official Pokemon, sports league, team, or manufacturer retailer."],
            ["Contact", `Email ${contactEmail} for help with an order or product question.`]
          ].map(([title, text]) => (
            <article key={title}>
              <span>{title.slice(0, 1)}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <MarketplaceFeedbackSection variant="about" />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
