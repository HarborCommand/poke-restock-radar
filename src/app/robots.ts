import type { MetadataRoute } from "next";
import { GAMEDAYGRABS_WWW_DOMAIN } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN } from "@/lib/storefront-seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/shop", "/collections/", "/product/", "/shop/product/", "/about", "/policies", "/contact", "/product-feed.xml"],
        disallow: [
          "/admin",
          "/app",
          "/account",
          "/auth",
          "/dashboard",
          "/login",
          "/api/",
          "/cart",
          "/shop/cart",
          "/checkout/",
          "/offline.html"
        ]
      }
    ],
    sitemap: `${GAMEDAYGRABS_CANONICAL_ORIGIN}/sitemap.xml`,
    host: `https://${GAMEDAYGRABS_WWW_DOMAIN}`
  };
}
