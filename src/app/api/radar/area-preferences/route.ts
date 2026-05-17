import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateStorePreference, updateUserAreaPreferences } from "@/lib/radar-service";
import { storePreferenceSchema, userAreaPreferencesSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = userAreaPreferencesSchema.parse(await readJson(request));
    const preferences = await updateUserAreaPreferences(user, input);
    await logAudit({
      user,
      action: "area.preferences.update",
      entityType: "USER",
      entityId: user.id,
      summary: `${user.email} updated My Area preferences.`
    });
    return ok({ preferences });
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = storePreferenceSchema.parse(await readJson(request));
    const preference = await updateStorePreference(user, input);
    await logAudit({
      user,
      action: "store.preference.update",
      entityType: "STORE",
      entityId: input.storeId,
      summary: `${user.email} updated store favorite/hidden preference.`
    });
    return ok({ preference });
  } catch (error) {
    return badRequest(error);
  }
}
