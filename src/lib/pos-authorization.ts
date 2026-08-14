import { NextResponse } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { privateNoStoreHeaders, withRequestId } from "@/lib/http";
import { logSecurityEvent, requestCorrelationId } from "@/lib/observability";
import type { SessionUser } from "@/types/radar";

function forbidden(message: string, requestId: string) {
  return withRequestId(
    NextResponse.json({ error: message }, { status: 403, headers: privateNoStoreHeaders }),
    requestId
  );
}

export function authorizePosMutation(request: Request, user: SessionUser) {
  const requestId = requestCorrelationId(request);
  const role = String(user.role);

  if (role !== "ADMIN" && role !== "CASHIER") {
    logSecurityEvent({
      level: "warn",
      requestId,
      route: "/api/radar/pos/[mutation]",
      operation: "authorization.pos_role_rejected",
      status: 403,
      metadata: { roleCategory: role }
    });
    return forbidden("POS access required", requestId);
  }

  try {
    assertSameOriginRequest(request);
  } catch (error) {
    if (error instanceof AuthOriginError) {
      logSecurityEvent({
        level: "warn",
        requestId,
        route: "/api/radar/pos/[mutation]",
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
