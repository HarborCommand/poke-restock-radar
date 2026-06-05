import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { enrichTargetDiscoveryCandidate } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { candidateId } = await params;
    const candidate = await enrichTargetDiscoveryCandidate(candidateId);
    await logAudit({
      user,
      action: "product.discovery.candidate.enrich",
      entityType: "PRODUCT_DISCOVERY_CANDIDATE",
      entityId: candidateId,
      summary: `${user.email} enriched a Target discovery candidate from the exact product page.`
    });
    return ok({ candidate });
  } catch (error) {
    return badRequest(error);
  }
}
