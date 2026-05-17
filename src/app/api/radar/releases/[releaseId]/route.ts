import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { deleteRelease, updateRelease } from "@/lib/radar-service";
import { releaseCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { releaseId } = await params;
    const input = releaseCreateSchema.parse(await readJson(request));
    return ok({ release: await updateRelease(releaseId, input) });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { releaseId } = await params;
    return ok(await deleteRelease(releaseId));
  } catch (error) {
    return badRequest(error);
  }
}
