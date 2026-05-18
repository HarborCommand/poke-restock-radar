import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { refreshCardEbayComps } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddComps", "Refresh comps");
  if (permissionResponse) return permissionResponse;

  try {
    const { cardId } = await params;
    const result = await refreshCardEbayComps(user, cardId);
    await logAudit({
      user,
      action: "card.comps.refresh",
      entityType: "CARD",
      entityId: cardId,
      summary: `${user.email} refreshed card comps in ${result.mode} mode. ${result.added} comps added.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
