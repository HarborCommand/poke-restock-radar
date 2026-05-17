import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authRuntimeConfig, createSessionToken, setSessionCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, readJson } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await readJson(request));
    const authConfig = authRuntimeConfig();
    if (!authConfig.authReady) {
      return NextResponse.json(
        { error: "Authentication is not configured correctly. Ask the admin to verify AUTH_SECRET in production." },
        { status: 503 }
      );
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const matchingUsers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE lower("email") = ${normalizedEmail} LIMIT 1
    `;
    const user = matchingUsers[0]?.id
      ? await prisma.user.findUnique({ where: { id: matchingUsers[0].id } })
      : null;

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      await logAudit({
        actorEmail: normalizedEmail,
        action: "auth.login.failed",
        entityType: "USER",
        summary: `Failed login attempt for ${normalizedEmail}.`
      });
      return NextResponse.json(
        { error: "Email or password did not match a private account. Check the credentials or use password reset." },
        { status: 401 }
      );
    }

    if (user.disabledAt) {
      await logAudit({
        userId: user.id,
        actorEmail: user.email,
        action: "auth.login.disabled",
        entityType: "USER",
        entityId: user.id,
        summary: `Disabled account login blocked for ${user.email}.`
      });
      return NextResponse.json({ error: "This private account is disabled. Ask the admin to re-enable access." }, { status: 403 });
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
      summary: `${sessionUser.email} signed in.`
    });
    const response = NextResponse.json({ user: sessionUser });
    setSessionCookie(response, createSessionToken(sessionUser));
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("AUTH_SECRET")) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return badRequest(error);
  }
}
