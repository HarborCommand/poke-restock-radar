import { notFound } from "next/navigation";
import { ProductDetail, StorefrontHeader } from "@/components/StorefrontClient";
import { getPublicStoreProduct, getStorefrontSettings, listPublicStoreProducts } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicStoreProduct(slug);
  return {
    title: product ? `${product.title} | GameDayGrabs LLC` : "Product | GameDayGrabs LLC",
    description: product?.description || "Shop premium Pokemon and sports card products from GameDayGrabs LLC."
  };
}

export default async function ShopProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [settings, product] = await Promise.all([getStorefrontSettings(), getPublicStoreProduct(slug)]);
  if (!product) notFound();
  const products = await listPublicStoreProducts();
  const relatedProducts = products
    .filter((entry) => entry.id !== product.id)
    .sort((left, right) => {
      const leftScore = left.category === product.category ? 0 : 1;
      const rightScore = right.category === product.category ? 0 : 1;
      return leftScore - rightScore;
    })
    .slice(0, 4);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      <ProductDetail product={product} settings={settings} relatedProducts={relatedProducts} />
    </main>
  );
}
