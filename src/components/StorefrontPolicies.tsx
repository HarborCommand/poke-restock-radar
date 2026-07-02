import Link from "next/link";

export const policyLinks = [
  { href: "/policies/shipping", title: "Shipping Policy", description: "US shipping, USPS Ground Advantage, local pickup, tracking, and shipping minimums." },
  { href: "/policies/returns", title: "Returns Policy", description: "Final-sale sealed collectibles policy and support for damaged, wrong, or missing items." },
  { href: "/privacy", title: "Privacy Policy", description: "Customer, order, support, payment, and site data handling." },
  { href: "/terms", title: "Terms of Service", description: "Order acceptance, availability, pricing, sealed products, pickup, shipping, and site use." }
] as const;

export function PolicyLinkGrid() {
  return (
    <section className="gdg-policies gdg-policy-page" aria-label="Policy links">
      {policyLinks.map((policy) => (
        <article key={policy.href}>
          <h2>
            <Link href={policy.href}>{policy.title}</Link>
          </h2>
          <p>{policy.description}</p>
        </article>
      ))}
    </section>
  );
}

export function ShippingPolicyContent({ contactEmail }: { contactEmail: string }) {
  return (
    <section className="gdg-policies gdg-policy-page">
      <article>
        <h2>Where We Ship</h2>
        <p>GameDayGrabs LLC currently ships online orders within the United States only.</p>
        <p>Local Pickup is free when it is available and shown at checkout. Pickup availability is not promised for every order.</p>
      </article>
      <article>
        <h2>Shipping Service</h2>
        <p>Shipped orders use USPS/cart-calculated shipping. USPS Ground Advantage is used when available.</p>
        <p>Shipping is calculated in the cart or checkout using the packed product weight, package size, destination ZIP code, and current shipping configuration.</p>
      </article>
      <article>
        <h2>Packing and Handling Minimums</h2>
        <p>The displayed shipping cost may include a packing and handling minimum for sealed collectible products.</p>
        <ul>
          <li>1-2 items: $7.99 minimum</li>
          <li>3-5 items: $9.99 minimum</li>
          <li>6-9 items: $12.99 minimum</li>
          <li>10+ items: $14.99 minimum</li>
        </ul>
        <p>If the real carrier rate is higher than the minimum, the higher carrier rate may apply.</p>
      </article>
      <article>
        <h2>Processing and Tracking</h2>
        <p>Most shipped orders are prepared within 1-2 business days after payment confirmation, excluding weekends, holidays, and carrier delays.</p>
        <p>Tracking is provided for shipped orders when the shipping label is created or the order is marked shipped.</p>
      </article>
      <article>
        <h2>Packaging</h2>
        <p>Sealed products are packed carefully for collectors using packaging appropriate for the item size and condition.</p>
      </article>
      <article>
        <h2>Delayed, Lost, Damaged, Missing, or Wrong Items</h2>
        <p>
          If your shipment is delayed, lost, damaged, missing an item, or contains the wrong item, contact support at{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
        <p>Please include your order number, tracking number if available, photos of the package or item when relevant, and a short description of the issue.</p>
      </article>
    </section>
  );
}

export function ReturnsPolicyContent({ contactEmail }: { contactEmail: string }) {
  return (
    <section className="gdg-policies gdg-policy-page">
      <article>
        <h2>Returns and Exchanges</h2>
        <p>Returns are not accepted for sealed collectible products.</p>
        <p>Exchanges are not accepted.</p>
        <p>
          Sealed trading card and collectible products can lose integrity or value once shipped, opened, searched,
          resealed, tampered with, or affected by market changes after delivery.
        </p>
      </article>
      <article>
        <h2>Sealed Collectible Products</h2>
        <p>
          This policy applies to sealed Pokemon TCG products, sports cards, booster packs, booster bundles, tins,
          blisters, premium collections, decks, and similar collectible card products.
        </p>
        <p>Buyer-remorse returns, opened product returns, and exchanges for sealed collectible items are not accepted.</p>
      </article>
      <article>
        <h2>Order Issue Support</h2>
        <p>
          Customers should contact GameDayGrabs LLC for wrong item, damaged item, missing item, or other order issue support.
          This policy does not remove customer support for merchant mistakes or shipping-related issues.
        </p>
        <p>
          Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> within 3 calendar days of delivery with your order number,
          photos of the package, photos of the product condition, photos of the shipping label, and a short description of the issue.
        </p>
        <p>GameDayGrabs LLC will review the issue and may offer a replacement, refund, partial refund, or another resolution after review.</p>
      </article>
    </section>
  );
}

export function PrivacyPolicyContent({ contactEmail }: { contactEmail: string }) {
  return (
    <section className="gdg-policies gdg-policy-page">
      <article>
        <h2>Information We Collect</h2>
        <p>GameDayGrabs LLC collects customer information needed to run the store, process orders, provide support, and communicate about purchases.</p>
        <p>This may include name, email, phone number when provided, shipping address, billing details, order history, cart details, and contact form messages.</p>
      </article>
      <article>
        <h2>Orders and Support</h2>
        <p>Customer information is used for checkout, fulfillment, local pickup coordination, shipping updates, account support, fraud prevention, and order issue resolution.</p>
        <p>We may contact customers about order status, payment status, shipping, pickup instructions, or support requests.</p>
      </article>
      <article>
        <h2>Payments</h2>
        <p>Stripe handles secure checkout and payment processing when Stripe Checkout is used.</p>
        <p>GameDayGrabs LLC does not store raw card numbers or CVC codes. Stripe session and payment references may be stored for order support and reconciliation.</p>
      </article>
      <article>
        <h2>Cookies and Analytics</h2>
        <p>The website may use basic cookies, browser storage, server logs, and analytics or platform tools to keep carts working, protect the service, improve the storefront, and understand site performance.</p>
      </article>
      <article>
        <h2>Contact</h2>
        <p>
          For privacy or customer data questions, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </article>
    </section>
  );
}

export function TermsPolicyContent({ contactEmail }: { contactEmail: string }) {
  return (
    <section className="gdg-policies gdg-policy-page">
      <article>
        <h2>Order Acceptance</h2>
        <p>Orders are subject to acceptance, payment confirmation, inventory availability, fraud review, and fulfillment review by GameDayGrabs LLC.</p>
        <p>Receiving an order confirmation does not require GameDayGrabs LLC to fulfill an order if there is an availability, pricing, payment, fraud, or listing error.</p>
      </article>
      <article>
        <h2>Product Availability and Pricing</h2>
        <p>Products are sold based on current availability. If a product is sold out, checkout is blocked or the order may be canceled before fulfillment.</p>
        <p>GameDayGrabs LLC may correct pricing, description, image, availability, tax, or shipping errors before accepting or fulfilling an order.</p>
      </article>
      <article>
        <h2>Sealed Product Condition</h2>
        <p>Sealed collectible products are listed based on public listing information, product photos, and current condition details available before purchase.</p>
        <p>Packaging condition can vary from manufacturing, distribution, retail handling, and shipping. Customers should review product photos and listing details before ordering.</p>
      </article>
      <article>
        <h2>Local Pickup</h2>
        <p>Local pickup is available only when shown at checkout. Pickup instructions are provided after purchase.</p>
        <p>Orders selected for pickup must follow the provided pickup instructions and may require order verification.</p>
      </article>
      <article>
        <h2>Shipping Limitations</h2>
        <p>GameDayGrabs LLC currently ships online orders within the United States only.</p>
        <p>Shipping cost, service, tracking, and delivery timing are subject to carrier availability, package size, package weight, destination, and checkout configuration.</p>
      </article>
      <article>
        <h2>Website Use</h2>
        <p>Customers may use the website for lawful shopping, order support, account access, and product browsing.</p>
        <p>Misuse, fraud, scraping, abuse, or attempts to interfere with checkout, inventory, accounts, or store operations may result in canceled orders or blocked access.</p>
      </article>
      <article>
        <h2>Trademark Notice</h2>
        <p>GameDayGrabs LLC is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners.</p>
      </article>
      <article>
        <h2>Contact</h2>
        <p>
          For questions about these terms, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </article>
    </section>
  );
}
