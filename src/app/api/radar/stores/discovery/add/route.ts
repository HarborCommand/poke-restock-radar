import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { addDiscoveredStores } from "@/lib/store-discovery";
import { storeDiscoveryAddSchema } from "@/lib/validation";
import type { StoreDiscoveryCandidateDTO } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = storeDiscoveryAddSchema.parse(await readJson(request));
    const candidates: StoreDiscoveryCandidateDTO[] = input.candidates.map((candidate) => ({
      ...candidate,
      zip: candidate.zip ?? null,
      latitude: candidate.latitude ?? null,
      longitude: candidate.longitude ?? null,
      phone: candidate.phone ?? null,
      placeId: candidate.placeId ?? null,
      googleMapsUrl: candidate.googleMapsUrl ?? null,
      distanceMiles: candidate.distanceMiles ?? null,
      duplicateReason: candidate.duplicateReason ?? null
    }));
    const result = await addDiscoveredStores(candidates);
    await logAudit({
      user,
      action: "stores.discovery.add",
      entityType: "STORE",
      entityId: null,
      summary: `${user.email} added ${result.created} discovered store${result.created === 1 ? "" : "s"}.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
