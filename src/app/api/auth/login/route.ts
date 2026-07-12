import bcrypt from "bcryptjs";
import { authRuntimeConfig, createSessionToken, setSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { privateJson, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { logSecurityEvent, requestCorrelationId, safeEntityRef } from "@/lib/observability";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const adminDummyPasswordHash = "$2b$12$w1Njzk8SIIBx56u6pmcwpONxNv2ODRfq/fGRFd7kd49r2pzUpkOmW";
const invalidLoginMessage = "Email or password did not match a private account.";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  try {
    assertSameOriginRequest(request);
    const input = loginSchema.parse(await readJson(request));
    const authConfig = authRuntimeConfig();
    if (!authConfig.authReady) {
      return withRequestId(privateJson(
        { error: "Authentication is temporarily unavailable." },
        503
      ), requestId);
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    await checkPublicRateLimit({
      request,
      action: "admin_login",
      identifiers: [{ scope: "email", value: normalizedEmail }]
    });
    const matchingUsers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE lower("email") = ${normalizedEmail} LIMIT 1
    `;
    const user = matchingUsers[0]?.id
      ? await prisma.user.findUnique({ where: { id: matchingUsers[0].id } })
      : null;

    const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? adminDummyPasswordHash);
    if (!user || !passwordMatches || user.disabledAt) {
      await logAudit({
        requestId,
        actorEmail: "anonymous-auth",
        action: "auth.login.failed",
        entityType: "USER",
        summary: "Failed private account login attempt."
      });
      logSecurityEvent({
        level: "warn",
        requestId,
        route: "/api/auth/login",
        operation: "auth.login.failed",
        status: 401,
        durationMs: Date.now() - startedAt
      });
      return withRequestId(privateJson({ error: invalidLoginMessage }, 401), requestId);
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        canAddSightings: true,
        canAddComps: true,
        canRunChecks: true,
        canReceivePushAlerts: true,
        sessionVersion: true
      }
    });
    const sessionUser = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role as Role,
      canAddSightings: updatedUser.canAddSightings,
      canAddComps: updatedUser.canAddComps,
      canRunChecks: updatedUser.canRunChecks,
      canReceivePushAlerts: updatedUser.canReceivePushAlerts,
      sessionVersion: updatedUser.sessionVersion
    };
    await logAudit({
      user: sessionUser,
      requestId,
      action: "auth.login.success",
      entityType: "USER",
      entityId: sessionUser.id,
      summary: "Private account signed in."
    });
    logSecurityEvent({
      requestId,
      route: "/api/auth/login",
      operation: "auth.login.succeeded",
      status: 200,
      durationMs: Date.now() - startedAt,
      entityType: "USER",
      entityRef: safeEntityRef(sessionUser.id)
    });
    const response = privateJson({ user: sessionUser });
    setSessionCookie(response, createSessionToken(sessionUser));
    return withRequestId(response, requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) {
      logSecurityEvent({
        level: "warn",
        requestId,
        route: "/api/auth/login",
        operation: "auth.login.rate_limited",
        status: 429,
        durationMs: Date.now() - startedAt,
        error
      });
      return withRequestId(publicRateLimitResponse(error), requestId);
    }
    if (error instanceof AuthOriginError) {
      logSecurityEvent({
        level: "warn",
        requestId,
        route: "/api/auth/login",
        operation: "auth.login.origin_rejected",
        status: 403,
        durationMs: Date.now() - startedAt,
        error
      });
      return withRequestId(authOriginErrorResponse(), requestId);
    }
    if (error instanceof Error && error.message.includes("AUTH_SECRET")) {
      logSecurityEvent({
        requestId,
        route: "/api/auth/login",
        operation: "auth.login.configuration_error",
        status: 503,
        durationMs: Date.now() - startedAt,
        error
      });
      return withRequestId(privateJson({ error: "Authentication is temporarily unavailable." }, 503), requestId);
    }
    logSecurityEvent({
      requestId,
      route: "/api/auth/login",
      operation: "auth.login.rejected",
      status: 400,
      durationMs: Date.now() - startedAt,
      error
    });
    return withPrivateNoStore(safeMutationError(error, requestId, invalidLoginMessage));
  }
}
