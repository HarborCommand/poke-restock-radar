import { CartClient, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Cart | GameDayGrabs LLC",
  description: "Review your GameDayGrabs cart and request an invoice or checkout."
};

export default async function CartPage() {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <CartClient settings={settings} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
