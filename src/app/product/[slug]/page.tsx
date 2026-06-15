import { StorefrontProductView } from "@/components/StorefrontServerViews";
import { getPublicStoreProduct } from "@/lib/storefront";
import {
  GAMEDAYGRABS_CANONICAL_ORIGIN,
  GAMEDAYGRABS_OG_FALLBACK_IMAGE,
  GAMEDAYGRABS_SEO_SITE_NAME,
  productCanonicalUrl,
  storefrontProductMetadata
} from "@/lib/storefront-seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicStoreProduct(slug);
  if (product) return storefrontProductMetadata(product);

  const title = `Product | ${GAMEDAYGRABS_SEO_SITE_NAME}`;
  const description = "Shop premium Pokemon and sports card products from GameDayGrabs.";
  const canonicalUrl = productCanonicalUrl(slug);
  return {
    metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
    title,
    description,
    alternates: {
      canonical: canonicalUrl
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: GAMEDAYGRABS_SEO_SITE_NAME,
      images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
    }
  };
}

export default async function ProductAliasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StorefrontProductView slug={slug} />;
}
