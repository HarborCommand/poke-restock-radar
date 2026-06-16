import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendEmailViaProvider } from "@/lib/email-provider";
import type { SessionUser } from "@/types/radar";

const RESET_TOKEN_MINUTES = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3020";
}

async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const result = await sendEmailViaProvider({
    to: email,
    subject: "Poke Restock Radar password reset",
    text: [
      "A password reset was requested for your private Poke Restock Radar account.",
      "",
      `Open this secure reset link within ${RESET_TOKEN_MINUTES} minutes:`,
      resetUrl,
      "",
      "If you did not request this, ignore this email. No checkout or retailer account action is connected to this app."
    ].join("\n")
  });
  return result.status === "sent";
}

export async function requestPasswordReset(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE lower("email") = ${email} LIMIT 1
  `;
  const userId = ids[0]?.id;
  if (!userId) {
    return { emailSent: false, expiresInMinutes: RESET_TOKEN_MINUTES };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return { emailSent: false, expiresInMinutes: RESET_TOKEN_MINUTES };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt
    }
  });

  const resetUrl = `${appUrl()}/?resetToken=${encodeURIComponent(token)}`;
  const emailSent = await sendPasswordResetEmail(user.email, resetUrl);
  return { emailSent, expiresInMinutes: RESET_TOKEN_MINUTES };
}

export async function resetPasswordWithToken(token: string, password: string) {
  const tokenHash = hashToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true } } }
  });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    throw new Error("Reset link is invalid or expired. Request a new password reset.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        sessionVersion: { increment: 1 }
      }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: now }
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
        id: { not: resetToken.id }
      }
    })
  ]);
  return { ok: true };
}

export async function resetAdminPassword(currentUser: SessionUser, currentPassword: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: currentUser.id } });
  if (!user || user.role !== "ADMIN") throw new Error("Admin access required");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      sessionVersion: { increment: 1 }
    },
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
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role as SessionUser["role"],
    canAddSightings: updated.canAddSightings,
    canAddComps: updated.canAddComps,
    canRunChecks: updated.canRunChecks,
    canReceivePushAlerts: updated.canReceivePushAlerts,
    sessionVersion: updated.sessionVersion
  };
}

export async function updateAdminLoginEmail(currentUser: SessionUser, currentPassword: string, emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { id: currentUser.id } });
  if (!user || user.role !== "ADMIN") throw new Error("Admin access required");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }

  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE lower("email") = ${email} AND "id" <> ${user.id} LIMIT 1
  `;
  if (matches.length) {
    throw new Error("That login email is already used by another private account.");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { email },
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

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role as SessionUser["role"],
    canAddSightings: updated.canAddSightings,
    canAddComps: updated.canAddComps,
    canRunChecks: updated.canRunChecks,
    canReceivePushAlerts: updated.canReceivePushAlerts,
    preferredZone: updated.preferredZone as SessionUser["preferredZone"],
    customZoneName: updated.customZoneName,
    hideDistantStores: updated.hideDistantStores,
    currentLatitude: updated.currentLatitude,
    currentLongitude: updated.currentLongitude,
    locationUpdatedAt: updated.locationUpdatedAt?.toISOString() ?? null,
    sessionVersion: updated.sessionVersion
  };
}
