import { StorefrontProductView } from "@/components/StorefrontServerViews";
import { getPublicStoreProduct } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicStoreProduct(slug);
  const title = product ? `${product.title} | GameDayGrabs LLC` : "Product | GameDayGrabs LLC";
  const description = product?.description || "Shop premium Pokemon and sports card products from GameDayGrabs LLC.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: product?.imageUrl ? [product.imageUrl] : ["/icons/icon-512.png"]
    }
  };
}

export default async function ProductAliasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StorefrontProductView slug={slug} />;
}
