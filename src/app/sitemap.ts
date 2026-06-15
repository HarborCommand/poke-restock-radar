import type { MetadataRoute } from "next";
import { listPublicStoreProducts } from "@/lib/storefront";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, productCanonicalUrl } from "@/lib/storefront-seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const staticSitemapPaths = ["/", "/shop", "/about", "/policies", "/contact"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages = staticSitemapPaths.map((path) => ({
    url: `${GAMEDAYGRABS_CANONICAL_ORIGIN}${path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/shop" ? "daily" : "monthly",
    priority: path === "/" ? 1 : path === "/shop" ? 0.9 : 0.6
  })) satisfies MetadataRoute.Sitemap;

  const products = await listPublicStoreProducts();
  const productPages = products.map((product) => ({
    url: productCanonicalUrl(product.slug),
    lastModified: new Date(product.updatedAt),
    changeFrequency: product.status === "active" ? "daily" : "weekly",
    priority: product.status === "active" ? 0.8 : 0.5
  })) satisfies MetadataRoute.Sitemap;

  return [...staticPages, ...productPages];
}
