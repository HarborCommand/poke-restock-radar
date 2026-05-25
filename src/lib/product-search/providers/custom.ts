import {
  buildProviderUrl,
  errorStatusCode,
  fetchProviderJson,
  firstNumber,
  firstString,
  productSearchFailure,
  rankSearchCandidates,
  rootCandidateRecords
} from "@/lib/product-search/provider";
import type { ProductSearchCandidate, ProductSearchResult } from "@/lib/product-search/types";

export async function searchCustomProvider(upc: string, config: { apiUrl: string; apiKey: string; provider: string }): Promise<ProductSearchResult> {
  try {
    const url = buildProviderUrl(config.apiUrl, upc, { apiKey: config.apiKey });
    const payload = await fetchProviderJson(url, config.apiKey);
    const rawCandidates = rootCandidateRecords(payload).map((record): Omit<ProductSearchCandidate, "confidence"> => {
      const productUrl = firstString(record, ["productUrl", "product_url", "url", "link", "canonicalUrl"]);
      return {
        title: firstString(record, ["title", "name", "productName", "product_name", "description"]) || "",
        brand: firstString(record, ["brand", "brandName", "manufacturer", "publisher"]),
        category: firstString(record, ["category", "categoryName", "productType", "department"]),
        imageUrl: firstString(record, ["imageUrl", "image_url", "image", "thumbnail", "largeImage"]),
        retailer: firstString(record, ["retailer", "source", "store", "merchant", "seller"]),
        productUrl,
        price: firstNumber(record, ["price", "salePrice", "listPrice", "msrp", "extracted_price"]),
        sku: firstString(record, ["sku", "model", "mpn", "asin", "itemId", "item_id", "productId"]),
        tcin: firstString(record, ["tcin", "dpci"]),
        upc: firstString(record, ["upc", "barcode", "ean", "gtin"]),
        source: config.provider
      };
    });
    const candidates = rankSearchCandidates(upc, rawCandidates);
    return {
      configured: true,
      provider: config.provider,
      candidates,
      failures: candidates.length
        ? []
        : [productSearchFailure("search", "missing_env_or_no_results", { configured: true, detail: "Custom product search returned no usable candidates." })]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom product search failed.";
    return {
      configured: true,
      provider: config.provider,
      candidates: [],
      failures: [productSearchFailure("search", "provider_error", { configured: true, statusCode: errorStatusCode(error), detail: message })]
    };
  }
}

