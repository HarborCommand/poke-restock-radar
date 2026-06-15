import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "About | GameDayGrabs LLC",
  description: "Learn about GameDayGrabs LLC, a collector-focused Pokemon TCG shop."
};

export default async function AboutPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const contactEmail = settings.contactEmail || GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero">
        <p className="gdg-overline">About GameDayGrabs LLC</p>
        <h1>Built for Pok&eacute;mon collectors.</h1>
        <p>
          GameDayGrabs is a collector-focused Pok&eacute;mon TCG shop built around accurate listings, real inventory,
          secure checkout, and careful packaging. Our goal is simple: make it easy to buy sealed Pok&eacute;mon products
          with confidence.
        </p>
      </section>
      <section className="gdg-section gdg-values">
        <div className="gdg-section-header">
          <div>
            <h2>Collector-first service</h2>
            <p>Clear listings, secure payment, and practical fulfillment without unnecessary friction.</p>
          </div>
        </div>
        <div className="gdg-value-grid">
          {[
            ["Accurate Listings", "Products are listed with current availability so customers can shop from real public inventory."],
            ["Secure Checkout", "Checkout is handled securely, with Stripe available for card payments when enabled."],
            ["Careful Packaging", "Orders are packed with care so sealed products arrive protected and easy to review."],
            ["Practical Fulfillment", "Orders move through a clear fulfillment process without overpromising delivery timing."],
            ["Order Help", "Customers can contact GameDayGrabs for order questions, pickup coordination, or product help."],
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
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
