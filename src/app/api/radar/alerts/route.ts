import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { listDashboard, markAlertRead } from "@/lib/radar-service";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const alertReadSchema = z.object({
  alertId: z.string().min(1)
});

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ alerts: dashboard.alerts });
}

export async function PATCH(request: Request) {
  const { response } = await requireUser();
  if (response) return response;

  try {
    const input = alertReadSchema.parse(await readJson(request));
    return ok({ alert: await markAlertRead(input.alertId) });
  } catch (error) {
    return badRequest(error);
  }
}
