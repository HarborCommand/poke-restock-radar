import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { refreshAllCardEbayComps } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const result = await refreshAllCardEbayComps(user);
    await logAudit({
      user,
      action: "card.comps.refresh_all",
      entityType: "CARD",
      summary: `${user.email} refreshed all card comps in ${result.mode} mode. ${result.added} comps added.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
