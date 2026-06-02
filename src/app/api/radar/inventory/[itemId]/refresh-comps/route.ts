import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { refreshInventoryMarketEstimate } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const { itemId } = await params;
    return ok(await refreshInventoryMarketEstimate(user, itemId));
  } catch (error) {
    return badRequest(error);
  }
}
