import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { reviewTcgcsvMarketMatch } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    if (user.role !== "ADMIN") throw new Error("Admin access required.");
    const { itemId } = await params;
    const body = (await readJson(request)) as { action?: "accept" | "reject" | "lock" | "search_again" };
    if (!body.action || !["accept", "reject", "lock", "search_again"].includes(body.action)) {
      throw new Error("Valid match action required.");
    }
    const item = await reviewTcgcsvMarketMatch(user, itemId, body.action);
    await logAudit({
      user,
      action: `inventory.market.tcgcsv_match.${body.action}`,
      entityType: "INVENTORY",
      entityId: itemId,
      summary: `${user.email} ${body.action.replace("_", " ")} TCGCSV match for ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}
