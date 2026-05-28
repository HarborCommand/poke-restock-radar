import { notFound } from "next/navigation";
import { ProductDetail, StorefrontHeader } from "@/components/StorefrontClient";
import { getPublicStoreProduct, getStorefrontSettings } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShopProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [settings, product] = await Promise.all([getStorefrontSettings(), getPublicStoreProduct(slug)]);
  if (!product) notFound();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <ProductDetail product={product} />
    </main>
  );
}
