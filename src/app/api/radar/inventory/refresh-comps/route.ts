import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { refreshAllInventoryMarketComps } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const body = (await readJson(request)) as { mode?: "missing" | "stale" | "all"; limit?: number };
    const result = await refreshAllInventoryMarketComps(user, {
      onlyMissing: body.mode === "missing",
      onlyStale: body.mode === "stale",
      limit: body.limit
    });
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
