import { notFound } from "next/navigation";
import { ProductDetail, ProductGrid, StorefrontHeader } from "@/components/StorefrontClient";
import { getPublicStoreProduct, getStorefrontSettings, listPublicStoreProducts } from "@/lib/storefront";

export async function StorefrontHomeView() {
  const [settings, products] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid products={products} settings={settings} />
    </main>
  );
}

export async function StorefrontProductView({ slug }: { slug: string }) {
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
