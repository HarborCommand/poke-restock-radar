import { CartClient, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Cart | GameDayGrabs LLC",
  description: "Review your GameDayGrabs cart and request an invoice or checkout."
};

export default async function CartPage() {
  const settings = await getStorefrontSettings();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <CartClient settings={settings} />
      <StorefrontFooter settings={settings} />
    </main>
  );
}
