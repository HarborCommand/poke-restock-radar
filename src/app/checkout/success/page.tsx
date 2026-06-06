import { CheckoutSuccessClient, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Order Confirmed | GameDayGrabs LLC",
  description: "Your GameDayGrabs order was received."
};

export default async function CheckoutSuccessPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <CheckoutSuccessClient />
      <StorefrontFooter settings={settings} />
    </main>
  );
}
