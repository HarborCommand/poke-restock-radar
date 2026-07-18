import { NextResponse } from "next/server";
import { safeApiError, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { searchPublicStoreProducts } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  try {
    const url = new URL(request.url);
    const result = await searchPublicStoreProducts({
      q: url.searchParams.get("q"),
      category: url.searchParams.get("category"),
      set: url.searchParams.get("set"),
      availability: url.searchParams.get("availability"),
      sort: url.searchParams.get("sort"),
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize")
    });
    return withRequestId(
      NextResponse.json(result, {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60"
        }
      }),
      requestId
    );
  } catch {
    return safeApiError("SHOP_SEARCH_FAILED", "Shop results could not be loaded.", 500, requestId, true);
  }
}
