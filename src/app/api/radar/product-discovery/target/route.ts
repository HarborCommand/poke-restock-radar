import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import {
  approveHighConfidenceTargetDiscoveryCandidates,
  clearRejectedTargetDiscoveryCandidates,
  ensureTargetDiscoverySources,
  listDashboard,
  runTargetProductDiscoveryNow
} from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const targetDiscoveryActionSchema = z.object({
  action: z.enum(["ensure_sources", "run_now", "approve_high_confidence", "clear_rejected"])
});

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = targetDiscoveryActionSchema.parse(await readJson(request));
    let result: unknown;
    if (input.action === "ensure_sources") result = await ensureTargetDiscoverySources();
    if (input.action === "run_now") result = await runTargetProductDiscoveryNow();
    if (input.action === "approve_high_confidence") result = await approveHighConfidenceTargetDiscoveryCandidates();
    if (input.action === "clear_rejected") result = await clearRejectedTargetDiscoveryCandidates();

    await logAudit({
      user,
      action: `product.discovery.target.${input.action}`,
      entityType: "PRODUCT_DISCOVERY_SOURCE",
      summary: `${user.email} ran Target Pokemon TCG discovery action ${input.action}.`
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
