import { requirePermission, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { deleteSighting, updateSighting } from "@/lib/radar-service";
import { sightingUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ sightingId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddSightings", "Add sightings");
  if (permissionResponse) return permissionResponse;

  try {
    const { sightingId } = await params;
    const input = sightingUpdateSchema.parse(await readJson(request));
    return ok({ sighting: await updateSighting(user, sightingId, input) });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ sightingId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddSightings", "Add sightings");
  if (permissionResponse) return permissionResponse;

  try {
    const { sightingId } = await params;
    return ok(await deleteSighting(user, sightingId));
  } catch (error) {
    return badRequest(error);
  }
}
