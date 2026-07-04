import { listPublicStoreProducts } from "@/lib/storefront";
import { storefrontProductFeedXml } from "@/lib/storefront-product-feed";
import { shippingProfileDefinitionsForCheckout } from "@/lib/shipping-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [products, profileDefinitions] = await Promise.all([listPublicStoreProducts({ onlySellable: true }), shippingProfileDefinitionsForCheckout()]);
  return new Response(storefrontProductFeedXml(products, { profileDefinitions }), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=900, s-maxage=900"
    }
  });
}
