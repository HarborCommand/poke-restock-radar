import { listPublicStoreProducts } from "@/lib/storefront";
import { storefrontProductFeedXml } from "@/lib/storefront-product-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const products = await listPublicStoreProducts();
  return new Response(storefrontProductFeedXml(products), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=900, s-maxage=900"
    }
  });
}
