import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createDailyRecap } from "@/lib/radar-service";
import { dailyRecapCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = dailyRecapCreateSchema.parse(await readJson(request));
    const recap = await createDailyRecap(user, input);
    await logAudit({
      user,
      action: "daily_recap.created",
      entityType: "DAILY_RECAP",
      entityId: recap.id,
      summary: `${user.email} generated a daily recap for ${recap.recapDate.slice(0, 10)}.`
    });
    return ok({ recap }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
