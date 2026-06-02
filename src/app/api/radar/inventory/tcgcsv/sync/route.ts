import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { syncTcgcsvMarketData } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    if (user.role !== "ADMIN") throw new Error("Admin access required.");
    const body = (await readJson(request)) as { limitGroups?: number; refreshLimit?: number };
    const result = await syncTcgcsvMarketData(user, {
      limitGroups: body.limitGroups,
      refreshLimit: body.refreshLimit
    });
    await logAudit({
      user,
      action: "inventory.market.tcgcsv_sync",
      entityType: "INVENTORY",
      entityId: null,
      summary: `${user.email} synced TCGCSV market data: ${result.productsCached} cached product(s).`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
