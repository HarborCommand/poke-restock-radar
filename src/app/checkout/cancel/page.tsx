import Link from "next/link";
import { StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CheckoutCancelPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <section className="shop-result-card">
        <span>CHECKOUT CANCELED</span>
        <h1>Your cart was not charged</h1>
        <p>Reserved stock is released automatically if checkout expires or payment is not completed.</p>
        <div className="shop-result-actions">
          <Link href="/cart" className="shop-primary-link">Return to Cart</Link>
          <Link href="/shop" className="shop-secondary-link">Keep Shopping</Link>
        </div>
      </section>
    </main>
  );
}
