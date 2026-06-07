import { StorefrontContactForm, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Contact | GameDayGrabs LLC",
  description: "Contact GameDayGrabs LLC for inventory questions, invoice requests, and order help.",
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function ContactPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Contact</p>
        <h1>Questions about inventory or invoices?</h1>
        <p>Reach out before ordering if you need product details, availability confirmation, or help with an invoice request.</p>
      </section>
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
          <p>Collector-focused Pokemon and sports card products for customers, players, and fans.</p>
        </div>
        <a className="gdg-primary-button" href={settings.contactEmail ? `mailto:${settings.contactEmail}` : "/shop"}>
          {settings.contactEmail ? "Email Us" : "Browse Products"}
        </a>
      </section>
      <section className="gdg-contact-page-card gdg-contact-form-card">
        <StorefrontContactForm settings={settings} />
      </section>
      <StorefrontFooter settings={settings} />
    </main>
  );
}
