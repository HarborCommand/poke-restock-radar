import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { PolicyLinkGrid } from "@/components/StorefrontPolicies";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import { getStorefrontSettings } from "@/lib/storefront";
import {
  GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE,
  GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE,
  GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE
} from "@/lib/storefront-disclosures";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const policiesUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/policies`;
const policiesTitle = "GameDayGrabs Policies | Shipping, Pickup, Payment & Returns";
const policiesDescription =
  "Review GameDayGrabs shipping, local pickup, payment security, checkout holds, rewards, trading card returns, privacy, and product issue policies before ordering collectible card products.";

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
        <h1>Clear ordering, shipping, and pickup expectations.</h1>
        <p>
          GameDayGrabs keeps public policies simple so customers know how shipping, checkout holds, payment security,
          local pickup when available, and order support work before placing an order.
        </p>
      </section>
      <GrabbyCard
        variant="policies-support"
        ctaHref="/order-status"
        compact
        className="grabby-helper-strip gdg-policy-grabby-card"
      />
      <PolicyLinkGrid />
      <section className="gdg-policies gdg-policy-page">
        <article>
          <h2>Shipping Policy</h2>
          <p>GameDayGrabs LLC currently ships online orders within the United States only.</p>
          <p>Shipping is calculated from product weight and package size. Final shipping is shown before payment.</p>
          <p>USPS Ground Advantage is used when available. Shipping shown may include a packing and handling minimum.</p>
          <p>Current shipped-order minimums are 1-2 items at $7.99, 3-5 items at $9.99, 6-9 items at $12.99, and 10+ items at $14.99.</p>
          <p>Higher real carrier rates may apply. Orders are packed carefully for collectors, and tracking is added when available after shipment is created.</p>
          <p>
            Read the dedicated <a href="/policies/shipping">Shipping Policy</a>.
          </p>
        </article>
        <article>
          <h2>Local Pickup Policy</h2>
          <p>Local pickup is only available when shown at checkout. Pickup instructions are provided after purchase.</p>
          <p>Local pickup is separate from shipping, and pickup availability is not promised for every order.</p>
        </article>
        <article>
          <h2>Cancellations / Refunds</h2>
          <p>Customers can contact GameDayGrabs for order issues. Paid orders may be canceled or refunded before shipment when eligible.</p>
          <p>Approved refunds are processed back to the original payment method. Bank or card issuer processing times may vary, but refunds typically appear within 3-10 business days after approval.</p>
        </article>
        <article>
          <h2>Trading Card Return Policy</h2>
          <p>
            All sealed trading card products, including Pokemon TCG products, sports cards, booster packs, booster bundles,
            tins, blisters, premium collections, decks, and similar collectible card products, are final sale and are not
            eligible for return or exchange.
          </p>
          <p>
            Because trading card products can be opened, searched, resealed, tampered with, or affected by market value
            changes after delivery, GameDayGrabs does not accept buyer-remorse returns, opened product returns, or exchanges
            for sealed trading card items.
          </p>
          <p>
            Read the dedicated <a href="/policies/returns">Returns Policy</a>.
          </p>
        </article>
        <article>
          <h2>Order Issue Exceptions</h2>
          <p>
            If your order arrives damaged, incorrect, missing an item, or materially different from what was purchased,
            contact GameDayGrabs within 3 calendar days of delivery at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
          <p>Please include your order number, photos of the package, photos of the product condition, photos of the shipping label, and a brief explanation of the issue.</p>
          <p>GameDayGrabs will review the claim and may offer a replacement, refund, partial refund, or another resolution after review.</p>
        </article>
        <article>
          <h2>Opened Products</h2>
          <p>
            Opened trading card products are not eligible for return, refund, or exchange unless GameDayGrabs determines
            there was a verified fulfillment error or shipping-related issue.
          </p>
          <p>GameDayGrabs reserves the right to deny claims involving opened products, tampering, missing contents, suspected abuse, or requests made outside the claim window.</p>
        </article>
        <article>
          <h2>Return Shipping</h2>
          <p>
            If GameDayGrabs approves a return due to our error, wrong item, or verified shipping damage, return instructions
            will be provided. Approved returns must be returned in the condition received, with all original packaging and
            contents included.
          </p>
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
          <h2>GameDayGrabs Rewards</h2>
          <p>No account required to checkout. Customer accounts are optional, and guest checkout remains available.</p>
          <p>Earn points on eligible purchases when GameDayGrabs Rewards are enabled. Points are awarded after payment is confirmed.</p>
          <p>Shipping, taxes, refunds, discounts, canceled orders, and test/smoke orders do not earn points.</p>
          <p>Refunded or canceled orders can reverse points that were previously awarded.</p>
          <p>Rewards redemption coming soon. Redemption is not currently available, and points cannot be used at checkout yet.</p>
          <p>Points have no cash value and are not transferable.</p>
          <p>GameDayGrabs may adjust or reverse points for fraud, abuse, refunds, cancellations, or errors.</p>
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
          <p>
            Read the dedicated <a href="/privacy">Privacy Policy</a>.
          </p>
        </article>
        <article>
          <h2>Terms of Service</h2>
          <p>Orders are subject to acceptance, availability, payment confirmation, fraud review, and fulfillment review.</p>
          <p>
            Read the dedicated <a href="/terms">Terms of Service</a>.
          </p>
        </article>
        <article>
          <h2>Trademark Notice</h2>
          <p>{GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE}</p>
          <p>{GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE}</p>
          <p>{GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE}</p>
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
