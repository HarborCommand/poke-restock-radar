import { NextResponse } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { privateNoStoreHeaders, withRequestId } from "@/lib/http";
import { logSecurityEvent, requestCorrelationId } from "@/lib/observability";
import type { SessionUser } from "@/types/radar";

function forbidden(message: string, requestId: string) {
  return withRequestId(NextResponse.json({ error: message }, { status: 403, headers: privateNoStoreHeaders }), requestId);
}

export function authorizeAdminMutation(request: Request, user: SessionUser) {
  const requestId = requestCorrelationId(request);
  const route = "/api/radar/[mutation]";
  if (user.role !== "ADMIN") {
    logSecurityEvent({
      level: "warn",
      requestId,
      route,
      operation: "authorization.role_rejected",
      status: 403,
      metadata: { roleCategory: user.role }
    });
    return forbidden("Admin access required", requestId);
  }
  try {
    assertSameOriginRequest(request);
  } catch (error) {
    if (error instanceof AuthOriginError) {
      logSecurityEvent({
        level: "warn",
        requestId,
        route,
        operation: "authorization.origin_rejected",
        status: 403,
        error
      });
      return withRequestId(authOriginErrorResponse(), requestId);
    }
    throw error;
  }
  return null;
}
