import { NextResponse, type NextRequest } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const adminSessionCookieNames = ["__Host-poke_radar_session", "poke_radar_session"];

// These routes authenticate server-to-server callers with dedicated job secrets.
const signedJobPaths = new Set([
  "/api/radar/monitor/cron",
  "/api/radar/storefront/reservations/expire"
]);

export function proxy(request: NextRequest) {
  const requestId = requestCorrelationId(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const continueRequest = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  };

  if (
    !request.nextUrl.pathname.startsWith("/api/radar/") ||
    !mutationMethods.has(request.method.toUpperCase()) ||
    signedJobPaths.has(request.nextUrl.pathname)
  ) {
    return continueRequest();
  }
  if (!adminSessionCookieNames.some((name) => request.cookies.has(name))) return continueRequest();

  try {
    assertSameOriginRequest(request);
    return continueRequest();
  } catch (error) {
    if (error instanceof AuthOriginError) {
      logServerEvent({
        level: "warn",
        requestId,
        route: "/api/radar/[mutation]",
        operation: "authorization.origin_rejected",
        status: 403,
        error
      });
      const response = authOriginErrorResponse();
      response.headers.set("x-request-id", requestId);
      return response;
    }
    throw error;
  }
}

export const config = {
  matcher: "/api/:path*"
};
