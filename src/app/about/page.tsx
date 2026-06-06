import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "About | GameDayGrabs LLC",
  description: "Learn about GameDayGrabs LLC, a family-owned Pokemon and sports card shop."
};

export default async function AboutPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <section className="gdg-info-hero">
        <p className="gdg-overline">About GameDayGrabs LLC</p>
        <h1>Built for collectors, players, and families.</h1>
        <p>
          GameDayGrabs LLC is a collector-focused shop for Pokemon sealed products, sports cards, graded cards,
          and curated collectibles. The storefront is designed to keep public inventory simple, accurate, and easy to
          request.
        </p>
      </section>
      <section className="gdg-section gdg-values">
        <div className="gdg-section-header">
          <div>
            <h2>Why Collectors Choose GameDayGrabs</h2>
            <p>Professional service without clutter or guesswork.</p>
          </div>
        </div>
        <div className="gdg-value-grid">
          {[
            ["Family Owned", "A small business built around collecting, playing, and sharing the hobby."],
            ["Carefully Curated", "Public listings show only products selected and published from real inventory."],
            ["Safe & Secure", "Invoice and checkout flows are handled clearly before fulfillment."],
            ["Collector Friendly", "Product pages are built to be readable, mobile friendly, and easy to review."]
          ].map(([title, text]) => (
            <article key={title}>
              <span>{title.slice(0, 1)}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <StorefrontFooter settings={settings} />
    </main>
  );
}
