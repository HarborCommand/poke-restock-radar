import Link from "next/link";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings, releaseUnpaidCheckoutOrder } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Checkout Canceled | GameDayGrabs LLC",
  description: "Your GameDayGrabs cart was not charged."
};

export default async function CheckoutCancelPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const params = await searchParams;
  const [settings, homeHref, releaseResult] = await Promise.all([
    getStorefrontSettings(),
    getStorefrontHomeHref(),
    releaseUnpaidCheckoutOrder(params.order)
  ]);
  const releaseMessage =
    releaseResult.reason === "already_paid"
      ? "Payment has already been confirmed for this order. Contact GameDayGrabs if this looks incorrect."
      : releaseResult.released || releaseResult.reason === "checkout_canceled" || releaseResult.reason === "already_canceled"
        ? "Your checkout session expired. Your items were released back to inventory. You can start checkout again if they are still available."
        : "Items are released automatically if checkout expires or payment is not completed.";
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-result-card">
        <span>!</span>
        <h1>Your cart was not charged</h1>
        <p>{releaseMessage}</p>
        <div className="gdg-result-actions">
          <Link href="/cart" className="gdg-primary-button">Return to Cart</Link>
          <Link href="/shop" className="gdg-secondary-button">Keep Shopping</Link>
        </div>
      </section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
