import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Policies | GameDayGrabs LLC",
  description: "Shipping, pickup, payment, inventory, and order policies for GameDayGrabs LLC.",
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
        <h1>Clear ordering, shipping, and pickup expectations.</h1>
        <p>
          GameDayGrabs keeps public policies simple so customers know how shipping, checkout holds, payment security,
          pickup, and order support work before placing an order.
        </p>
      </section>
      <section className="gdg-policies gdg-policy-page">
        <article>
          <h2>Shipping Policy</h2>
          <p>Shipping is calculated from product weight and package size. Final shipping is shown before payment.</p>
          <p>Orders are packed carefully, and tracking is added when available after shipment is created.</p>
        </article>
        <article>
          <h2>Local Pickup Policy</h2>
          <p>Local pickup is only available when shown at checkout. Pickup instructions are provided after purchase.</p>
          <p>Local pickup is not the same as shipping, and pickup availability is not promised for every order.</p>
        </article>
        <article>
          <h2>Cancellations / Refunds</h2>
          <p>Customers can contact GameDayGrabs for order issues. Paid orders may be canceled or refunded before shipment when eligible.</p>
          <p>Refund timing depends on the customer's bank or card issuer. Once an order ships, refunds and returns are reviewed case by case.</p>
        </article>
        <article>
          <h2>Returns / Product Issues</h2>
          <p>Contact GameDayGrabs if an item arrives damaged, incorrect, or has another order issue.</p>
          <p>Sealed collectible products should be reviewed carefully because condition matters. Return options are reviewed case by case.</p>
        </article>
        <article>
          <h2>Payment Security</h2>
          <p>Stripe securely handles payment when Stripe Checkout is used. GameDayGrabs does not store card numbers or CVC.</p>
          <p>Stripe session and payment references may be stored for order support, but raw card details are not stored.</p>
        </article>
        <article>
          <h2>Inventory / Checkout Holds</h2>
          <p>Items are not reserved until checkout starts. Checkout holds items for 15 minutes while payment is completed.</p>
          <p>Abandoned or expired checkout sessions release the hold. Inventory is finalized only after successful payment.</p>
        </article>
        <article>
          <h2>Product Availability / Preorders</h2>
          <p>Products are sold based on current availability. If a product is sold out, checkout is blocked.</p>
          <p>GameDayGrabs only presents preorder behavior when an item is clearly labeled as preorder.</p>
        </article>
        <article>
          <h2>Privacy / Customer Information</h2>
          <p>Email, phone, shipping address, and billing details are used to process orders and provide support.</p>
          <p>GameDayGrabs keeps customer-facing order information focused on checkout, fulfillment, pickup, and support needs.</p>
        </article>
        <article>
          <h2>Contact</h2>
          <p>
            For order questions, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </article>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
