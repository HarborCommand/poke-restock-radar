import { CheckoutSuccessClient, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Order Confirmed | GameDayGrabs LLC",
  description: "Your GameDayGrabs order was received."
};

export default async function CheckoutSuccessPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <CheckoutSuccessClient />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
