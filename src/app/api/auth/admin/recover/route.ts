import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recoverySchema = z
  .object({
    email: z.string().trim().email(),
    password: z
      .string()
      .min(12, "Use at least 12 characters")
      .max(128, "Password must stay under 128 characters")
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[a-z]/, "Include at least one lowercase letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match"
  });

function secretMatches(configured: string, provided: string) {
  const configuredBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  return configuredBuffer.length === providedBuffer.length && timingSafeEqual(configuredBuffer, providedBuffer);
}

export async function POST(request: Request) {
  const configuredSecret = process.env.ADMIN_RECOVERY_SECRET?.trim();
  if (!configuredSecret) {
    return NextResponse.json({ error: "Admin recovery is not enabled." }, { status: 404 });
  }

  const providedSecret = request.headers.get("x-admin-recovery-secret")?.trim() || "";
  if (!secretMatches(configuredSecret, providedSecret)) {
    await logAudit({
      actorEmail: "admin-recovery",
      action: "auth.admin_recovery.denied",
      entityType: "USER",
      summary: "Admin recovery request denied because the recovery secret did not match."
    });
    return NextResponse.json({ error: "Recovery secret was not accepted." }, { status: 403 });
  }

  try {
    const input = recoverySchema.parse(await readJson(request));
    const email = input.email.trim().toLowerCase();
    const now = new Date();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const existingUsers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE lower("email") = ${email} LIMIT 1
    `;
    const adminUsers = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" }
    });

    const targetId = existingUsers[0]?.id ?? (adminUsers.length === 1 ? adminUsers[0].id : null);
    if (!targetId && adminUsers.length > 1) {
      throw new Error("Multiple Admin users exist. Reset a specific existing Admin email instead.");
    }

    const user = targetId
      ? await prisma.user.update({
          where: { id: targetId },
          data: {
            email,
            name: "GameDayGrabs Admin",
            role: "ADMIN",
            passwordHash,
            passwordChangedAt: now,
            disabledAt: null,
            sessionVersion: { increment: 1 },
            canAddSightings: true,
            canAddComps: true,
            canRunChecks: true,
            canReceivePushAlerts: true
          },
          select: { id: true, email: true }
        })
      : await prisma.user.create({
          data: {
            email,
            name: "GameDayGrabs Admin",
            role: "ADMIN",
            passwordHash,
            passwordChangedAt: now,
            canAddSightings: true,
            canAddComps: true,
            canRunChecks: true,
            canReceivePushAlerts: true
          },
          select: { id: true, email: true }
        });

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await logAudit({
      actorEmail: "admin-recovery",
      action: "auth.admin_recovery.completed",
      entityType: "USER",
      entityId: user.id,
      summary: `Admin recovery completed for ${user.email}. Existing sessions were invalidated.`
    });

    return ok({ ok: true, email: user.email, sessionsInvalidated: true });
  } catch (error) {
    return badRequest(error);
  }
}
