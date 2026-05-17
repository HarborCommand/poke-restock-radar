import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { runProductMonitorBatch } from "@/lib/monitor";
import { monitorRunSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canRunChecks", "Run checks");
  if (permissionResponse) return permissionResponse;

  try {
    const input = monitorRunSchema.parse(await readJson(request));
    const result = await runProductMonitorBatch(input.mode);
    await logAudit({
      user,
      action: "monitor.batch.run",
      entityType: "MONITOR",
      summary: `${user.email} ran ${input.mode} monitor checks.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
