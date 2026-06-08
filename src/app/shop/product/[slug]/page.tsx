import { StorefrontProductView } from "@/components/StorefrontServerViews";
import { getPublicStoreProduct } from "@/lib/storefront";
import { GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicStoreProduct(slug);
  const title = product ? `${product.title} | GameDayGrabs LLC` : "Product | GameDayGrabs LLC";
  const description = product?.description || "Shop premium Pokemon and sports card products from GameDayGrabs LLC.";
  return {
    metadataBase: new URL(`https://${GAMEDAYGRABS_WWW_DOMAIN}`),
    title,
      description,
      openGraph: {
        title,
        description,
        url: `https://${GAMEDAYGRABS_WWW_DOMAIN}/shop/product/${slug}`,
        siteName: "GameDayGrabs LLC",
        images: product?.imageUrl ? [product.imageUrl] : ["/brand/gamedaygrabs-logo-horizontal.png"]
      }
    };
}

export default async function ShopProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StorefrontProductView slug={slug} />;
}
