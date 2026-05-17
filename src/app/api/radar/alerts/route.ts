import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { listDashboard, markAlertFalsePositive, markAlertRead } from "@/lib/radar-service";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const alertReadSchema = z.object({
  alertId: z.string().min(1),
  action: z.enum(["read", "false_positive"]).default("read")
});

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ alerts: dashboard.alerts });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = alertReadSchema.parse(await readJson(request));
    if (input.action === "false_positive") {
      return ok({ alert: await markAlertFalsePositive(user, input.alertId) });
    }
    return ok({ alert: await markAlertRead(input.alertId) });
  } catch (error) {
    return badRequest(error);
  }
}
