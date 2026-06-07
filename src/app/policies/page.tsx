import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Policies | GameDayGrabs LLC",
  description: "Shipping, returns, pickup, and ordering policies for GameDayGrabs LLC.",
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function PoliciesPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-info-hero compact">
        <p className="gdg-overline">Store Policies</p>
        <h1>Clear ordering, shipping, and pickup expectations.</h1>
        <p>Availability can change quickly. GameDayGrabs confirms inventory before invoice fulfillment or shipment.</p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        <article>
          <h2>Shipping</h2>
          <p>{settings.shippingPolicyText || "Shipping is available on eligible products. Orders are packed carefully, and tracking is shared when shipment is created."}</p>
          <p>Default shipping: ${settings.defaultShippingPrice.toFixed(2)}</p>
          {settings.freeShippingThreshold ? <p>Free shipping threshold: ${settings.freeShippingThreshold.toFixed(2)}</p> : null}
        </article>
        <article>
          <h2>Returns</h2>
          <p>{settings.returnPolicyText || "Returns are handled case by case. Sealed collectible products may have limited return options once shipped or opened."}</p>
        </article>
        <article>
          <h2>Local Pickup</h2>
          <p>{settings.localPickupInstructions || "Local pickup is available only when coordinated and confirmed by GameDayGrabs."}</p>
        </article>
        <article>
          <h2>Checkout</h2>
          <p>{settings.checkoutConfigured ? "Secure Stripe Checkout is available for public orders." : "Request Invoice mode is active. No card is charged during invoice request."}</p>
        </article>
        <article>
          <h2>Contact</h2>
          {settings.contactEmail ? (
            <p>
              Questions about an order or product? Email <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>.
            </p>
          ) : (
            <p>Public contact email is pending setup. Use the Contact page form or Request Invoice flow for product questions.</p>
          )}
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
