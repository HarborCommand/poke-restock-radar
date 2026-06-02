import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { searchTcgcsvMarketMatches } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    if (user.role !== "ADMIN") throw new Error("Admin access required.");
    const url = new URL(request.url);
    const itemId = url.searchParams.get("itemId") || "";
    if (!itemId) throw new Error("Inventory item is required.");
    const candidates = await searchTcgcsvMarketMatches(user, itemId, {
      query: url.searchParams.get("query") || undefined,
      group: url.searchParams.get("group") || undefined,
      productType: url.searchParams.get("productType") || undefined,
      limit: Number(url.searchParams.get("limit") || 8)
    });
    return ok({ candidates });
  } catch (error) {
    return badRequest(error);
  }
}
