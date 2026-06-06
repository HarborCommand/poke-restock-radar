import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import {
  approveHighConfidenceEnrichedTargetDiscoveryCandidates,
  approveHighConfidenceTargetDiscoveryCandidates,
  approveWatchReadyTargetDiscoveryCandidates,
  clearRejectedTargetDiscoveryCandidates,
  enrichPendingTargetDiscoveryCandidates,
  ensureTargetDiscoverySources,
  listDashboard,
  rejectNonTcgTargetDiscoveryCandidates,
  reviewSelectedTargetDiscoveryCandidates,
  runAutomaticTargetDiscoveryPipeline,
  runTargetProductDiscoveryNow,
  testTargetDiscoveryUrl
} from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const targetDiscoveryActionSchema = z.object({
  action: z.enum([
    "ensure_sources",
    "run_now",
    "enrich_all_pending",
    "approve_high_confidence",
    "approve_high_confidence_enriched",
    "approve_watch_ready",
    "approve_selected",
    "reject_selected",
    "ignore_selected",
    "reject_all_non_tcg",
    "clear_rejected",
    "run_auto_pipeline",
    "test_url"
  ]),
  url: z.string().url().optional(),
  candidateIds: z.array(z.string().trim().min(1)).max(100).optional()
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
    if (input.action === "enrich_all_pending") result = await enrichPendingTargetDiscoveryCandidates();
    if (input.action === "approve_high_confidence") result = await approveHighConfidenceTargetDiscoveryCandidates();
    if (input.action === "approve_high_confidence_enriched") result = await approveHighConfidenceEnrichedTargetDiscoveryCandidates();
    if (input.action === "approve_watch_ready") result = await approveWatchReadyTargetDiscoveryCandidates();
    if (input.action === "approve_selected") result = await reviewSelectedTargetDiscoveryCandidates(input.candidateIds || [], "approve");
    if (input.action === "reject_selected") result = await reviewSelectedTargetDiscoveryCandidates(input.candidateIds || [], "reject_non_tcg");
    if (input.action === "ignore_selected") result = await reviewSelectedTargetDiscoveryCandidates(input.candidateIds || [], "ignore");
    if (input.action === "reject_all_non_tcg") result = await rejectNonTcgTargetDiscoveryCandidates();
    if (input.action === "clear_rejected") result = await clearRejectedTargetDiscoveryCandidates();
    if (input.action === "run_auto_pipeline") result = await runAutomaticTargetDiscoveryPipeline(true);
    if (input.action === "test_url") {
      if (!input.url) throw new Error("Target discovery test URL is required.");
      result = await testTargetDiscoveryUrl(input.url);
    }

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
