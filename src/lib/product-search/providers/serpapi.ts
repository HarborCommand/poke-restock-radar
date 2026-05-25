import {
  buildProviderUrl,
  errorStatusCode,
  fetchProviderJson,
  firstNumber,
  firstString,
  productSearchFailure,
  rankSearchCandidates,
  recordArray
} from "@/lib/product-search/provider";
import type { ProductSearchCandidate, ProductSearchResult } from "@/lib/product-search/types";

function serpApiRecords(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  return [
    ...recordArray(record.shopping_results),
    ...recordArray(record.inline_shopping_results),
    ...recordArray(record.organic_results),
    ...recordArray(record.product_results)
  ];
}

export async function searchSerpApiProvider(upc: string, config: { apiUrl: string; apiKey: string }): Promise<ProductSearchResult> {
  try {
    const url = buildProviderUrl(config.apiUrl, upc, {
      apiKey: config.apiKey,
      defaults: {
        engine: "google_shopping",
        gl: "us",
        hl: "en"
      }
    });
    const payload = await fetchProviderJson(url, null);
    const rawCandidates = serpApiRecords(payload).map((record): Omit<ProductSearchCandidate, "confidence"> => {
      const productUrl = firstString(record, ["product_link", "link", "serpapi_product_api"]);
      return {
        title: firstString(record, ["title", "name"]) || "",
        brand: firstString(record, ["brand"]),
        category: firstString(record, ["category", "snippet"]),
        imageUrl: firstString(record, ["thumbnail", "serpapi_thumbnail", "image"]),
        retailer: firstString(record, ["source", "seller", "merchant"]),
        productUrl,
        price: firstNumber(record, ["extracted_price", "price"]),
        sku: firstString(record, ["product_id", "sku"]),
        tcin: null,
        upc: firstString(record, ["upc", "gtin"]),
        source: "serpapi"
      };
    });
    const candidates = rankSearchCandidates(upc, rawCandidates);
    return {
      configured: true,
      provider: "serpapi",
      candidates,
      failures: candidates.length
        ? []
        : [productSearchFailure("search", "missing_env_or_no_results", { configured: true, detail: "SerpApi returned no usable Google Shopping candidates." })]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SerpApi product search failed.";
    return {
      configured: true,
      provider: "serpapi",
      candidates: [],
      failures: [productSearchFailure("search", "provider_error", { configured: true, statusCode: errorStatusCode(error), detail: message })]
    };
  }
}

