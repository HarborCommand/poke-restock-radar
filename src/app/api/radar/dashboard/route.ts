import { requireUser } from "@/lib/auth";
import { internalServerError, ok, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  try {
    return withRequestId(ok(await listDashboard(user)), requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/dashboard",
      operation: "dashboard.load",
      status: 500,
      durationMs: Date.now() - startedAt,
      error
    });
    return internalServerError(requestId, "Private dashboard failed to load after sign-in.");
  }
}
