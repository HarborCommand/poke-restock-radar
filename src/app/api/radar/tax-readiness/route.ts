import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, safeApiError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { getStripeTaxReadiness, runStripeTaxConnectivityCheck } from "@/lib/stripe-tax-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizedAdmin(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return { requestId, response: withPrivateNoStore(withRequestId(response, requestId)) } as const;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return { requestId, response: withPrivateNoStore(withRequestId(adminResponse, requestId)) } as const;
  return { requestId, user } as const;
}

export async function GET(request: Request) {
  const authorization = await authorizedAdmin(request);
  if ("response" in authorization) return authorization.response;
  return withRequestId(privateOk(await getStripeTaxReadiness(authorization.user.id)), authorization.requestId);
}

export async function POST(request: Request) {
  const authorization = await authorizedAdmin(request);
  if ("response" in authorization) return authorization.response;
  const originResponse = authorizeAdminMutation(request, authorization.user);
  if (originResponse) return withPrivateNoStore(withRequestId(originResponse, authorization.requestId));
  try {
    await checkPublicRateLimit({ request, action: "admin_tax_provider_check" });
    return withRequestId(privateOk(await runStripeTaxConnectivityCheck(authorization.user.id)), authorization.requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) {
      return withPrivateNoStore(withRequestId(publicRateLimitResponse(error), authorization.requestId));
    }
    console.error("Stripe Tax readiness check failed", {
      requestId: authorization.requestId,
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    return safeApiError("STRIPE_TAX_READINESS_FAILED", "Stripe Tax readiness could not be checked safely.", 503, authorization.requestId, true);
  }
}
