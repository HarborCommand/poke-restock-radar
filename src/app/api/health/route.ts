import { ok, withRequestId } from "@/lib/http";
import { getAppHealth, publicHealthFromAppHealth } from "@/lib/health";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const health = await getAppHealth();
  const status = health.status === "ERROR" ? 503 : 200;
  if (health.status !== "OK") {
    logServerEvent({
      level: health.status === "ERROR" ? "error" : "warn",
      requestId,
      route: "/api/health",
      operation: "health.check",
      status,
      durationMs: Date.now() - startedAt,
      metadata: { healthStatus: health.status, databaseOk: health.database.ok }
    });
  }
  return withRequestId(ok(publicHealthFromAppHealth(health), status), requestId);
}
