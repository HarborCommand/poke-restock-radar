import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailViaProvider, type EmailSendResult } from "@/lib/email-provider";
import { authRuntimeConfig } from "@/lib/auth";
import { safeAuthBaseUrl } from "@/lib/auth-origin";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import {
  customerVisibleOrderWhere,
  customerVisiblePosSaleWhere,
  normalizeCustomerEmail,
  verifiedCustomerIdentity
} from "@/lib/customer-account-security";
import {
  customerSessionAbsoluteExpiresAt,
  resolveCustomerSessionTimeout,
  shouldTouchCustomerSessionActivity,
  type CustomerSessionTimeoutReason
} from "@/lib/customer-session-timeouts";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

const customerSessionCookie = "gdg_customer_session";
const hostCustomerSessionCookie = "__Host-gdg_customer_session";
const customerSessionDays = 30;
const magicLinkMinutes = 20;
const passwordResetMinutes = 30;
const customerPasswordMinLength = 8;
const customerPasswordMaxLength = 128;
const customerDummyPasswordHash = "$2b$12$w1Njzk8SIIBx56u6pmcwpONxNv2ODRfq/fGRFd7kd49r2pzUpkOmW";
const devFallbackSecret = "local-dev-customer-account-secret-change-before-sharing";

class CustomerOneTimeTokenUnavailableError extends Error {}

type CustomerSessionPayload = {
  customerAccountId: string;
  email: string;
  iat?: number;
  jti?: string;
  exp: number;
};

export type CustomerSessionTimeoutMetadata = {
  enabled: boolean;
  idleExpiresAt: string | null;
  absoluteExpiresAt: string | null;
  warningSeconds: number;
  activityTouchIntervalSeconds: number;
  serverNow: string;
  expiredReason: Exclude<CustomerSessionTimeoutReason, "active"> | null;
};

export type CurrentCustomerAccountSessionStatus = {
  account: CurrentCustomerAccount | null;
  timeout: CustomerSessionTimeoutMetadata;
  shouldClearCookie: boolean;
};

export type CurrentCustomerAccount = {
  id: string;
  email: string;
  normalizedEmail: string | null;
  displayName: string | null;
  phone: string | null;
  status: string;
  sessionRevokedBefore: Date | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  highestAcknowledgedRewardTier: number;
  createdAt: Date;
  rewardBalance: {
    availablePoints: number;
    lifetimeEarnedPoints: number;
    pendingPoints: number;
    updatedAt: Date;
  } | null;
  savedAddresses: Array<{
    id: string;
    name: string | null;
    street1: string;
    street2: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
    isDefault: boolean;
    createdAt: Date;
  }>;
};

export type CustomerAccountSecuritySession = {
  ref: string;
  current: boolean;
  deviceSummary: string;
  createdAt: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
  activeLabel: string;
  expirationLabel: string;
  expired: boolean;
};

export type CustomerPurchaseSourceType = "online" | "pos" | "local";

export type CustomerAccountOrderHistoryItem = {
  orderNumber: string;
  detailKey: string;
  displayReference: string;
  sourceType: CustomerPurchaseSourceType;
  sourceLabel: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  fulfillmentMethod: "shipping" | "local_pickup" | "in_store";
  itemCount: number;
  totalPaid: number;
  shippingCharged: number;
  shippingMethodLabel: string | null;
  pickupStatus: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  refundStatus: string | null;
  refundedAmount: number;
  canceledAt: string | null;
  refundedAt: string | null;
  rewardsEarned: number | null;
  receiptAvailable: boolean;
  orderDetailAvailable: boolean;
  items: Array<{ title: string; quantity: number; imageUrl: string | null }>;
};

export type CustomerAccountOrderDetail = Omit<CustomerAccountOrderHistoryItem, "items"> & {
  subtotal: number;
  tax: number | null;
  refundedTax: number | null;
  discountTotal: number;
  paymentMethodLabel: string | null;
  items: Array<{
    title: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    imageUrl: string | null;
  }>;
  shippingCarrier: string | null;
  shippingService: string | null;
  supportEmail: string;
};

type CustomerAccountEmailStatus = {
  status: EmailSendResult["status"] | "skipped";
  provider: EmailSendResult["provider"];
  expiresAt: Date | null;
};

export type CustomerPasswordLoginResult =
  | { ok: true; account: { id: string; email: string } }
  | { ok: false; reason: "disabled" | "invalid" | "unverified"; verificationEmail?: CustomerAccountEmailStatus };

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function customerAccountsEnabled() {
  return customerAccountFeatureConfig().customerAccountsEnabled;
}

export function customerSessionTimeoutsEnabled() {
  return customerAccountFeatureConfig().customerSessionTimeoutsEnabled;
}

export function customerSecurityCenterEnabled() {
  const config = customerAccountFeatureConfig();
  return config.customerAccountsEnabled && config.customerSecurityCenterEnabled;
}

export function customerLoginAlertsEnabled() {
  const config = customerAccountFeatureConfig();
  return config.customerAccountsEnabled && config.customerLoginAlertsEnabled;
}

export function customerSessionCookieName() {
  return process.env.NODE_ENV === "production" ? hostCustomerSessionCookie : customerSessionCookie;
}

function customerSessionCookieNames() {
  return Array.from(new Set([customerSessionCookieName(), customerSessionCookie]));
}

function customerAccountSecret() {
  const configuredSecret = envValue("AUTH_SECRET");
  const authConfig = authRuntimeConfig();
  if (process.env.NODE_ENV === "production" && !authConfig.authReady) {
    throw new Error("Customer account sessions require a strong AUTH_SECRET in production.");
  }
  return configuredSecret || devFallbackSecret;
}

function encode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function decode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signCustomerSession(body: string) {
  return createHmac("sha256", customerAccountSecret()).update(body).digest("base64url");
}

function customerSessionMaxAgeSeconds() {
  const config = customerAccountFeatureConfig();
  if (!config.customerSessionTimeoutsEnabled) return customerSessionDays * 24 * 60 * 60;
  return Math.max(1, config.customerSessionAbsoluteTimeoutHours) * 60 * 60;
}

function customerSessionTrackingEnabled(config = customerAccountFeatureConfig()) {
  return (
    config.customerSessionTimeoutsEnabled ||
    config.customerSecurityCenterEnabled ||
    config.customerLoginAlertsEnabled
  );
}

function createCustomerSessionToken(account: { id: string; email: string }, absoluteExpiresAt?: Date) {
  const now = Date.now();
  const payload: CustomerSessionPayload = {
    customerAccountId: account.id,
    email: normalizeCustomerAccountEmail(account.email) ?? account.email,
    iat: now,
    jti: randomBytes(16).toString("base64url"),
    exp: absoluteExpiresAt?.getTime() ?? now + customerSessionDays * 24 * 60 * 60 * 1000
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${signCustomerSession(body)}`;
}

function verifyCustomerSessionToken(token: string, options: { ignoreExpiration?: boolean } = {}): CustomerSessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = signCustomerSession(body);
  } catch {
    return null;
  }
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(decode(body)) as CustomerSessionPayload;
    if (!payload.customerAccountId || !payload.email || !payload.exp) return null;
    if (Boolean(payload.iat) !== Boolean(payload.jti)) return null;
    if (payload.iat !== undefined && (payload.iat > Date.now() + 60_000 || payload.exp <= payload.iat)) return null;
    if (!options.ignoreExpiration && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeCustomerAccountEmail(value: string | null | undefined) {
  return normalizeCustomerEmail(value);
}

export { normalizeCustomerEmail };

const customerAccountLookupSelect = {
  id: true,
  email: true,
  normalizedEmail: true,
  displayName: true,
  status: true,
  passwordHash: true,
  sessionRevokedBefore: true,
  emailVerifiedAt: true
} satisfies Prisma.CustomerAccountSelect;

type CustomerAccountLookup = Prisma.CustomerAccountGetPayload<{ select: typeof customerAccountLookupSelect }>;
type CustomerAccountLookupClient = Prisma.TransactionClient | typeof prisma;

export class CustomerAccountIdentityConflictError extends Error {
  constructor() {
    super("Customer account needs support review.");
    this.name = "CustomerAccountIdentityConflictError";
  }
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function customerAccountIdsForNormalizedEmail(client: CustomerAccountLookupClient, normalizedEmail: string) {
  return client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CustomerAccount"
    WHERE lower(trim("email")) = ${normalizedEmail}
       OR "normalizedEmail" = ${normalizedEmail}
    LIMIT 3
  `;
}

async function touchCustomerAccountNormalizedEmail(
  client: CustomerAccountLookupClient,
  account: CustomerAccountLookup,
  normalizedEmail: string
) {
  if (account.normalizedEmail === normalizedEmail) return account;
  return client.customerAccount.update({
    where: { id: account.id },
    data: { normalizedEmail },
    select: customerAccountLookupSelect
  });
}

export async function findCustomerAccountByNormalizedEmail(
  inputEmail: string | null | undefined,
  client: CustomerAccountLookupClient = prisma
): Promise<CustomerAccountLookup | null> {
  const normalizedEmail = normalizeCustomerEmail(inputEmail);
  if (!normalizedEmail) return null;

  const rows = await customerAccountIdsForNormalizedEmail(client, normalizedEmail);
  const ids = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (ids.length > 1) throw new CustomerAccountIdentityConflictError();
  if (ids.length === 0) return null;

  const account = await client.customerAccount.findUnique({
    where: { id: ids[0] },
    select: customerAccountLookupSelect
  });
  return account ? touchCustomerAccountNormalizedEmail(client, account, normalizedEmail) : null;
}

export async function findOrCreateCustomerAccountByNormalizedEmail(
  inputEmail: string | null | undefined,
  client: CustomerAccountLookupClient = prisma
): Promise<CustomerAccountLookup | null> {
  const normalizedEmail = normalizeCustomerEmail(inputEmail);
  if (!normalizedEmail) return null;

  const existing = await findCustomerAccountByNormalizedEmail(normalizedEmail, client);
  if (existing) return existing;

  try {
    return await client.customerAccount.create({
      data: {
        email: normalizedEmail,
        normalizedEmail,
        status: "active"
      },
      select: customerAccountLookupSelect
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return findCustomerAccountByNormalizedEmail(normalizedEmail, client);
    }
    throw error;
  }
}

export function hashCustomerMagicLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashCustomerPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashCustomerSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function customerPasswordMeetsPolicy(password: string) {
  return password.length >= customerPasswordMinLength && password.length <= customerPasswordMaxLength;
}

function assertCustomerPassword(password: string, confirmPassword?: string) {
  if (password.length > customerPasswordMaxLength) {
    throw new Error(`Password must be ${customerPasswordMaxLength} characters or fewer.`);
  }
  if (password.length < customerPasswordMinLength) {
    throw new Error(`Password must be at least ${customerPasswordMinLength} characters.`);
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }
}

async function hashCustomerPassword(password: string) {
  return bcrypt.hash(password, 12);
}

function safeBaseUrl(requestUrl?: string | null) {
  return safeAuthBaseUrl(requestUrl, "store");
}

function customerMagicLinkText(link: string) {
  return [
    "Sign in to your GameDayGrabs customer account.",
    "",
    `Use this secure link to access your optional account: ${link}`,
    "",
    `This link expires in ${magicLinkMinutes} minutes. You can still checkout as a guest at any time.`,
    "",
    `Questions? Contact ${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}.`
  ].join("\n");
}

function customerPasswordResetText(link: string) {
  return [
    "Reset your GameDayGrabs customer account password.",
    "",
    `Use this secure link to choose a new password: ${link}`,
    "",
    `This link expires in ${passwordResetMinutes} minutes and can only be used once.`,
    "",
    "If you did not request this, you can ignore this email. Guest checkout remains available.",
    "",
    `Questions? Contact ${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}.`
  ].join("\n");
}

export function customerLoginAlertText(input: {
  accountUrl: string;
  deviceSummary: string;
  createdAt: Date;
}) {
  return [
    "A new sign-in was detected for your GameDayGrabs customer account.",
    "",
    `Time: ${input.createdAt.toISOString()}`,
    `Device: ${input.deviceSummary}`,
    "",
    `If this was you, no action is needed. To review your account, visit ${input.accountUrl}.`,
    "",
    `Questions? Contact ${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}.`
  ].join("\n");
}

export async function requestCustomerMagicLink(input: {
  email: string;
  requestUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ status: EmailSendResult["status"]; provider: EmailSendResult["provider"]; expiresAt: Date | null }> {
  if (!customerAccountsEnabled()) return { status: "not_configured", provider: "none", expiresAt: null };
  const email = normalizeCustomerAccountEmail(input.email);
  if (!email) throw new Error("Enter a valid email address.");

  let account: CustomerAccountLookup | null;
  try {
    account = await findOrCreateCustomerAccountByNormalizedEmail(email);
  } catch (error) {
    if (error instanceof CustomerAccountIdentityConflictError) return { status: "failed", provider: "none", expiresAt: null };
    throw error;
  }
  if (!account) return { status: "failed", provider: "none", expiresAt: null };
  if (account.status !== "active") return { status: "failed", provider: "none", expiresAt: null };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashCustomerMagicLinkToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + magicLinkMinutes * 60 * 1000);
  await prisma.$transaction([
    prisma.customerMagicLinkToken.updateMany({
      where: { customerAccountId: account.id, usedAt: null },
      data: { usedAt: now }
    }),
    prisma.customerMagicLinkToken.create({
      data: {
        customerAccountId: account.id,
        email,
        tokenHash,
        expiresAt
      }
    })
  ]);

  const link = `${safeBaseUrl(input.requestUrl)}/api/account/magic-link/verify?token=${encodeURIComponent(token)}`;
  const result = await sendEmailViaProvider(
    {
      to: email,
      subject: "Your GameDayGrabs account login link",
      text: customerMagicLinkText(link),
      headers: {
        "X-Entity-Ref-ID": `customer-account:${account.id}:magic-link`,
        "X-GDD-Notification-Type": "customer_account_magic_link"
      },
      tags: [
        { name: "notificationType", value: "customer_account_magic_link" },
        { name: "environment", value: process.env.NODE_ENV || "development" }
      ]
    },
    {
      fetchImpl: input.fetchImpl,
      idempotencyKey: `customer-account-magic-link:${tokenHash}`
    }
  );
  return { status: result.status, provider: result.provider, expiresAt };
}

export async function registerCustomerAccountWithPassword(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string | null;
  requestUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CustomerAccountEmailStatus> {
  if (!customerAccountsEnabled()) return { status: "not_configured", provider: "none", expiresAt: null };
  const email = normalizeCustomerAccountEmail(input.email);
  if (!email) throw new Error("Enter a valid email address.");
  assertCustomerPassword(input.password, input.confirmPassword);

  const existingAccount = await findCustomerAccountByNormalizedEmail(email);
  const passwordHash = await hashCustomerPassword(input.password);
  const passwordSetAt = new Date();
  const displayName = input.displayName?.trim().slice(0, 120) || null;

  if (!existingAccount) {
    await prisma.customerAccount.create({
      data: {
        email,
        normalizedEmail: email,
        displayName,
        status: "active",
        passwordHash,
        passwordSetAt
      }
    });
  } else if (existingAccount.status === "active" && !existingAccount.passwordHash) {
    await prisma.customerAccount.update({
      where: { id: existingAccount.id },
      data: {
        passwordHash,
        passwordSetAt,
        ...(displayName && !existingAccount.displayName ? { displayName } : {})
      }
    });
  }

  const result = await requestCustomerMagicLink({
    email,
    requestUrl: input.requestUrl,
    fetchImpl: input.fetchImpl
  });
  return result;
}

export async function authenticateCustomerPassword(input: {
  email: string;
  password: string;
  requestUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CustomerPasswordLoginResult> {
  if (!customerAccountsEnabled()) return { ok: false, reason: "disabled" };
  const email = normalizeCustomerAccountEmail(input.email);
  if (!email || !input.password) return { ok: false, reason: "invalid" };

  let account: CustomerAccountLookup | null;
  try {
    account = await findCustomerAccountByNormalizedEmail(email);
  } catch (error) {
    if (error instanceof CustomerAccountIdentityConflictError) return { ok: false, reason: "invalid" };
    throw error;
  }
  const passwordHashForCompare =
    account && account.status === "active" && account.passwordHash ? account.passwordHash : customerDummyPasswordHash;
  const passwordOk = await bcrypt.compare(input.password, passwordHashForCompare);
  if (!account || account.status !== "active" || !account.passwordHash) return { ok: false, reason: "invalid" };
  if (!passwordOk) return { ok: false, reason: "invalid" };
  if (!account.emailVerifiedAt) {
    const verificationEmail = await requestCustomerMagicLink({
      email,
      requestUrl: input.requestUrl,
      fetchImpl: input.fetchImpl
    });
    return { ok: false, reason: "unverified", verificationEmail };
  }

  const updatedAccount = await prisma.customerAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
    select: { id: true, email: true }
  });
  return { ok: true, account: updatedAccount };
}

export async function requestCustomerPasswordReset(input: {
  email: string;
  requestUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CustomerAccountEmailStatus> {
  if (!customerAccountsEnabled()) return { status: "not_configured", provider: "none", expiresAt: null };
  const email = normalizeCustomerAccountEmail(input.email);
  if (!email) return { status: "skipped", provider: "none", expiresAt: null };

  let account: CustomerAccountLookup | null;
  try {
    account = await findCustomerAccountByNormalizedEmail(email);
  } catch (error) {
    if (error instanceof CustomerAccountIdentityConflictError) return { status: "skipped", provider: "none", expiresAt: null };
    throw error;
  }
  if (!account || account.status !== "active") return { status: "skipped", provider: "none", expiresAt: null };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashCustomerPasswordResetToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + passwordResetMinutes * 60 * 1000);
  await prisma.$transaction([
    prisma.customerPasswordResetToken.updateMany({
      where: { customerAccountId: account.id, usedAt: null },
      data: { usedAt: now }
    }),
    prisma.customerPasswordResetToken.create({
      data: {
        customerAccountId: account.id,
        tokenHash,
        expiresAt
      }
    })
  ]);

  const link = `${safeBaseUrl(input.requestUrl)}/account/reset-password?token=${encodeURIComponent(token)}`;
  const result = await sendEmailViaProvider(
    {
      to: email,
      subject: "Reset your GameDayGrabs account password",
      text: customerPasswordResetText(link),
      headers: {
        "X-Entity-Ref-ID": `customer-account:${account.id}:password-reset`,
        "X-GDD-Notification-Type": "customer_account_password_reset"
      },
      tags: [
        { name: "notificationType", value: "customer_account_password_reset" },
        { name: "environment", value: process.env.NODE_ENV || "development" }
      ]
    },
    {
      fetchImpl: input.fetchImpl,
      idempotencyKey: `customer-account-password-reset:${tokenHash}`
    }
  );
  return { status: result.status, provider: result.provider, expiresAt };
}

export async function resetCustomerPassword(input: {
  token: string | null | undefined;
  password: string;
  confirmPassword: string;
}) {
  if (!customerAccountsEnabled()) return { ok: false, reason: "disabled" as const, account: null };
  const cleanToken = input.token?.trim();
  if (!cleanToken) return { ok: false, reason: "missing" as const, account: null };
  assertCustomerPassword(input.password, input.confirmPassword);
  const tokenHash = hashCustomerPasswordResetToken(cleanToken);
  const now = new Date();
  const record = await prisma.customerPasswordResetToken.findUnique({
    where: { tokenHash },
    include: { customerAccount: true }
  });
  if (!record || record.usedAt) return { ok: false, reason: "invalid" as const, account: null };
  if (record.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" as const, account: null };
  if (!record.customerAccount || record.customerAccount.status !== "active") {
    return { ok: false, reason: "disabled_account" as const, account: null };
  }

  const passwordHash = await hashCustomerPassword(input.password);
  let updatedAccount: { id: string; email: string };
  try {
    updatedAccount = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerPasswordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) throw new CustomerOneTimeTokenUnavailableError();

      const account = await tx.customerAccount.update({
        where: { id: record.customerAccount.id },
        data: {
          normalizedEmail: normalizeCustomerAccountEmail(record.customerAccount.email),
          passwordHash,
          passwordSetAt: now,
          sessionRevokedBefore: now,
          emailVerifiedAt: record.customerAccount.emailVerifiedAt ?? now,
          lastLoginAt: now
        },
        select: { id: true, email: true }
      });
      await tx.customerSession.updateMany({
        where: {
          customerAccountId: record.customerAccount.id,
          revokedAt: null
        },
        data: {
          revokedAt: now,
          revokeReason: "password_reset"
        }
      });
      return account;
    });
  } catch (error) {
    if (error instanceof CustomerOneTimeTokenUnavailableError) {
      return { ok: false, reason: "invalid" as const, account: null };
    }
    throw error;
  }

  return { ok: true, reason: "reset" as const, account: updatedAccount };
}

export async function verifyCustomerMagicLink(token: string | null | undefined) {
  if (!customerAccountsEnabled()) return { ok: false, reason: "disabled" as const, account: null };
  const cleanToken = token?.trim();
  if (!cleanToken) return { ok: false, reason: "missing" as const, account: null };
  const tokenHash = hashCustomerMagicLinkToken(cleanToken);
  const now = new Date();
  const record = await prisma.customerMagicLinkToken.findUnique({
    where: { tokenHash },
    include: { customerAccount: true }
  });
  if (!record || record.usedAt) return { ok: false, reason: "invalid" as const, account: null };
  if (record.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" as const, account: null };
  const email = normalizeCustomerAccountEmail(record.email);
  if (!email) return { ok: false, reason: "invalid" as const, account: null };

  if (record.customerAccount && record.customerAccount.status !== "active") {
    return { ok: false, reason: "disabled_account" as const, account: null };
  }

  let updatedAccount: { id: string; email: string };
  try {
    updatedAccount = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerMagicLinkToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) throw new CustomerOneTimeTokenUnavailableError();

      const account = record.customerAccount
        ? await touchCustomerAccountNormalizedEmail(tx, record.customerAccount, email)
        : await findOrCreateCustomerAccountByNormalizedEmail(email, tx);
      if (!account || account.status !== "active") throw new CustomerOneTimeTokenUnavailableError();
      if (normalizeCustomerAccountEmail(account.email) !== email && account.normalizedEmail !== email) {
        throw new CustomerOneTimeTokenUnavailableError();
      }

      const verified = await tx.customerAccount.update({
        where: { id: account.id },
        data: {
          normalizedEmail: email,
          emailVerifiedAt: account.emailVerifiedAt ?? now,
          lastLoginAt: now
        },
        select: { id: true, email: true }
      });
      await tx.customerMagicLinkToken.update({
        where: { id: record.id },
        data: { customerAccountId: account.id }
      });
      return verified;
    });
  } catch (error) {
    if (error instanceof CustomerOneTimeTokenUnavailableError || error instanceof CustomerAccountIdentityConflictError) {
      return { ok: false, reason: "invalid" as const, account: null };
    }
    throw error;
  }

  return { ok: true, reason: "verified" as const, account: updatedAccount };
}

function userAgentSummary(request?: Request | null) {
  const userAgent = request?.headers.get("user-agent")?.replace(/\s+/g, " ").trim();
  return userAgent ? userAgent.slice(0, 180) : null;
}

export function safeCustomerDeviceSummary(userAgent: string | null | undefined) {
  const raw = userAgent?.trim();
  if (!raw) return "Unknown device";
  const value = raw.toLowerCase();
  const isIphone = value.includes("iphone");
  const isIpad = value.includes("ipad");
  const isAndroid = value.includes("android");
  const isWindows = value.includes("windows");
  const isMac = value.includes("mac os") || value.includes("macintosh");
  const isMobile = value.includes("mobile") || isIphone || isIpad || isAndroid;
  const isEdge = value.includes("edg/");
  const isChrome = value.includes("chrome/") || value.includes("crios/");
  const isFirefox = value.includes("firefox/") || value.includes("fxios/");
  const isSafari = value.includes("safari/") && !isChrome && !isEdge && !isFirefox;

  const browser = isEdge ? "Edge" : isChrome ? "Chrome" : isFirefox ? "Firefox" : isSafari ? "Safari" : null;
  const device = isIphone ? "iPhone" : isIpad ? "iPad" : isAndroid ? "Android" : isWindows ? "Windows" : isMac ? "Mac" : null;
  if (browser && device) return `${browser} on ${device}`;
  if (isMobile) return "Mobile browser";
  if (browser) return `${browser} browser`;
  return "Unknown device";
}

function relativeSessionActivityLabel(lastActivityAt: Date, now = new Date()) {
  const diffMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 2) return "Active now";
  if (diffMinutes < 60) return `Last active ${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last active ${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  return `Last active ${lastActivityAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function sessionExpirationLabel(absoluteExpiresAt: Date, now = new Date()) {
  if (absoluteExpiresAt.getTime() <= now.getTime()) return "Expired";
  return `Expires ${absoluteExpiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function customerSessionActionRef(sessionKey: string) {
  return createHmac("sha256", customerAccountSecret()).update(`customer-session-action:${sessionKey}`).digest("hex").slice(0, 24);
}

async function currentCustomerSessionTokenHash() {
  const token = await currentCustomerSessionToken();
  return token ? hashCustomerSessionToken(token) : null;
}

function emptyCustomerSessionTimeoutMetadata(
  expiredReason: Exclude<CustomerSessionTimeoutReason, "active"> | null = null
): CustomerSessionTimeoutMetadata {
  const config = customerAccountFeatureConfig();
  const now = new Date();
  return {
    enabled: config.customerSessionTimeoutsEnabled,
    idleExpiresAt: null,
    absoluteExpiresAt: null,
    warningSeconds: config.customerSessionWarningSeconds,
    activityTouchIntervalSeconds: config.customerSessionActivityTouchIntervalSeconds,
    serverNow: now.toISOString(),
    expiredReason
  };
}

function customerSessionTimeoutMetadata(input: {
  idleExpiresAt: Date | null;
  absoluteExpiresAt: Date | null;
  expiredReason: Exclude<CustomerSessionTimeoutReason, "active"> | null;
  now: Date;
}): CustomerSessionTimeoutMetadata {
  const config = customerAccountFeatureConfig();
  return {
    enabled: config.customerSessionTimeoutsEnabled,
    idleExpiresAt: input.idleExpiresAt?.toISOString() ?? null,
    absoluteExpiresAt: input.absoluteExpiresAt?.toISOString() ?? null,
    warningSeconds: config.customerSessionWarningSeconds,
    activityTouchIntervalSeconds: config.customerSessionActivityTouchIntervalSeconds,
    serverNow: input.now.toISOString(),
    expiredReason: input.expiredReason
  };
}

async function currentCustomerSessionToken() {
  const cookieStore = await cookies();
  return customerSessionCookieNames()
    .map((name) => cookieStore.get(name)?.value)
    .find(Boolean) ?? null;
}

async function findCurrentCustomerAccountFromPayload(payload: CustomerSessionPayload): Promise<CurrentCustomerAccount | null> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: payload.customerAccountId },
    select: {
      id: true,
      email: true,
      normalizedEmail: true,
      displayName: true,
      phone: true,
      status: true,
      sessionRevokedBefore: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      highestAcknowledgedRewardTier: true,
      createdAt: true,
      rewardBalance: {
        select: {
          availablePoints: true,
          lifetimeEarnedPoints: true,
          pendingPoints: true,
          updatedAt: true
        }
      },
      savedAddresses: {
        select: {
          id: true,
          name: true,
          street1: true,
          street2: true,
          city: true,
          state: true,
          zip: true,
          country: true,
          isDefault: true,
          createdAt: true
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]
      }
    }
  });
  if (!account || account.status !== "active" || !account.emailVerifiedAt) return null;
  const accountEmail = account.normalizedEmail ?? normalizeCustomerAccountEmail(account.email);
  if (accountEmail !== normalizeCustomerAccountEmail(payload.email)) return null;
  if (account.sessionRevokedBefore) {
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    if (issuedAt < account.sessionRevokedBefore.getTime()) return null;
  }
  return account;
}

export async function setCustomerSessionCookie(response: NextResponse, account: { id: string; email: string }, request?: Request) {
  const config = customerAccountFeatureConfig();
  const now = new Date();
  const absoluteExpiresAt = config.customerSessionTimeoutsEnabled
    ? customerSessionAbsoluteExpiresAt(config, now)
    : new Date(now.getTime() + customerSessionMaxAgeSeconds() * 1000);
  const token = createCustomerSessionToken(account, absoluteExpiresAt);
  const tokenHash = hashCustomerSessionToken(token);
  const userAgent = userAgentSummary(request);
  let securitySessionRef: string | null = null;

  if (customerSessionTrackingEnabled(config)) {
    const session = await prisma.customerSession.create({
      data: {
        customerAccountId: account.id,
        tokenHash,
        lastActivityAt: now,
        absoluteExpiresAt,
        userAgentSummary: userAgent
      },
      select: {
        id: true
      }
    });
    securitySessionRef = customerSessionActionRef(session.id);
  }

  if (config.customerLoginAlertsEnabled) {
    await sendCustomerLoginAlert({
      account,
      requestUrl: request?.url,
      deviceSummary: safeCustomerDeviceSummary(userAgent),
      createdAt: now,
      securitySessionRef
    });
  }

  response.cookies.set(customerSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: customerSessionMaxAgeSeconds(),
    priority: "high"
  });
}

async function sendCustomerLoginAlert(input: {
  account: { id: string; email: string };
  requestUrl?: string | null;
  deviceSummary: string;
  createdAt: Date;
  securitySessionRef: string | null;
}) {
  if (!customerLoginAlertsEnabled()) return;
  try {
    const accountUrl = `${safeBaseUrl(input.requestUrl)}/account`;
    await sendEmailViaProvider(
      {
        to: input.account.email,
        subject: "New GameDayGrabs account sign-in",
        text: customerLoginAlertText({
          accountUrl,
          deviceSummary: input.deviceSummary,
          createdAt: input.createdAt
        }),
        headers: {
          "X-Entity-Ref-ID": `customer-account:${input.account.id}:login-alert`,
          "X-GDD-Notification-Type": "customer_account_login_alert"
        },
        tags: [
          { name: "notificationType", value: "customer_account_login_alert" },
          { name: "environment", value: process.env.NODE_ENV || "development" }
        ]
      },
      {
        idempotencyKey: `customer-account-login-alert:${input.securitySessionRef ?? input.createdAt.getTime()}`
      }
    );
  } catch {
    // Login alerts are best-effort and must not block sign-in.
  }
}

export async function listCustomerAccountSecuritySessions(
  account: CurrentCustomerAccount
): Promise<CustomerAccountSecuritySession[]> {
  if (!customerSecurityCenterEnabled() || !requireVerifiedCustomerAccountIdentity(account)) return [];
  const currentTokenHash = await currentCustomerSessionTokenHash();
  const now = new Date();
  const sessions = await prisma.customerSession.findMany({
    where: {
      customerAccountId: account.id,
      revokedAt: null
    },
    select: {
      id: true,
      tokenHash: true,
      userAgentSummary: true,
      createdAt: true,
      lastActivityAt: true,
      absoluteExpiresAt: true
    },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    take: 50
  });

  return sessions.map((session) => {
    const expired = session.absoluteExpiresAt.getTime() <= now.getTime();
    return {
      ref: customerSessionActionRef(session.id),
      current: Boolean(currentTokenHash && session.tokenHash === currentTokenHash),
      deviceSummary: safeCustomerDeviceSummary(session.userAgentSummary),
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      activeLabel: expired ? "Expired" : relativeSessionActivityLabel(session.lastActivityAt, now),
      expirationLabel: sessionExpirationLabel(session.absoluteExpiresAt, now),
      expired
    };
  });
}

async function findOwnedCustomerSessionByRef(account: CurrentCustomerAccount, sessionRef: string) {
  const cleanRef = sessionRef.trim();
  if (!cleanRef) return null;
  const sessions = await prisma.customerSession.findMany({
    where: {
      customerAccountId: account.id,
      revokedAt: null
    },
    select: {
      id: true,
      tokenHash: true
    }
  });
  return sessions.find((session) => customerSessionActionRef(session.id) === cleanRef) ?? null;
}

export async function revokeCustomerAccountSecuritySession(account: CurrentCustomerAccount, sessionRef: string) {
  if (!customerSecurityCenterEnabled() || !requireVerifiedCustomerAccountIdentity(account)) {
    return { status: "disabled" as const, revokedCurrent: false };
  }
  const session = await findOwnedCustomerSessionByRef(account, sessionRef);
  if (!session) return { status: "not_found" as const, revokedCurrent: false };

  const currentTokenHash = await currentCustomerSessionTokenHash();
  const revokedCurrent = Boolean(currentTokenHash && session.tokenHash === currentTokenHash);
  const updated = await prisma.customerSession.updateMany({
    where: {
      id: session.id,
      customerAccountId: account.id,
      revokedAt: null
    },
    data: {
      revokedAt: new Date(),
      revokeReason: revokedCurrent ? "security_center_current" : "security_center"
    }
  });
  if (updated.count === 0) return { status: "not_found" as const, revokedCurrent: false };
  return { status: "revoked" as const, revokedCurrent };
}

export async function signOutOtherCustomerSecuritySessions(account: CurrentCustomerAccount) {
  if (!customerSecurityCenterEnabled() || !requireVerifiedCustomerAccountIdentity(account)) return { count: 0 };
  const currentTokenHash = await currentCustomerSessionTokenHash();
  if (!currentTokenHash) return { count: 0 };
  const updated = await prisma.customerSession.updateMany({
    where: {
      customerAccountId: account.id,
      revokedAt: null,
      tokenHash: { not: currentTokenHash }
    },
    data: {
      revokedAt: new Date(),
      revokeReason: "security_center_other_devices"
    }
  });
  return { count: updated.count };
}

export async function signOutAllCustomerSecuritySessions(account: CurrentCustomerAccount) {
  if (!customerSecurityCenterEnabled() || !requireVerifiedCustomerAccountIdentity(account)) return { count: 0 };
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.customerSession.updateMany({
      where: {
        customerAccountId: account.id,
        revokedAt: null
      },
      data: {
        revokedAt: now,
        revokeReason: "security_center_all_devices"
      }
    }),
    prisma.customerAccount.update({
      where: { id: account.id },
      data: { sessionRevokedBefore: now },
      select: { id: true }
    })
  ]);
  return { count: updated.count };
}

export function clearCustomerSessionCookie(response: NextResponse) {
  for (const name of customerSessionCookieNames()) {
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

export async function revokeCurrentCustomerSession(reason = "logout") {
  const config = customerAccountFeatureConfig();
  if (!customerAccountsEnabled() || !customerSessionTrackingEnabled(config)) return;
  const token = await currentCustomerSessionToken();
  if (!token) return;
  await prisma.customerSession.updateMany({
    where: {
      tokenHash: hashCustomerSessionToken(token),
      revokedAt: null
    },
    data: {
      revokedAt: new Date(),
      revokeReason: reason.slice(0, 80)
    }
  });
}

export async function currentCustomerAccountSessionStatus(options: { touchActivity?: boolean } = {}): Promise<CurrentCustomerAccountSessionStatus> {
  if (!customerAccountsEnabled()) {
    return { account: null, timeout: emptyCustomerSessionTimeoutMetadata(), shouldClearCookie: false };
  }
  const token = await currentCustomerSessionToken();
  if (!token) return { account: null, timeout: emptyCustomerSessionTimeoutMetadata(), shouldClearCookie: false };

  const config = customerAccountFeatureConfig();
  const payload = verifyCustomerSessionToken(token, { ignoreExpiration: config.customerSessionTimeoutsEnabled });
  if (!payload) return { account: null, timeout: emptyCustomerSessionTimeoutMetadata("invalid"), shouldClearCookie: true };

  const account = await findCurrentCustomerAccountFromPayload(payload);
  if (!account) return { account: null, timeout: emptyCustomerSessionTimeoutMetadata("invalid"), shouldClearCookie: true };

  if (!customerSessionTrackingEnabled(config)) {
    return { account, timeout: emptyCustomerSessionTimeoutMetadata(), shouldClearCookie: false };
  }

  const now = new Date();
  const tokenHash = hashCustomerSessionToken(token);
  const session = await prisma.customerSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      customerAccountId: true,
      lastActivityAt: true,
      absoluteExpiresAt: true,
      revokedAt: true
    }
  });
  if (!session || session.customerAccountId !== account.id || session.revokedAt) {
    return { account: null, timeout: emptyCustomerSessionTimeoutMetadata("missing"), shouldClearCookie: true };
  }

  if (config.customerSessionTimeoutsEnabled) {
    const timeoutState = resolveCustomerSessionTimeout(config, session, now);
    if (timeoutState.reason !== "active") {
      return {
        account: null,
        timeout: customerSessionTimeoutMetadata({
          idleExpiresAt: timeoutState.idleExpiresAt,
          absoluteExpiresAt: timeoutState.absoluteExpiresAt,
          expiredReason: timeoutState.reason,
          now
        }),
        shouldClearCookie: true
      };
    }
  } else if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
    return { account: null, timeout: emptyCustomerSessionTimeoutMetadata("absolute_expired"), shouldClearCookie: true };
  }

  let lastActivityAt = session.lastActivityAt;
  if (options.touchActivity !== false && shouldTouchCustomerSessionActivity(config, session.lastActivityAt, now)) {
    const updated = await prisma.customerSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        absoluteExpiresAt: { gt: now }
      },
      data: { lastActivityAt: now }
    });
    if (updated.count > 0) {
      lastActivityAt = now;
    }
  }

  if (!config.customerSessionTimeoutsEnabled) {
    return {
      account,
      timeout: emptyCustomerSessionTimeoutMetadata(),
      shouldClearCookie: false
    };
  }

  const activeState = resolveCustomerSessionTimeout(config, { ...session, lastActivityAt }, now);
  return {
    account,
    timeout: customerSessionTimeoutMetadata({
      idleExpiresAt: activeState.idleExpiresAt,
      absoluteExpiresAt: activeState.absoluteExpiresAt,
      expiredReason: null,
      now
    }),
    shouldClearCookie: false
  };
}

export async function currentCustomerAccount(): Promise<CurrentCustomerAccount | null> {
  const status = await currentCustomerAccountSessionStatus();
  return status?.account ?? null;
}

export function requireVerifiedCustomerAccountIdentity(account: CurrentCustomerAccount | null | undefined) {
  return verifiedCustomerIdentity(account);
}

function trackingUrlFor(carrier: string | null | undefined, trackingNumber: string | null | undefined) {
  const tracking = trackingNumber?.trim();
  if (!tracking) return null;
  const encoded = encodeURIComponent(tracking);
  const normalizedCarrier = (carrier || "").trim().toLowerCase();
  if (normalizedCarrier.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (normalizedCarrier.includes("ups")) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (normalizedCarrier.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  return null;
}

function orderIsLocalPickup(order: { shippingMethodLabel: string | null; shippingPackageProfile: string | null }) {
  return order.shippingPackageProfile === "local_pickup" || String(order.shippingMethodLabel || "").trim().toLowerCase() === "local pickup";
}

function pickupStatus(order: { fulfillmentStatus: string }) {
  if (order.fulfillmentStatus === "picked_up") return "Picked up";
  if (order.fulfillmentStatus === "pickup_ready") return "Ready for pickup";
  return "Pickup pending";
}

function safeOrderStatus(order: {
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  refundStatus: string | null;
  shippingMethodLabel: string | null;
  shippingPackageProfile: string | null;
}) {
  if (order.paymentStatus === "refunded" || order.status === "refunded") return "Refunded";
  if (order.paymentStatus === "partially_refunded" || order.status === "partially_refunded") return "Partially refunded";
  if (order.status === "canceled") return "Canceled";
  if (order.paymentStatus === "expired") return "Expired";
  if (order.paymentStatus === "paid" && orderIsLocalPickup(order)) return pickupStatus(order);
  if (order.fulfillmentStatus === "shipped") return "Shipped";
  if (order.paymentStatus === "paid") return "Paid";
  return "Pending";
}

const customerVisiblePosSaleSelect = {
  id: true,
  saleReference: true,
  platform: true,
  quantitySold: true,
  soldPricePerItem: true,
  grossSale: true,
  discountAmount: true,
  taxCents: true,
  taxStatus: true,
  totalCents: true,
  refundStatus: true,
  refundedAmount: true,
  refundedTaxCents: true,
  refundedAt: true,
  soldAt: true,
  paymentMethod: true,
  notes: true,
  inventoryItem: {
    select: {
      itemName: true,
      imageUrl: true,
      publicTitle: true,
      publicImages: true
    }
  }
} satisfies Prisma.InventorySaleSelect;

type CustomerVisiblePosSale = Prisma.InventorySaleGetPayload<{ select: typeof customerVisiblePosSaleSelect }>;

function roundAccountMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseJsonStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function publicImageForInventoryItem(item: CustomerVisiblePosSale["inventoryItem"]) {
  return parseJsonStringArray(item.publicImages)[0] ?? item.imageUrl ?? null;
}

function customerPosSaleKey(sale: Pick<CustomerVisiblePosSale, "id" | "saleReference">) {
  return sale.saleReference?.trim() || sale.id;
}

function customerPosSourceType(sale: Pick<CustomerVisiblePosSale, "platform">): CustomerPurchaseSourceType {
  return sale.platform.trim().toLowerCase() === "pos" ? "pos" : "local";
}

function customerPosSourceLabel(sourceType: CustomerPurchaseSourceType) {
  if (sourceType === "pos") return "In-Store Purchase";
  if (sourceType === "local") return "Local Purchase";
  return "Online Order";
}

function safePosPaymentMethodLabel(value: string | null | undefined) {
  const method = value?.trim().toLowerCase();
  if (!method) return null;
  if (method === "cash") return "Cash";
  if (method === "zelle") return "Zelle";
  if (method === "card" || method === "stripe" || method === "terminal") return "Card";
  return "Other";
}

function posMoneyFromNote(notes: string | null | undefined, label: "subtotal" | "tax" | "total") {
  const match = notes?.match(new RegExp(`POS ${label}: \\$(\\d+(?:\\.\\d{1,2})?)\\.`));
  return match ? roundAccountMoney(Number(match[1])) : null;
}

function customerPosSaleStatus(sales: CustomerVisiblePosSale[]) {
  if (sales.some((sale) => sale.refundStatus === "canceled")) return "Canceled";
  const refundedSales = sales.filter((sale) => sale.refundStatus === "refunded" || (sale.refundedAmount ?? 0) >= sale.grossSale);
  if (refundedSales.length === sales.length && sales.length > 0) return "Refunded";
  if (sales.some((sale) => (sale.refundedAmount ?? 0) > 0 || sale.refundStatus)) return "Partially refunded";
  return "Completed";
}

function safePositiveRewardPoints(entries: Array<{ points: number; type?: string | null }>) {
  return entries.filter((entry) => entry.points > 0 && (!entry.type || entry.type === "earn")).reduce((sum, entry) => sum + entry.points, 0);
}

function groupCustomerPosSales(sales: CustomerVisiblePosSale[]) {
  const groups = new Map<string, CustomerVisiblePosSale[]>();
  for (const sale of sales) {
    const key = customerPosSaleKey(sale);
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, sales: group }))
    .sort((left, right) => right.sales[0]!.soldAt.getTime() - left.sales[0]!.soldAt.getTime());
}

function customerPosSaleTotals(sales: CustomerVisiblePosSale[]) {
  const first = sales[0] ?? null;
  const noteSubtotal = first ? posMoneyFromNote(first.notes, "subtotal") : null;
  const noteTax = first ? posMoneyFromNote(first.notes, "tax") : null;
  const noteTotal = first ? posMoneyFromNote(first.notes, "total") : null;
  const subtotal = roundAccountMoney(noteSubtotal ?? sales.reduce((sum, sale) => sum + Math.max(0, sale.grossSale), 0));
  const taxSnapshotKnown = sales.some((sale) => sale.taxCents !== null);
  const tax = taxSnapshotKnown
    ? roundAccountMoney(sales.reduce((sum, sale) => sum + (sale.taxCents ?? 0), 0) / 100)
    : sales.some((sale) => sale.taxStatus === "not_recorded")
      ? null
      : noteTax === null
        ? null
        : roundAccountMoney(noteTax);
  const refundedTax = tax === null
    ? null
    : roundAccountMoney(sales.reduce((sum, sale) => sum + Math.max(0, sale.refundedTaxCents ?? 0), 0) / 100);
  const refundedAmount = roundAccountMoney(sales.reduce((sum, sale) => sum + Math.max(0, Math.min(sale.refundedAmount ?? 0, sale.grossSale)), 0));
  const persistedTotal = taxSnapshotKnown
    ? sales.reduce((sum, sale) => sum + (sale.totalCents ?? Math.round(sale.grossSale * 100)), 0) / 100
    : null;
  const totalBeforeRefund = roundAccountMoney(persistedTotal ?? noteTotal ?? subtotal + (tax ?? 0));
  const totalPaid = roundAccountMoney(Math.max(0, totalBeforeRefund - refundedAmount));
  const discountTotal = roundAccountMoney(sales.reduce((sum, sale) => sum + Math.max(0, sale.discountAmount ?? 0), 0));
  return { subtotal, tax, refundedTax, refundedAmount, totalPaid, discountTotal };
}

function customerPosSaleHistoryItem(key: string, sales: CustomerVisiblePosSale[], rewardPoints: number): CustomerAccountOrderHistoryItem {
  const first = sales[0]!;
  const sourceType = customerPosSourceType(first);
  const totals = customerPosSaleTotals(sales);
  const itemCount = sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
  const status = customerPosSaleStatus(sales);
  const refundedAt = sales
    .map((sale) => sale.refundedAt)
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  return {
    orderNumber: first.saleReference?.trim() || key,
    detailKey: `pos:${key}`,
    displayReference: first.saleReference?.trim() || `POS-${key.slice(-8).toUpperCase()}`,
    sourceType,
    sourceLabel: customerPosSourceLabel(sourceType),
    orderDate: first.soldAt.toISOString(),
    status,
    paymentStatus: status === "Refunded" ? "refunded" : totals.refundedAmount > 0 ? "partially_refunded" : "paid",
    fulfillmentStatus: "picked_up",
    fulfillmentMethod: "in_store",
    itemCount,
    totalPaid: totals.totalPaid,
    shippingCharged: 0,
    shippingMethodLabel: null,
    pickupStatus: "Completed",
    trackingNumber: null,
    trackingUrl: null,
    carrier: null,
    refundStatus: totals.refundedAmount > 0 ? status.toLowerCase().replace(/\s+/g, "_") : null,
    refundedAmount: totals.refundedAmount,
    canceledAt: null,
    refundedAt: refundedAt?.toISOString() ?? null,
    rewardsEarned: rewardPoints > 0 ? rewardPoints : null,
    receiptAvailable: true,
    orderDetailAvailable: true,
    items: sales.map((sale) => ({
      title: sale.inventoryItem.publicTitle || sale.inventoryItem.itemName,
      quantity: sale.quantitySold,
      imageUrl: publicImageForInventoryItem(sale.inventoryItem)
    }))
  };
}

function customerPosSaleDetail(key: string, sales: CustomerVisiblePosSale[], rewardPoints: number): CustomerAccountOrderDetail {
  const history = customerPosSaleHistoryItem(key, sales, rewardPoints);
  const totals = customerPosSaleTotals(sales);
  const first = sales[0]!;
  return {
    ...history,
    subtotal: totals.subtotal,
    tax: totals.tax,
    refundedTax: totals.refundedTax,
    discountTotal: totals.discountTotal,
    paymentMethodLabel: safePosPaymentMethodLabel(first.paymentMethod),
    shippingCarrier: null,
    shippingService: null,
    supportEmail: GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL,
    items: sales.map((sale) => ({
      title: sale.inventoryItem.publicTitle || sale.inventoryItem.itemName,
      quantity: sale.quantitySold,
      unitPrice: sale.soldPricePerItem,
      lineTotal: roundAccountMoney(sale.soldPricePerItem * sale.quantitySold),
      imageUrl: publicImageForInventoryItem(sale.inventoryItem)
    }))
  };
}

async function rewardPointsByPosSaleKey(customerAccountId: string, keys: string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const result = new Map<string, number>();
  if (!uniqueKeys.length) return result;

  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: {
      customerAccountId,
      OR: [
        {
          idempotencyKey: {
            in: uniqueKeys.flatMap((key) => [`rewards:pos:earn:${key}`, `rewards:pos:refund:${key}`, `rewards:backfill:pos:${key}`])
          }
        },
        {
          source: { in: ["pos", "admin_pos_link_backfill"] },
          OR: uniqueKeys.map((key) => ({ metadataJson: { contains: key } }))
        }
      ]
    },
    select: {
      idempotencyKey: true,
      metadataJson: true,
      points: true,
      type: true
    }
  });

  for (const key of uniqueKeys) {
    const matching = ledger.filter((entry) => {
      if (entry.idempotencyKey === `rewards:pos:earn:${key}` || entry.idempotencyKey === `rewards:backfill:pos:${key}`) return true;
      if (entry.idempotencyKey === `rewards:pos:refund:${key}`) return true;
      return typeof entry.metadataJson === "string" && entry.metadataJson.includes(key);
    });
    const netPoints = matching.reduce((sum, entry) => sum + entry.points, 0);
    result.set(key, Math.max(0, netPoints));
  }
  return result;
}

export async function listCustomerAccountOrders(account: CurrentCustomerAccount): Promise<CustomerAccountOrderHistoryItem[]> {
  const where = customerVisibleOrderWhere(account);
  if (!where) return [];

  const posWhere = customerVisiblePosSaleWhere(account);
  const [orders, posSales] = await Promise.all([
    prisma.storefrontOrder.findMany({
      where,
      select: {
        orderNumber: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        shippingMethodLabel: true,
        shippingPackageProfile: true,
        shippingCarrier: true,
        shippingTrackingNumber: true,
        shippingTrackingUrl: true,
        carrier: true,
        trackingNumber: true,
        total: true,
        shippingCharged: true,
        refundStatus: true,
        refundedAmount: true,
        canceledAt: true,
        refundedAt: true,
        items: {
          select: {
            publicTitle: true,
            imageUrl: true,
            quantity: true
          }
        },
        rewardLedgerEntries: {
          select: {
            points: true,
            type: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    posWhere
      ? prisma.inventorySale.findMany({
          where: posWhere,
          select: customerVisiblePosSaleSelect,
          orderBy: [{ soldAt: "desc" }, { createdAt: "asc" }],
          take: 200
        })
      : Promise.resolve([])
  ]);

  const posGroups = groupCustomerPosSales(posSales);
  const posRewards = await rewardPointsByPosSaleKey(account.id, posGroups.map((group) => group.key));

  const onlineHistory = orders.map((order) => {
    const localPickup = orderIsLocalPickup(order);
    const carrier = localPickup ? null : order.shippingCarrier ?? order.carrier;
    const trackingNumber = localPickup ? null : order.shippingTrackingNumber ?? order.trackingNumber;
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const rewardPoints = safePositiveRewardPoints(order.rewardLedgerEntries);
    return {
      orderNumber: order.orderNumber,
      detailKey: order.orderNumber,
      displayReference: order.orderNumber,
      sourceType: "online" as const,
      sourceLabel: "Online Order",
      orderDate: order.createdAt.toISOString(),
      status: safeOrderStatus(order),
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      fulfillmentMethod: localPickup ? ("local_pickup" as const) : ("shipping" as const),
      itemCount,
      totalPaid: order.total,
      shippingCharged: order.shippingCharged,
      shippingMethodLabel: order.shippingMethodLabel,
      pickupStatus: localPickup ? pickupStatus(order) : null,
      carrier,
      trackingNumber,
      trackingUrl: localPickup ? null : order.shippingTrackingUrl ?? trackingUrlFor(carrier, trackingNumber),
      refundStatus: order.refundStatus ?? (order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded" ? order.paymentStatus : null),
      refundedAmount: order.refundedAmount,
      canceledAt: order.canceledAt?.toISOString() ?? null,
      refundedAt: order.refundedAt?.toISOString() ?? null,
      rewardsEarned: rewardPoints > 0 ? rewardPoints : null,
      receiptAvailable: true,
      orderDetailAvailable: true,
      items: order.items.map((item) => ({
        title: item.publicTitle,
        quantity: item.quantity,
        imageUrl: item.imageUrl
      }))
    };
  });

  const posHistory = posGroups.map((group) => customerPosSaleHistoryItem(group.key, group.sales, posRewards.get(group.key) ?? 0));

  return [...onlineHistory, ...posHistory]
    .sort((left, right) => new Date(right.orderDate).getTime() - new Date(left.orderDate).getTime())
    .slice(0, 100);
}

export async function getCustomerAccountOrderDetail(
  account: CurrentCustomerAccount,
  orderNumber: string
): Promise<CustomerAccountOrderDetail | null> {
  const cleanOrderNumber = orderNumber.trim();
  if (cleanOrderNumber.startsWith("pos:")) {
    const saleKey = cleanOrderNumber.slice(4).trim();
    const where = customerVisiblePosSaleWhere(account, saleKey);
    if (!where) return null;
    const sales = await prisma.inventorySale.findMany({
      where,
      select: customerVisiblePosSaleSelect,
      orderBy: [{ soldAt: "desc" }, { createdAt: "asc" }]
    });
    if (!sales.length) return null;
    const group = groupCustomerPosSales(sales).find((candidate) => candidate.key === saleKey) ?? groupCustomerPosSales(sales)[0];
    if (!group) return null;
    const posRewards = await rewardPointsByPosSaleKey(account.id, [group.key]);
    return customerPosSaleDetail(group.key, group.sales, posRewards.get(group.key) ?? 0);
  }

  const where = customerVisibleOrderWhere(account, cleanOrderNumber);
  if (!where) return null;

  const order = await prisma.storefrontOrder.findFirst({
    where,
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotal: true,
      subtotalCents: true,
      tax: true,
      taxCents: true,
      discountCents: true,
      totalCents: true,
      refundedTaxCents: true,
      shippingCharged: true,
      shippingMethodLabel: true,
      shippingPackageProfile: true,
      shippingCarrier: true,
      shippingService: true,
      shippingTrackingNumber: true,
      shippingTrackingUrl: true,
      carrier: true,
      trackingNumber: true,
      total: true,
      refundStatus: true,
      refundedAmount: true,
      canceledAt: true,
      refundedAt: true,
      rewardLedgerEntries: {
        select: {
          points: true,
          type: true
        }
      },
      items: {
        select: {
          publicTitle: true,
          imageUrl: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true
        }
      }
    }
  });
  if (!order) return null;

  const localPickup = orderIsLocalPickup(order);
  const carrier = localPickup ? null : order.shippingCarrier ?? order.carrier;
  const trackingNumber = localPickup ? null : order.shippingTrackingNumber ?? order.trackingNumber;
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const rewardPoints = safePositiveRewardPoints(order.rewardLedgerEntries);

  return {
    orderNumber: order.orderNumber,
    detailKey: order.orderNumber,
    displayReference: order.orderNumber,
    sourceType: "online",
    sourceLabel: "Online Order",
    orderDate: order.createdAt.toISOString(),
    status: safeOrderStatus(order),
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    fulfillmentMethod: localPickup ? "local_pickup" : "shipping",
    itemCount,
    subtotal: order.subtotalCents === null ? order.subtotal : roundAccountMoney(order.subtotalCents / 100),
    tax: order.taxCents === null ? null : roundAccountMoney(order.taxCents / 100),
    refundedTax: order.taxCents === null ? null : roundAccountMoney((order.refundedTaxCents ?? 0) / 100),
    discountTotal: roundAccountMoney((order.discountCents ?? 0) / 100),
    paymentMethodLabel: null,
    totalPaid: order.totalCents === null ? order.total : roundAccountMoney(order.totalCents / 100),
    shippingCharged: order.shippingCharged,
    shippingMethodLabel: order.shippingMethodLabel,
    pickupStatus: localPickup ? pickupStatus(order) : null,
    carrier,
    trackingNumber,
    trackingUrl: localPickup ? null : order.shippingTrackingUrl ?? trackingUrlFor(carrier, trackingNumber),
    shippingCarrier: localPickup ? null : order.shippingCarrier ?? carrier,
    shippingService: localPickup ? null : order.shippingService,
    refundStatus:
      order.refundStatus ??
      (order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded" ? order.paymentStatus : null),
    refundedAmount: order.refundedAmount,
    canceledAt: order.canceledAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    rewardsEarned: rewardPoints > 0 ? rewardPoints : null,
    receiptAvailable: true,
    orderDetailAvailable: true,
    supportEmail: GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL,
    items: order.items.map((item) => ({
      title: item.publicTitle,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      imageUrl: item.imageUrl
    }))
  };
}
