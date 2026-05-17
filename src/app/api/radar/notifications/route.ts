import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateNotificationSettings } from "@/lib/radar-service";
import { notificationSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = notificationSettingsSchema.parse(await readJson(request));
    return ok({ notificationSettings: await updateNotificationSettings(user, input) });
  } catch (error) {
    return badRequest(error);
  }
}
