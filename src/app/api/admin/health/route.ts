import { requireAdmin, requireUser } from "@/lib/auth";
import { getAppHealth } from "@/lib/health";
import { privateOk, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);

  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  const health = await getAppHealth(user);
  return withRequestId(privateOk(health, health.status === "ERROR" ? 503 : 200), requestId);
}
