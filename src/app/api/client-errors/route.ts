import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { clientErrorPayloadLimit, parseClientErrorPayload } from "@/lib/client-error-intake";
import { privateJson, safeApiError, safeMutationError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  try {
    assertSameOriginRequest(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > clientErrorPayloadLimit) {
      return safeApiError("PAYLOAD_TOO_LARGE", "The error report is too large.", 413, requestId);
    }
    await checkPublicRateLimit({ request, action: "client_error" });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > clientErrorPayloadLimit) {
      return safeApiError("PAYLOAD_TOO_LARGE", "The error report is too large.", 413, requestId);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = null;
    }
    const report = parseClientErrorPayload(decoded);
    logServerEvent({
      level: "warn",
      requestId: report.requestId || requestId,
      route: "/api/client-errors",
      operation: `client.${report.event}`,
      status: 202,
      durationMs: Date.now() - startedAt,
      metadata: {
        message: report.message,
        stack: report.stack,
        component: report.component,
        url: report.url,
        browser: report.browser
      }
    });
    return withRequestId(privateJson({ ok: true, requestId }, 202), requestId);
  } catch (error) {
    if (error instanceof AuthOriginError) {
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/client-errors",
        operation: "client_error.origin_rejected",
        status: 403,
        error
      });
      return withRequestId(authOriginErrorResponse(), requestId);
    }
    if (error instanceof PublicRateLimitExceededError) {
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/client-errors",
        operation: "client_error.rate_limited",
        status: 429,
        error
      });
      return withRequestId(publicRateLimitResponse(error), requestId);
    }
    logServerEvent({
      requestId,
      route: "/api/client-errors",
      operation: "client_error.rejected",
      status: 400,
      durationMs: Date.now() - startedAt,
      error
    });
    return safeMutationError(error, requestId, "The error report could not be accepted.");
  }
}
