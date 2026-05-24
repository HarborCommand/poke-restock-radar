import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { refreshAllInventoryMarketComps } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const result = await refreshAllInventoryMarketComps(user);
    await logAudit({
      user,
      action: "inventory.market.refresh_all",
      entityType: "INVENTORY",
      entityId: null,
      summary: `${user.email} refreshed inventory market comps: ${result.refreshedCount} item(s).`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
