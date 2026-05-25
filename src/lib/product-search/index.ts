import { productSearchConfig, productSearchFailure } from "@/lib/product-search/provider";
import { searchCustomProvider } from "@/lib/product-search/providers/custom";
import { searchSerpApiProvider } from "@/lib/product-search/providers/serpapi";
import type { ProductSearchResult } from "@/lib/product-search/types";

export { productSearchConfig } from "@/lib/product-search/provider";
export type { ProductSearchCandidate, ProductSearchConfig, ProductSearchFailure, ProductSearchResult } from "@/lib/product-search/types";

export async function searchProductsByUpc(upc: string): Promise<ProductSearchResult> {
  const config = productSearchConfig();
  if (!config.provider || !config.apiUrl || !config.apiKeyConfigured) {
    return {
      configured: false,
      provider: config.provider,
      candidates: [],
      failures: [
        productSearchFailure("search", "missing_env_or_no_results", {
          configured: false,
          detail: "PRODUCT_SEARCH_PROVIDER, PRODUCT_SEARCH_API_URL, or PRODUCT_SEARCH_API_KEY is missing."
        })
      ]
    };
  }

  const apiKey = process.env.PRODUCT_SEARCH_API_KEY?.trim() || "";
  if (config.provider === "serpapi" || config.provider === "google_shopping") {
    return searchSerpApiProvider(upc, { apiUrl: config.apiUrl, apiKey });
  }
  if (config.provider === "custom") {
    return searchCustomProvider(upc, { apiUrl: config.apiUrl, apiKey, provider: "custom" });
  }

  return {
    configured: true,
    provider: config.provider,
    candidates: [],
    failures: [
      productSearchFailure("search", "unsupported_provider", {
        configured: true,
        detail: `PRODUCT_SEARCH_PROVIDER=${config.provider} is not supported. Use serpapi or custom.`
      })
    ]
  };
}

