import { notFound, permanentRedirect } from "next/navigation";
import { ProductDetail, ProductGrid, StorefrontCollectionLanding, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { getPublicStoreProduct, getRelatedPublicStoreProducts, getStorefrontSettings, listPublicStoreProducts, searchPublicStoreProducts } from "@/lib/storefront";
import { productCanonicalPath, storefrontJsonLdScript, storefrontOrganizationJsonLd, storefrontProductJsonLd } from "@/lib/storefront-seo";
import {
  getStorefrontCollection,
  relatedStorefrontCollections,
  storefrontCollectionJsonLdScripts,
  storefrontCollectionProducts
} from "@/lib/storefront-collections";

type StorefrontShopViewParams = {
  q?: string | null;
  category?: string | null;
  set?: string | null;
  sort?: string | null;
  availability?: string | null;
  page?: string | null;
};

export async function StorefrontHomeView() {
  const [settings, products, homeHref] = await Promise.all([getStorefrontSettings(), listPublicStoreProducts({ limit: 96 }), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: storefrontJsonLdScript(storefrontOrganizationJsonLd()) }}
      />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid products={products} settings={settings} mode="home" />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}

export async function StorefrontShopView({ q, category, set, sort, availability, page }: StorefrontShopViewParams = {}) {
  const [settings, shopResult, homeHref] = await Promise.all([
    getStorefrontSettings(),
    searchPublicStoreProducts({ q, category, set, sort, availability, page }),
    getStorefrontHomeHref()
  ]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      {settings.announcementBanner ? <section className="shop-announcement">{settings.announcementBanner}</section> : null}
      <ProductGrid
        products={shopResult.products}
        settings={settings}
        mode="shop"
        initialQuery={shopResult.applied.q}
        initialCategory={shopResult.applied.category}
        initialSet={shopResult.applied.set}
        initialSort={shopResult.applied.sort}
        initialAvailability={shopResult.applied.availability}
        initialShopResult={shopResult}
      />
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
  if (slug !== product.slug) permanentRedirect(productCanonicalPath(product.slug));
  const relatedProducts = await getRelatedPublicStoreProducts(product, 4);
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
