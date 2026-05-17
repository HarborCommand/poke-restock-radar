import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createSighting } from "@/lib/radar-service";
import { sightingCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddSightings", "Add sightings");
  if (permissionResponse) return permissionResponse;

  try {
    const input = sightingCreateSchema.parse(await readJson(request));
    const sighting = await createSighting(user.id, input);
    await logAudit({
      user,
      action: "sighting.created",
      entityType: "STORE",
      entityId: input.storeId,
      summary: `${user.email} logged ${input.resultType.replaceAll("_", " ")} for ${input.productSeen}.`
    });
    return ok({ sighting }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
