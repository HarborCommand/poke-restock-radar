import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createSavedFilterPreset } from "@/lib/radar-service";
import { savedFilterPresetSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = savedFilterPresetSchema.parse(await readJson(request));
    const preset = await createSavedFilterPreset(user, input);
    await logAudit({
      user,
      action: "filter_preset.created",
      entityType: "FILTER_PRESET",
      entityId: preset.id,
      summary: `${user.email} saved ${preset.section} filter preset ${preset.name}.`
    });
    return ok({ preset }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
