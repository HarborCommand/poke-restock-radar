import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { reviewProductDiscoveryCandidate } from "@/lib/radar-service";
import { productDiscoveryReviewSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { candidateId } = await params;
    const input = productDiscoveryReviewSchema.parse(await readJson(request));
    const result = await reviewProductDiscoveryCandidate(candidateId, input);
    await logAudit({
      user,
      action: `product.discovery.candidate.${input.action}`,
      entityType: "PRODUCT_DISCOVERY_CANDIDATE",
      entityId: candidateId,
      summary: `${user.email} ${input.action === "approve" ? "approved" : "ignored"} discovery candidate.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
