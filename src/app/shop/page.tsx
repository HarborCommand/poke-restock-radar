import { ProductGrid, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontSettings, listPublicStoreProducts } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "GameDayGrabs LLC | Pokémon & Sports Card Shop",
  description: "Premium Pokémon and sports card products for collectors, players, and fans."
};

export default async function ShopPage() {
  const [settings, products] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid products={products} settings={settings} />
    </main>
  );
}
