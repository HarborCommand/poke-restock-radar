import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type PublicRateLimitAction =
  | "shipping_quote"
  | "checkout_creation"
  | "contact_message"
  | "order_status_lookup"
  | "invoice_request"
  | "cart_lookup"
  | "customer_login"
  | "customer_magic_link"
  | "customer_registration"
  | "customer_forgot_password"
  | "customer_reset_password"
  | "admin_login"
  | "admin_forgot_password"
  | "admin_reset_password"
  | "admin_invite_accept"
  | "admin_customer_lookup"
  | "client_error";

type PublicRateLimitScope = "client" | "email" | "order" | "cart" | "zip" | "token";

type PublicRateLimitRule = {
  rule: string;
  scope: PublicRateLimitScope;
  windowSeconds: number;
  maxAttempts: number;
  blockSeconds: number;
};

export type PublicRateLimitIdentifier = {
  scope: Exclude<PublicRateLimitScope, "client">;
  value?: string | null;
};

type PublicRateLimitRecord = {
  id: string;
  action: string;
  rule: string;
  scope: string;
  keyHash: string;
  windowStart: Date;
  windowSeconds: number;
  attemptCount: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  blockedUntil: Date | null;
};

const missingClientKey = "unknown-client";
const devFallbackRateLimitSecret = "local-dev-public-storefront-rate-limit-secret-change-before-sharing";
const publicRateLimitErrorMessage = "Too many requests. Please try again shortly.";
const publicRateLimitCleanupRetentionMs = 7 * 24 * 60 * 60 * 1000;

export const publicRateLimitRules: Record<PublicRateLimitAction, PublicRateLimitRule[]> = {
  shipping_quote: [
    { rule: "client_10m", scope: "client", windowSeconds: 10 * 60, maxAttempts: 30, blockSeconds: 10 * 60 },
    { rule: "cart_10m", scope: "cart", windowSeconds: 10 * 60, maxAttempts: 12, blockSeconds: 10 * 60 },
    { rule: "zip_10m", scope: "zip", windowSeconds: 10 * 60, maxAttempts: 20, blockSeconds: 10 * 60 }
  ],
  checkout_creation: [
    { rule: "client_10m", scope: "client", windowSeconds: 10 * 60, maxAttempts: 10, blockSeconds: 10 * 60 },
    { rule: "client_burst_1m", scope: "client", windowSeconds: 60, maxAttempts: 3, blockSeconds: 5 * 60 },
    { rule: "email_10m", scope: "email", windowSeconds: 10 * 60, maxAttempts: 5, blockSeconds: 10 * 60 }
  ],
  contact_message: [
    { rule: "client_1h", scope: "client", windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 60 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  order_status_lookup: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 10, blockSeconds: 15 * 60 },
    { rule: "order_15m", scope: "order", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 },
    { rule: "email_15m", scope: "email", windowSeconds: 15 * 60, maxAttempts: 10, blockSeconds: 15 * 60 }
  ],
  invoice_request: [
    { rule: "client_1h", scope: "client", windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 60 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  cart_lookup: [
    { rule: "client_10m", scope: "client", windowSeconds: 10 * 60, maxAttempts: 60, blockSeconds: 10 * 60 },
    { rule: "cart_10m", scope: "cart", windowSeconds: 10 * 60, maxAttempts: 30, blockSeconds: 10 * 60 }
  ],
  customer_login: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  customer_magic_link: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  customer_registration: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  customer_forgot_password: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  customer_reset_password: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 },
    { rule: "token_15m", scope: "token", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 }
  ],
  admin_login: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 8, blockSeconds: 15 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 }
  ],
  admin_forgot_password: [
    { rule: "client_1h", scope: "client", windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 3, blockSeconds: 60 * 60 }
  ],
  admin_reset_password: [
    { rule: "client_15m", scope: "client", windowSeconds: 15 * 60, maxAttempts: 8, blockSeconds: 15 * 60 },
    { rule: "token_15m", scope: "token", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 }
  ],
  admin_invite_accept: [
    { rule: "client_1h", scope: "client", windowSeconds: 60 * 60, maxAttempts: 8, blockSeconds: 30 * 60 },
    { rule: "email_1h", scope: "email", windowSeconds: 60 * 60, maxAttempts: 5, blockSeconds: 30 * 60 },
    { rule: "token_15m", scope: "token", windowSeconds: 15 * 60, maxAttempts: 5, blockSeconds: 15 * 60 }
  ],
  admin_customer_lookup: [
    { rule: "client_10m", scope: "client", windowSeconds: 10 * 60, maxAttempts: 120, blockSeconds: 10 * 60 },
    { rule: "email_10m", scope: "email", windowSeconds: 10 * 60, maxAttempts: 60, blockSeconds: 10 * 60 }
  ],
  client_error: [
    { rule: "client_10m", scope: "client", windowSeconds: 10 * 60, maxAttempts: 20, blockSeconds: 10 * 60 }
  ]
};

let testClock: (() => Date) | null = null;
let testStorageEnabled = false;
const testStore = new Map<string, PublicRateLimitRecord>();

export class PublicRateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(publicRateLimitErrorMessage);
    this.name = "PublicRateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function rateLimitSecret() {
  return envValue("RATE_LIMIT_SECRET") || envValue("AUTH_SECRET") || devFallbackRateLimitSecret;
}

function normalizeLimiterValue(scope: PublicRateLimitScope, value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim() || "";
  if (!trimmed) return "unknown";
  if (scope === "zip") return trimmed.replace(/\D/g, "").slice(0, 10) || "unknown";
  return trimmed.toLowerCase().slice(0, 512);
}

function hashLimiterKey(scope: PublicRateLimitScope, value: string | null | undefined) {
  return createHmac("sha256", rateLimitSecret())
    .update(`${scope}:${normalizeLimiterValue(scope, value)}`)
    .digest("hex");
}

function clientKeyFromRequest(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.replace(/\s+/g, " ").trim().slice(0, 160);
  return forwardedFor || vercelForwardedFor || cfIp || realIp || userAgent || missingClientKey;
}

function windowStartFor(now: Date, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

function retryAfterFor(record: Pick<PublicRateLimitRecord, "blockedUntil" | "windowStart" | "windowSeconds">, now: Date) {
  const blockedUntil = record.blockedUntil?.getTime() ?? 0;
  if (blockedUntil > now.getTime()) {
    return Math.ceil((blockedUntil - now.getTime()) / 1000);
  }
  const windowEndsAt = record.windowStart.getTime() + record.windowSeconds * 1000;
  return Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000));
}

function nowForRateLimit() {
  return testClock ? testClock() : new Date();
}

function identifierMap(identifiers: PublicRateLimitIdentifier[] | undefined) {
  const values = new Map<PublicRateLimitScope, string>();
  for (const identifier of identifiers ?? []) {
    if (!identifier.value) continue;
    values.set(identifier.scope, identifier.value);
  }
  return values;
}

function keyForRule(request: Request, rule: PublicRateLimitRule, identifiers: Map<PublicRateLimitScope, string>) {
  if (rule.scope === "client") return hashLimiterKey("client", clientKeyFromRequest(request));
  const value = identifiers.get(rule.scope);
  if (!value) return null;
  return hashLimiterKey(rule.scope, value);
}

function memoryKey(input: {
  action: PublicRateLimitAction;
  rule: PublicRateLimitRule;
  keyHash: string;
  windowStart: Date;
}) {
  return `${input.action}:${input.rule.rule}:${input.keyHash}:${input.windowStart.toISOString()}`;
}

async function findActiveRateLimitBlock(input: {
  action: PublicRateLimitAction;
  rule: PublicRateLimitRule;
  keyHash: string;
  now: Date;
}) {
  if (testStorageEnabled) {
    return (
      Array.from(testStore.values())
        .filter(
          (record) =>
            record.action === input.action &&
            record.rule === input.rule.rule &&
            record.keyHash === input.keyHash &&
            record.blockedUntil &&
            record.blockedUntil.getTime() > input.now.getTime()
        )
        .sort((a, b) => (b.blockedUntil?.getTime() ?? 0) - (a.blockedUntil?.getTime() ?? 0))[0] ?? null
    );
  }

  return prisma.publicRateLimit.findFirst({
    where: {
      action: input.action,
      rule: input.rule.rule,
      keyHash: input.keyHash,
      blockedUntil: { gt: input.now }
    },
    orderBy: { blockedUntil: "desc" }
  });
}

async function upsertRateLimitRecord(input: {
  action: PublicRateLimitAction;
  rule: PublicRateLimitRule;
  keyHash: string;
  now: Date;
  windowStart: Date;
}) {
  if (testStorageEnabled) {
    const key = memoryKey(input);
    const existing = testStore.get(key);
    if (existing) {
      const updated = { ...existing, attemptCount: existing.attemptCount + 1, lastAttemptAt: input.now };
      testStore.set(key, updated);
      return updated;
    }
    const created: PublicRateLimitRecord = {
      id: `test-${testStore.size + 1}`,
      action: input.action,
      rule: input.rule.rule,
      scope: input.rule.scope,
      keyHash: input.keyHash,
      windowStart: input.windowStart,
      windowSeconds: input.rule.windowSeconds,
      attemptCount: 1,
      firstAttemptAt: input.now,
      lastAttemptAt: input.now,
      blockedUntil: null
    };
    testStore.set(key, created);
    return created;
  }

  return prisma.publicRateLimit.upsert({
    where: {
      action_rule_keyHash_windowStart: {
        action: input.action,
        rule: input.rule.rule,
        keyHash: input.keyHash,
        windowStart: input.windowStart
      }
    },
    create: {
      action: input.action,
      rule: input.rule.rule,
      scope: input.rule.scope,
      keyHash: input.keyHash,
      windowStart: input.windowStart,
      windowSeconds: input.rule.windowSeconds,
      attemptCount: 1,
      firstAttemptAt: input.now,
      lastAttemptAt: input.now
    },
    update: {
      attemptCount: { increment: 1 },
      lastAttemptAt: input.now
    }
  });
}

async function blockRateLimitRecord(input: {
  action: PublicRateLimitAction;
  rule: PublicRateLimitRule;
  keyHash: string;
  windowStart: Date;
  blockedUntil: Date;
}) {
  if (testStorageEnabled) {
    const key = memoryKey(input);
    const existing = testStore.get(key);
    if (existing) testStore.set(key, { ...existing, blockedUntil: input.blockedUntil });
    return;
  }

  await prisma.publicRateLimit.update({
    where: {
      action_rule_keyHash_windowStart: {
        action: input.action,
        rule: input.rule.rule,
        keyHash: input.keyHash,
        windowStart: input.windowStart
      }
    },
    data: { blockedUntil: input.blockedUntil }
  });
}

function maybeCleanupOldBuckets(now: Date) {
  if (testStorageEnabled) {
    const cutoff = now.getTime() - publicRateLimitCleanupRetentionMs;
    for (const [key, record] of testStore.entries()) {
      if (record.windowStart.getTime() < cutoff) testStore.delete(key);
    }
    return;
  }
  if (Math.random() > 0.01) return;
  const cutoff = new Date(now.getTime() - publicRateLimitCleanupRetentionMs);
  void prisma.publicRateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } }).catch(() => {
    // Best-effort cleanup must never block a legitimate storefront request.
  });
}

export async function checkPublicRateLimit(input: {
  request: Request;
  action: PublicRateLimitAction;
  identifiers?: PublicRateLimitIdentifier[];
}) {
  const rules = publicRateLimitRules[input.action];
  const identifiers = identifierMap(input.identifiers);
  const now = nowForRateLimit();
  maybeCleanupOldBuckets(now);

  for (const rule of rules) {
    const keyHash = keyForRule(input.request, rule, identifiers);
    if (!keyHash) continue;

    const activeBlock = await findActiveRateLimitBlock({
      action: input.action,
      rule,
      keyHash,
      now
    });
    if (activeBlock?.blockedUntil && activeBlock.blockedUntil.getTime() > now.getTime()) {
      throw new PublicRateLimitExceededError(retryAfterFor(activeBlock, now));
    }

    const windowStart = windowStartFor(now, rule.windowSeconds);
    const record = await upsertRateLimitRecord({
      action: input.action,
      rule,
      keyHash,
      now,
      windowStart
    });

    if (record.blockedUntil && record.blockedUntil.getTime() > now.getTime()) {
      throw new PublicRateLimitExceededError(retryAfterFor(record, now));
    }

    if (record.attemptCount <= rule.maxAttempts) continue;

    const blockedUntil = new Date(now.getTime() + rule.blockSeconds * 1000);
    await blockRateLimitRecord({
      action: input.action,
      rule,
      keyHash,
      windowStart,
      blockedUntil
    });
    throw new PublicRateLimitExceededError(rule.blockSeconds);
  }
}

export function publicRateLimitResponse(error: PublicRateLimitExceededError) {
  return NextResponse.json(
    { error: publicRateLimitErrorMessage },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        "Retry-After": String(Math.max(1, error.retryAfterSeconds))
      }
    }
  );
}

export function publicRateLimitCartIdentifier(items: Array<{ id: string; quantity: number }>, extra?: Record<string, string | null | undefined>) {
  const cleanItems = items
    .map((item) => ({ id: String(item.id).trim(), quantity: Number(item.quantity) || 0 }))
    .filter((item) => item.id && item.quantity > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ items: cleanItems, ...(extra ?? {}) });
}

export function enablePublicRateLimitTestStorage(clock?: () => Date) {
  testStorageEnabled = true;
  testClock = clock ?? null;
  testStore.clear();
}

export function disablePublicRateLimitTestStorage() {
  testStorageEnabled = false;
  testClock = null;
  testStore.clear();
}

export function publicRateLimitTestRecords() {
  return Array.from(testStore.values()).map((record) => ({ ...record }));
}
