import { notFound } from "next/navigation";
import { ProductDetail, ProductGrid, StorefrontCollectionLanding, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { getPublicStoreProduct, getStorefrontSettings, listPublicStoreProducts } from "@/lib/storefront";
import { storefrontJsonLdScript, storefrontProductJsonLd } from "@/lib/storefront-seo";
import {
  getStorefrontCollection,
  relatedStorefrontCollections,
  storefrontCollectionJsonLdScripts,
  storefrontCollectionProducts
} from "@/lib/storefront-collections";

type StorefrontShopViewParams = {
  category?: string | null;
  sort?: string | null;
  availability?: string | null;
};

export async function StorefrontHomeView() {
  const [settings, products, homeHref] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid products={products} settings={settings} mode="home" />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}

export async function StorefrontShopView({ category, sort, availability }: StorefrontShopViewParams = {}) {
  const [settings, products, homeHref] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid products={products} settings={settings} mode="shop" initialCategory={category} initialSort={sort} initialAvailability={availability} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}

export async function StorefrontCollectionView({ slug }: { slug: string }) {
  const collection = getStorefrontCollection(slug);
  if (!collection) notFound();

  const [settings, products, homeHref] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts(), getStorefrontHomeHref()]);
  const collectionProducts = storefrontCollectionProducts(collection, products, { newArrivalDays: settings.newArrivalDays });
  const relatedCollections = relatedStorefrontCollections(collection);
  const jsonLdScripts = storefrontCollectionJsonLdScripts(collection, collectionProducts);

  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      {jsonLdScripts.map((script, index) => (
        <script
          key={`${collection.slug}-jsonld-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: script }}
        />
      ))}
      <StorefrontCollectionLanding collection={collection} products={collectionProducts} relatedCollections={relatedCollections} settings={settings} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}

export async function StorefrontProductView({ slug }: { slug: string }) {
  const [settings, product, homeHref] = await Promise.all([getStorefrontSettings(), getPublicStoreProduct(slug), getStorefrontHomeHref()]);
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
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: storefrontJsonLdScript(storefrontProductJsonLd(product)) }}
      />
      <ProductDetail product={product} settings={settings} relatedProducts={relatedProducts} />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
