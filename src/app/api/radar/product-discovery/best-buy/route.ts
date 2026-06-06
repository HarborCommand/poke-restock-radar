import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { ensureBestBuyDiscoverySources, listDashboard, runAutomaticBestBuyDiscoveryPipeline } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bestBuyDiscoveryActionSchema = z.object({
  action: z.enum(["ensure_sources", "run_auto_pipeline"])
});

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = bestBuyDiscoveryActionSchema.parse(await readJson(request));
    const result =
      input.action === "ensure_sources"
        ? await ensureBestBuyDiscoverySources()
        : await runAutomaticBestBuyDiscoveryPipeline(true);

    await logAudit({
      user,
      action: `product.discovery.best_buy.${input.action}`,
      entityType: "PRODUCT_DISCOVERY_SOURCE",
      summary: `${user.email} ran Best Buy Pokemon TCG discovery action ${input.action}.`
    });
    const dashboard = await listDashboard(user);
    return ok({
      result,
      scannerStatus: dashboard.scannerStatus,
      sources: dashboard.productDiscoverySources,
      candidates: dashboard.productDiscoveryCandidates
    });
  } catch (error) {
    return badRequest(error);
  }
}
