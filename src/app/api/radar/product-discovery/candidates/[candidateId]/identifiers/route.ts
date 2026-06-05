import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateProductDiscoveryCandidateIdentifiers } from "@/lib/radar-service";
import { productDiscoveryIdentifierSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { candidateId } = await params;
    const input = productDiscoveryIdentifierSchema.parse(await readJson(request));
    const candidate = await updateProductDiscoveryCandidateIdentifiers(candidateId, input);
    await logAudit({
      user,
      action: "product.discovery.candidate.identifiers",
      entityType: "PRODUCT_DISCOVERY_CANDIDATE",
      entityId: candidateId,
      summary: `${user.email} edited Target discovery candidate identifiers.`
    });
    return ok({ candidate });
  } catch (error) {
    return badRequest(error);
  }
}
