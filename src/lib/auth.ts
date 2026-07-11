import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Role, SessionUser, UserPermissions } from "@/types/radar";

const COOKIE_NAME = "poke_radar_session";
const HOST_COOKIE_NAME = "__Host-poke_radar_session";
const SESSION_DAYS = 14;
const FALLBACK_SECRET = "local-dev-secret-change-before-sharing-poke-restock-radar";
const defaultFriendPermissions: UserPermissions = {
  canAddSightings: true,
  canAddComps: false,
  canRunChecks: false,
  canReceivePushAlerts: true
};

type TokenPayload = {
  userId: string;
  sessionVersion?: number;
  iat?: number;
  jti?: string;
  exp: number;
};

export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? HOST_COOKIE_NAME : COOKIE_NAME;
}

export function sessionCookieNames() {
  const names = [sessionCookieName(), COOKIE_NAME];
  return Array.from(new Set(names));
}

export function authRuntimeConfig() {
  const configuredSecret = process.env.AUTH_SECRET?.trim() || null;
  const isProduction = process.env.NODE_ENV === "production";
  const authSecretConfigured = Boolean(configuredSecret);
  const authSecretStrong =
    Boolean(configuredSecret) &&
    configuredSecret!.length >= 32 &&
    configuredSecret !== FALLBACK_SECRET &&
    !configuredSecret!.toLowerCase().includes("replace-with");
  return {
    authSecretConfigured,
    authSecretStrong,
    authReady: !isProduction || authSecretStrong,
    sessionCookieName: sessionCookieName(),
    legacyCookieName: COOKIE_NAME,
    secureCookie: isProduction,
    sameSite: "lax" as const,
    sessionDays: SESSION_DAYS
  };
}

function authSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!secret || !authRuntimeConfig().authSecretStrong)) {
    throw new Error("AUTH_SECRET is not configured with a strong production value.");
  }
  return secret || FALLBACK_SECRET;
}

function encode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function decode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string) {
  return createHmac("sha256", authSecret()).update(data).digest("base64url");
}

export function createSessionToken(user: SessionUser) {
  const now = Date.now();
  const payload: TokenPayload = {
    userId: user.id,
    sessionVersion: user.sessionVersion ?? 0,
    iat: now,
    jti: randomBytes(16).toString("base64url"),
    exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(decode(body)) as TokenPayload;
    const now = Date.now();
    const maxLifetimeMs = SESSION_DAYS * 24 * 60 * 60 * 1000 + 5 * 60 * 1000;
    if (
      !payload.userId ||
      !payload.exp ||
      payload.exp < now ||
      payload.exp > now + maxLifetimeMs ||
      Boolean(payload.iat) !== Boolean(payload.jti) ||
      (payload.iat !== undefined && (payload.iat > now + 60_000 || payload.exp - payload.iat > maxLifetimeMs))
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = sessionCookieNames()
    .map((name) => cookieStore.get(name)?.value)
    .find(Boolean);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
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
      disabledAt: true,
      sessionVersion: true
    }
  });

  if (!user) return null;
  if (user.disabledAt) return null;
  if ((payload.sessionVersion ?? 0) !== user.sessionVersion) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    canAddSightings: user.canAddSightings ?? defaultFriendPermissions.canAddSightings,
    canAddComps: user.canAddComps ?? defaultFriendPermissions.canAddComps,
    canRunChecks: user.canRunChecks ?? defaultFriendPermissions.canRunChecks,
    canReceivePushAlerts: user.canReceivePushAlerts ?? defaultFriendPermissions.canReceivePushAlerts,
    preferredZone: user.preferredZone as SessionUser["preferredZone"],
    customZoneName: user.customZoneName,
    hideDistantStores: user.hideDistantStores,
    currentLatitude: user.currentLatitude,
    currentLongitude: user.currentLongitude,
    locationUpdatedAt: user.locationUpdatedAt?.toISOString() ?? null,
    sessionVersion: user.sessionVersion
  };
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  return { user, response: null };
}

export function requireAdmin(user: SessionUser) {
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

export type PermissionKey = keyof UserPermissions;

export function hasPermission(user: SessionUser, permission: PermissionKey) {
  return user.role === "ADMIN" || Boolean(user[permission]);
}

export function requirePermission(user: SessionUser, permission: PermissionKey, label: string) {
  if (!hasPermission(user, permission)) {
    return NextResponse.json({ error: `${label} permission required` }, { status: 403 });
  }
  return null;
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    priority: "high"
  });
}

export function clearSessionCookie(response: NextResponse) {
  for (const name of sessionCookieNames()) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
      priority: "high"
    });
  }
}
