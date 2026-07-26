import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { reviewTcgcsvMarketMatch } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    if (user.role !== "ADMIN") throw new Error("Admin access required.");
    const { itemId } = await params;
    const body = (await readJson(request)) as {
      action?: "accept" | "reject" | "lock" | "search_again" | "mark_unmatched";
      providerProductId?: string | null;
      manualConfirmation?: boolean;
    };
    if (!body.action || !["accept", "reject", "lock", "search_again", "mark_unmatched"].includes(body.action)) {
      throw new Error("Valid match action required.");
    }
    const item = await reviewTcgcsvMarketMatch(user, itemId, body.action, body.providerProductId, { manualConfirmation: body.manualConfirmation === true });
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
