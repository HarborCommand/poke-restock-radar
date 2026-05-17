import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { FriendInviteDTO, FriendUserDTO, Role, SessionUser, UserPermissions } from "@/types/radar";

const INVITE_DAYS = 7;

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  canAddSightings: true,
  canAddComps: true,
  canRunChecks: true,
  canReceivePushAlerts: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
  sessionVersion: true
} as const;

const inviteInclude = {
  createdBy: { select: { name: true, email: true } }
} as const;

type AccessUserRecord = {
  id: string;
  email: string;
  name: string;
  role: string;
  canAddSightings: boolean;
  canAddComps: boolean;
  canRunChecks: boolean;
  canReceivePushAlerts: boolean;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  sessionVersion: number;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3020";
}

function permissionsFrom(input: Partial<UserPermissions>): UserPermissions {
  return {
    canAddSightings: input.canAddSightings ?? true,
    canAddComps: input.canAddComps ?? false,
    canRunChecks: input.canRunChecks ?? false,
    canReceivePushAlerts: input.canReceivePushAlerts ?? true
  };
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  canAddSightings: boolean;
  canAddComps: boolean;
  canRunChecks: boolean;
  canReceivePushAlerts: boolean;
  sessionVersion: number;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    canAddSightings: user.canAddSightings,
    canAddComps: user.canAddComps,
    canRunChecks: user.canRunChecks,
    canReceivePushAlerts: user.canReceivePushAlerts,
    sessionVersion: user.sessionVersion
  };
}

export function userAccessToDTO(user: AccessUserRecord): FriendUserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    canAddSightings: user.canAddSightings,
    canAddComps: user.canAddComps,
    canRunChecks: user.canRunChecks,
    canReceivePushAlerts: user.canReceivePushAlerts,
    disabledAt: user.disabledAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    sessionVersion: user.sessionVersion
  };
}

export function inviteToDTO(
  invite: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    canAddSightings: boolean;
    canAddComps: boolean;
    canRunChecks: boolean;
    canReceivePushAlerts: boolean;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    createdBy?: { name: string; email: string } | null;
  },
  inviteUrl?: string
): FriendInviteDTO {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role as Role,
    canAddSightings: invite.canAddSightings,
    canAddComps: invite.canAddComps,
    canRunChecks: invite.canRunChecks,
    canReceivePushAlerts: invite.canReceivePushAlerts,
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    createdByName: invite.createdBy?.name ?? invite.createdBy?.email ?? null,
    ...(inviteUrl ? { inviteUrl } : {})
  };
}

export async function listAccessOverview() {
  const [users, invites, auditLogs] = await Promise.all([
    prisma.user.findMany({ select: userSelect, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    prisma.friendInvite.findMany({ include: inviteInclude, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 })
  ]);

  return {
    users: users.map(userAccessToDTO),
    friendInvites: invites.map((invite) => inviteToDTO(invite)),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      userId: log.userId,
      actorEmail: log.actorEmail,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      summary: log.summary,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    }))
  };
}

async function existingUserIdForEmail(email: string) {
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE lower("email") = ${email.toLowerCase()} LIMIT 1
  `;
  return matches[0]?.id ?? null;
}

export async function createFriendInvite(
  currentUser: SessionUser,
  input: {
    email: string;
    name?: string;
    canAddSightings?: boolean;
    canAddComps?: boolean;
    canRunChecks?: boolean;
    canReceivePushAlerts?: boolean;
  }
) {
  const email = input.email.trim().toLowerCase();
  if (await existingUserIdForEmail(email)) throw new Error("That email already has an account.");

  const permissions = permissionsFrom(input);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();

  await prisma.friendInvite.updateMany({
    where: { email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now }
  });

  const invite = await prisma.friendInvite.create({
    data: {
      email,
      name: input.name || null,
      tokenHash,
      role: "FRIEND",
      ...permissions,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      createdById: currentUser.id
    },
    include: inviteInclude
  });
  const inviteUrl = `${appUrl()}/?inviteToken=${encodeURIComponent(token)}`;
  await logAudit({
    user: currentUser,
    action: "invite.created",
    entityType: "USER",
    entityId: invite.id,
    summary: `Created friend invite for ${email}.`,
    metadata: permissions
  });
  return inviteToDTO(invite, inviteUrl);
}

export async function acceptFriendInvite(input: {
  token: string;
  email: string;
  name: string;
  password: string;
}) {
  const tokenHash = hashToken(input.token.trim());
  const invite = await prisma.friendInvite.findUnique({ where: { tokenHash } });
  const email = input.email.trim().toLowerCase();
  if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    throw new Error("Invite link is invalid or expired. Ask the admin for a fresh invite.");
  }
  if (invite.email.toLowerCase() !== email) {
    throw new Error("Invite email does not match. Use the email the admin invited.");
  }
  if (await existingUserIdForEmail(email)) throw new Error("That email already has an account.");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: input.name.trim() || invite.name || email,
        role: "FRIEND",
        passwordHash,
        canAddSightings: invite.canAddSightings,
        canAddComps: invite.canAddComps,
        canRunChecks: invite.canRunChecks,
        canReceivePushAlerts: invite.canReceivePushAlerts,
        passwordChangedAt: new Date()
      },
      select: userSelect
    });
    await tx.friendInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedById: created.id }
    });
    await tx.notificationSettings.create({
      data: {
        userId: created.id,
        inApp: true,
        email: false,
        sms: false,
        browserPush: false,
        emailTo: created.email,
        minimumPriority: "LOW"
      }
    });
    await tx.investmentSettings.create({
      data: { userId: created.id }
    });
    return created;
  });

  const sessionUser = toSessionUser(user);
  await logAudit({
    user: sessionUser,
    action: "invite.accepted",
    entityType: "USER",
    entityId: user.id,
    summary: `${user.email} accepted a friend invite.`
  });
  return sessionUser;
}

export async function updateUserAccess(
  currentUser: SessionUser,
  userId: string,
  input: Partial<UserPermissions> & { role?: Role; disabled?: boolean }
) {
  if (currentUser.id === userId && (input.disabled || input.role === "FRIEND")) {
    throw new Error("You cannot demote or disable your own admin account.");
  }
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!existing) throw new Error("User not found");

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      role: input.role ?? (existing.role as Role),
      canAddSightings: input.canAddSightings ?? existing.canAddSightings,
      canAddComps: input.canAddComps ?? existing.canAddComps,
      canRunChecks: input.canRunChecks ?? existing.canRunChecks,
      canReceivePushAlerts: input.canReceivePushAlerts ?? existing.canReceivePushAlerts,
      disabledAt: input.disabled === true ? new Date() : input.disabled === false ? null : existing.disabledAt,
      sessionVersion: input.disabled === true ? { increment: 1 } : undefined
    },
    select: userSelect
  });

  await logAudit({
    user: currentUser,
    action: "user.access.updated",
    entityType: "USER",
    entityId: user.id,
    summary: `Updated access for ${user.email}.`,
    metadata: input
  });
  return userAccessToDTO(user);
}

export async function revokeFriendInvite(currentUser: SessionUser, inviteId: string) {
  const invite = await prisma.friendInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
    include: inviteInclude
  });
  await logAudit({
    user: currentUser,
    action: "invite.revoked",
    entityType: "USER",
    entityId: invite.id,
    summary: `Revoked invite for ${invite.email}.`
  });
  return inviteToDTO(invite);
}
