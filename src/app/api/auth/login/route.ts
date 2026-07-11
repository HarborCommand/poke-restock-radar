import bcrypt from "bcryptjs";
import { authRuntimeConfig, createSessionToken, setSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const adminDummyPasswordHash = "$2b$12$w1Njzk8SIIBx56u6pmcwpONxNv2ODRfq/fGRFd7kd49r2pzUpkOmW";
const invalidLoginMessage = "Email or password did not match a private account.";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const input = loginSchema.parse(await readJson(request));
    const authConfig = authRuntimeConfig();
    if (!authConfig.authReady) {
      return privateJson(
        { error: "Authentication is not configured correctly. Ask the admin to verify AUTH_SECRET in production." },
        503
      );
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
        actorEmail: "anonymous-auth",
        action: "auth.login.failed",
        entityType: "USER",
        summary: "Failed private account login attempt."
      });
      return privateJson({ error: invalidLoginMessage }, 401);
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
      action: "auth.login.success",
      entityType: "USER",
      entityId: sessionUser.id,
      summary: "Private account signed in."
    });
    const response = privateJson({ user: sessionUser });
    setSessionCookie(response, createSessionToken(sessionUser));
    return response;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    if (error instanceof Error && error.message.includes("AUTH_SECRET")) {
      return privateJson({ error: "Authentication is temporarily unavailable." }, 503);
    }
    return withPrivateNoStore(badRequest(error));
  }
}
