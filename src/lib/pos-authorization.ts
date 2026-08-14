import { NextResponse } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { prisma } from "@/lib/db";
import { privateNoStoreHeaders, withRequestId } from "@/lib/http";
import { logSecurityEvent, requestCorrelationId } from "@/lib/observability";
import type { SessionUser } from "@/types/radar";

function forbidden(message: string, requestId: string) {
  return withRequestId(
    NextResponse.json({ error: message }, { status: 403, headers: privateNoStoreHeaders }),
    requestId
  );
}

export function hasPosRole(user: SessionUser) {
  const role = String(user.role);
  return role === "ADMIN" || role === "CASHIER";
}

export function authorizePosMutation(request: Request, user: SessionUser) {
  const requestId = requestCorrelationId(request);
  const role = String(user.role);

  if (!hasPosRole(user)) {
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

export async function resolvePosStoreUser(user: SessionUser): Promise<SessionUser> {
  if (String(user.role) !== "CASHIER") return user;

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", disabledAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canAddSightings: true,
      canAddComps: true,
      canRunChecks: true,
      canReceivePushAlerts: true,
      preferredZone: true,
      customZoneName: true,
      hideDistantStores: true,
      currentLatitude: true,
      currentLongitude: true,
      locationUpdatedAt: true,
      sessionVersion: true
    }
  });

  if (!admin) throw new Error("The store owner Admin account could not be found.");

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role as SessionUser["role"],
    canAddSightings: admin.canAddSightings,
    canAddComps: admin.canAddComps,
    canRunChecks: admin.canRunChecks,
    canReceivePushAlerts: admin.canReceivePushAlerts,
    preferredZone: admin.preferredZone as SessionUser["preferredZone"],
    customZoneName: admin.customZoneName,
    hideDistantStores: admin.hideDistantStores,
    currentLatitude: admin.currentLatitude,
    currentLongitude: admin.currentLongitude,
    locationUpdatedAt: admin.locationUpdatedAt?.toISOString() ?? null,
    sessionVersion: admin.sessionVersion
  };
}
