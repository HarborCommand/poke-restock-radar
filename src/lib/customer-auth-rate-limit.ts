import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { normalizeCustomerEmail } from "@/lib/customer-account-security";
import { privateNoStoreHeaders } from "@/lib/http";

export type CustomerAuthRateLimitAction =
  | "password_login"
  | "registration"
  | "magic_link_request"
  | "forgot_password_request"
  | "password_reset_submit"
  | "magic_link_verify";

type CustomerAuthRateLimitRule = {
  windowSeconds: number;
  maxAttempts: number;
  blockSeconds: number;
};

const devFallbackRateLimitSecret = "local-dev-customer-auth-rate-limit-secret-change-before-sharing";
const missingEmailHash = "none";
const missingClientHash = "unknown";

const customerAuthRateLimitRules: Record<CustomerAuthRateLimitAction, CustomerAuthRateLimitRule> = {
  password_login: { windowSeconds: 15 * 60, maxAttempts: 8, blockSeconds: 15 * 60 },
  registration: { windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
  magic_link_request: { windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
  forgot_password_request: { windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
  password_reset_submit: { windowSeconds: 15 * 60, maxAttempts: 8, blockSeconds: 15 * 60 },
  magic_link_verify: { windowSeconds: 15 * 60, maxAttempts: 10, blockSeconds: 15 * 60 }
};

export class CustomerAuthRateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many account attempts.");
    this.name = "CustomerAuthRateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CustomerAuthOriginError extends Error {
  constructor() {
    super("Invalid account request origin.");
    this.name = "CustomerAuthOriginError";
  }
}

export function customerAuthRateLimitingEnabled() {
  return customerAccountFeatureConfig().customerAuthRateLimitEnabled;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function hashLimiterKey(namespace: string, value: string | null | undefined) {
  const secret = envValue("AUTH_SECRET") || devFallbackRateLimitSecret;
  const cleanValue = value?.trim().toLowerCase() || "unknown";
  return createHmac("sha256", secret).update(`${namespace}:${cleanValue}`).digest("hex");
}

function clientKeyFromRequest(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.replace(/\s+/g, " ").trim().slice(0, 120);
  return forwardedFor || cfIp || realIp || userAgent || null;
}

function windowStartFor(now: Date, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export async function enforceCustomerAuthRateLimit(input: {
  request: Request;
  action: CustomerAuthRateLimitAction;
  email?: string | null;
}) {
  if (!customerAuthRateLimitingEnabled()) return;

  const rule = customerAuthRateLimitRules[input.action];
  const now = new Date();
  const normalizedEmail = normalizeCustomerEmail(input.email);
  const emailKeyHash = normalizedEmail ? hashLimiterKey("email", normalizedEmail) : missingEmailHash;
  const clientKey = clientKeyFromRequest(input.request);
  const clientKeyHash = clientKey ? hashLimiterKey("client", clientKey) : missingClientHash;
  const windowStart = windowStartFor(now, rule.windowSeconds);

  const record = await prisma.customerAuthRateLimit.upsert({
    where: {
      action_emailKeyHash_clientKeyHash_windowStart: {
        action: input.action,
        emailKeyHash,
        clientKeyHash,
        windowStart
      }
    },
    create: {
      action: input.action,
      emailKeyHash,
      clientKeyHash,
      windowStart,
      windowSeconds: rule.windowSeconds,
      attemptCount: 1,
      firstAttemptAt: now,
      lastAttemptAt: now
    },
    update: {
      attemptCount: { increment: 1 },
      lastAttemptAt: now
    }
  });

  if (record.blockedUntil && record.blockedUntil.getTime() > now.getTime()) {
    throw new CustomerAuthRateLimitExceededError(Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000));
  }

  if (record.attemptCount <= rule.maxAttempts) return;

  const blockedUntil = new Date(now.getTime() + rule.blockSeconds * 1000);
  await prisma.customerAuthRateLimit.update({
    where: { id: record.id },
    data: { blockedUntil }
  });
  throw new CustomerAuthRateLimitExceededError(rule.blockSeconds);
}

function configuredOrigins(request: Request) {
  const origins = new Set<string>();
  origins.add(new URL(request.url).origin);
  for (const value of [envValue("STORE_BASE_URL"), envValue("APP_URL")]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed optional config here; health reports env configuration separately.
    }
  }
  return origins;
}

export function assertCustomerSameOriginRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const origin = request.headers.get("origin");
  if (!origin) return;

  let requestOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new CustomerAuthOriginError();
  }

  if (!configuredOrigins(request).has(requestOrigin)) {
    throw new CustomerAuthOriginError();
  }
}

export function customerAuthRateLimitResponse(error: CustomerAuthRateLimitExceededError) {
  return NextResponse.json(
    {
      error: "Too many attempts. Please wait a few minutes and try again."
    },
    {
      status: 429,
      headers: {
        ...privateNoStoreHeaders,
        "Retry-After": String(Math.max(1, error.retryAfterSeconds))
      }
    }
  );
}

export function customerAuthOriginErrorResponse() {
  return NextResponse.json(
    { error: "This account request could not be verified. Refresh the page and try again." },
    {
      status: 403,
      headers: privateNoStoreHeaders
    }
  );
}
