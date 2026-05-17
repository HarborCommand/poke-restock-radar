import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { deleteSavedFilterPreset } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ presetId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const { presetId } = await params;
    return ok(await deleteSavedFilterPreset(user, presetId));
  } catch (error) {
    return badRequest(error);
  }
}
