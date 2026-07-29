import { requireAdmin, requireUser } from "@/lib/auth";
import { privateOk, safeApiError, withRequestId } from "@/lib/http";
import { buildCustomerRewardIntegrityReport } from "@/lib/customer-reward-integrity";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);

  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  try {
    const report = await buildCustomerRewardIntegrityReport(user.id);
    const response = privateOk(report);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return withRequestId(response, requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/customer-reward-integrity",
      operation: "customer_reward_integrity_report",
      status: 500,
      error
    });
    return safeApiError(
      "CUSTOMER_REWARD_INTEGRITY_UNAVAILABLE",
      "Customer and reward integrity report is unavailable.",
      500,
      requestId,
      true
    );
  }
}
