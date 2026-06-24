import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailViaProvider, type EmailSendResult } from "@/lib/email-provider";
import { authRuntimeConfig } from "@/lib/auth";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

const customerSessionCookie = "gdg_customer_session";
const hostCustomerSessionCookie = "__Host-gdg_customer_session";
const customerSessionDays = 30;
const magicLinkMinutes = 20;
const passwordResetMinutes = 30;
const customerPasswordMinLength = 8;
const devFallbackSecret = "local-dev-customer-account-secret-change-before-sharing";

type CustomerSessionPayload = {
  customerAccountId: string;
  email: string;
  exp: number;
};

export type CurrentCustomerAccount = {
  id: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
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

export type CustomerAccountOrderHistoryItem = {
  orderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  fulfillmentMethod: "shipping" | "local_pickup";
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
  items: Array<{ title: string; quantity: number; imageUrl: string | null }>;
};

export type CustomerAccountOrderDetail = Omit<CustomerAccountOrderHistoryItem, "items"> & {
  subtotal: number;
  items: Array<{
    title: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
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

function createCustomerSessionToken(account: { id: string; email: string }) {
  const payload: CustomerSessionPayload = {
    customerAccountId: account.id,
    email: normalizeCustomerAccountEmail(account.email) ?? account.email,
    exp: Date.now() + customerSessionDays * 24 * 60 * 60 * 1000
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${signCustomerSession(body)}`;
}

function verifyCustomerSessionToken(token: string): CustomerSessionPayload | null {
  const [body, signature] = token.split(".");
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
    if (!payload.customerAccountId || !payload.email || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeCustomerAccountEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function hashCustomerMagicLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashCustomerPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function customerPasswordMeetsPolicy(password: string) {
  return password.length >= customerPasswordMinLength;
}

function assertCustomerPassword(password: string, confirmPassword?: string) {
  if (!customerPasswordMeetsPolicy(password)) {
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
  const configured = envValue("STORE_BASE_URL") || envValue("APP_URL");
  if (configured) return configured.replace(/\/+$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
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

export async function requestCustomerMagicLink(input: {
  email: string;
  requestUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ status: EmailSendResult["status"]; provider: EmailSendResult["provider"]; expiresAt: Date | null }> {
  if (!customerAccountsEnabled()) return { status: "not_configured", provider: "none", expiresAt: null };
  const email = normalizeCustomerAccountEmail(input.email);
  if (!email) throw new Error("Enter a valid email address.");

  const account = await prisma.customerAccount.upsert({
    where: { email },
    update: {},
    create: { email, status: "active" },
    select: { id: true, email: true, status: true }
  });
  if (account.status !== "active") return { status: "failed", provider: "none", expiresAt: null };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashCustomerMagicLinkToken(token);
  const expiresAt = new Date(Date.now() + magicLinkMinutes * 60 * 1000);
  await prisma.customerMagicLinkToken.create({
    data: {
      customerAccountId: account.id,
      email,
      tokenHash,
      expiresAt
    }
  });

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

  const existingAccount = await prisma.customerAccount.findUnique({
    where: { email },
    select: { id: true, status: true, passwordHash: true, displayName: true }
  });
  const passwordHash = await hashCustomerPassword(input.password);
  const passwordSetAt = new Date();
  const displayName = input.displayName?.trim().slice(0, 120) || null;

  if (!existingAccount) {
    await prisma.customerAccount.create({
      data: {
        email,
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

  const account = await prisma.customerAccount.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      status: true,
      passwordHash: true,
      emailVerifiedAt: true
    }
  });
  if (!account || account.status !== "active" || !account.passwordHash) return { ok: false, reason: "invalid" };
  const passwordOk = await bcrypt.compare(input.password, account.passwordHash);
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

  const account = await prisma.customerAccount.findUnique({
    where: { email },
    select: { id: true, email: true, status: true }
  });
  if (!account || account.status !== "active") return { status: "skipped", provider: "none", expiresAt: null };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashCustomerPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + passwordResetMinutes * 60 * 1000);
  await prisma.customerPasswordResetToken.create({
    data: {
      customerAccountId: account.id,
      tokenHash,
      expiresAt
    }
  });

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
  const [updatedAccount] = await prisma.$transaction([
    prisma.customerAccount.update({
      where: { id: record.customerAccount.id },
      data: {
        passwordHash,
        passwordSetAt: now,
        emailVerifiedAt: record.customerAccount.emailVerifiedAt ?? now,
        lastLoginAt: now
      },
      select: { id: true, email: true }
    }),
    prisma.customerPasswordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now }
    })
  ]);

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

  const account =
    record.customerAccount ??
    (await prisma.customerAccount.upsert({
      where: { email },
      update: {},
      create: { email, status: "active" }
    }));
  if (account.status !== "active") return { ok: false, reason: "disabled_account" as const, account: null };

  const [updatedAccount] = await prisma.$transaction([
    prisma.customerAccount.update({
      where: { id: account.id },
      data: {
        emailVerifiedAt: account.emailVerifiedAt ?? now,
        lastLoginAt: now
      },
      select: { id: true, email: true }
    }),
    prisma.customerMagicLinkToken.update({
      where: { id: record.id },
      data: {
        customerAccountId: account.id,
        usedAt: now
      }
    })
  ]);

  return { ok: true, reason: "verified" as const, account: updatedAccount };
}

export function setCustomerSessionCookie(response: NextResponse, account: { id: string; email: string }) {
  response.cookies.set(customerSessionCookieName(), createCustomerSessionToken(account), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: customerSessionDays * 24 * 60 * 60
  });
}

export function clearCustomerSessionCookie(response: NextResponse) {
  for (const name of customerSessionCookieNames()) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    });
  }
}

export async function currentCustomerAccount(): Promise<CurrentCustomerAccount | null> {
  if (!customerAccountsEnabled()) return null;
  const cookieStore = await cookies();
  const token = customerSessionCookieNames()
    .map((name) => cookieStore.get(name)?.value)
    .find(Boolean);
  if (!token) return null;
  const payload = verifyCustomerSessionToken(token);
  if (!payload) return null;

  const account = await prisma.customerAccount.findUnique({
    where: { id: payload.customerAccountId },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      rewardBalance: true,
      savedAddresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]
      }
    }
  });
  if (!account || account.status !== "active" || !account.emailVerifiedAt) return null;
  if (normalizeCustomerAccountEmail(account.email) !== normalizeCustomerAccountEmail(payload.email)) return null;
  return account;
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

export async function listCustomerAccountOrders(account: CurrentCustomerAccount): Promise<CustomerAccountOrderHistoryItem[]> {
  const email = normalizeCustomerAccountEmail(account.email);
  if (!email || !account.emailVerifiedAt) return [];

  const orders = await prisma.storefrontOrder.findMany({
    where: {
      isTestOrder: false,
      OR: [{ customerEmail: email }, { customer: { is: { email } } }]
    },
    include: {
      items: {
        select: {
          publicTitle: true,
          imageUrl: true,
          quantity: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return orders.map((order) => {
    const localPickup = orderIsLocalPickup(order);
    const carrier = localPickup ? null : order.shippingCarrier ?? order.carrier;
    const trackingNumber = localPickup ? null : order.shippingTrackingNumber ?? order.trackingNumber;
    return {
      orderNumber: order.orderNumber,
      orderDate: order.createdAt.toISOString(),
      status: safeOrderStatus(order),
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      fulfillmentMethod: localPickup ? "local_pickup" : "shipping",
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
      items: order.items.map((item) => ({
        title: item.publicTitle,
        quantity: item.quantity,
        imageUrl: item.imageUrl
      }))
    };
  });
}

export async function getCustomerAccountOrderDetail(
  account: CurrentCustomerAccount,
  orderNumber: string
): Promise<CustomerAccountOrderDetail | null> {
  const email = normalizeCustomerAccountEmail(account.email);
  const cleanOrderNumber = orderNumber.trim();
  if (!email || !account.emailVerifiedAt || !cleanOrderNumber) return null;

  const order = await prisma.storefrontOrder.findFirst({
    where: {
      orderNumber: cleanOrderNumber,
      isTestOrder: false,
      OR: [{ customerEmail: email }, { customer: { is: { email } } }]
    },
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotal: true,
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
      items: {
        select: {
          publicTitle: true,
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

  return {
    orderNumber: order.orderNumber,
    orderDate: order.createdAt.toISOString(),
    status: safeOrderStatus(order),
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    fulfillmentMethod: localPickup ? "local_pickup" : "shipping",
    subtotal: order.subtotal,
    totalPaid: order.total,
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
    supportEmail: GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL,
    items: order.items.map((item) => ({
      title: item.publicTitle,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal
    }))
  };
}
