import { NextResponse, type NextRequest } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const adminSessionCookieNames = ["__Host-poke_radar_session", "poke_radar_session"];

// These routes authenticate server-to-server callers with dedicated job secrets.
const signedJobPaths = new Set([
  "/api/radar/monitor/cron",
  "/api/radar/storefront/reservations/expire"
]);

export function proxy(request: NextRequest) {
  if (!mutationMethods.has(request.method.toUpperCase()) || signedJobPaths.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  if (!adminSessionCookieNames.some((name) => request.cookies.has(name))) return NextResponse.next();

  try {
    assertSameOriginRequest(request);
    return NextResponse.next();
  } catch (error) {
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    throw error;
  }
}

export const config = {
  matcher: "/api/radar/:path*"
};
