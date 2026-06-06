import Link from "next/link";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Checkout Canceled | GameDayGrabs LLC",
  description: "Your GameDayGrabs cart was not charged."
};

export default async function CheckoutCancelPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <section className="gdg-result-card">
        <span>!</span>
        <h1>Your cart was not charged</h1>
        <p>Reserved stock is released automatically if checkout expires or payment is not completed.</p>
        <div className="gdg-result-actions">
          <Link href="/cart" className="gdg-primary-button">Return to Cart</Link>
          <Link href="/shop" className="gdg-secondary-button">Keep Shopping</Link>
        </div>
      </section>
      <StorefrontFooter settings={settings} />
    </main>
  );
}
