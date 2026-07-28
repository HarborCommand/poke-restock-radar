import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emailProviderConfig, emailProviderConfigured, sendEmailViaProvider, type EmailMessage, type EmailSendOptions, type EmailSendResult } from "@/lib/email-provider";
import { logAudit } from "@/lib/audit";

export const STOREFRONT_RECEIPT_EMAILS_FLAG = "STOREFRONT_RECEIPT_EMAILS_ENABLED";
export const POS_RECEIPT_EMAILS_FLAG = "POS_RECEIPT_EMAILS_ENABLED";
export const STOREFRONT_EMAIL_FROM_ENV = "STOREFRONT_EMAIL_FROM";
export const POS_RECEIPT_EMAIL_FROM_ENV = "POS_RECEIPT_EMAIL_FROM";

export type ReceiptEmailSourceType = "STOREFRONT_ORDER" | "POS_SALE" | "ADMIN_PREVIEW";
export type ReceiptEmailDeliveryType = "INITIAL" | "RESEND" | "PREVIEW";
export type ReceiptEmailDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "NOT_REQUESTED";
export type ReceiptEmailPreviewType = "storefront" | "pos";

export type ReceiptEmailDeliveryDTO = {
  status: ReceiptEmailDeliveryStatus;
  deliveryType: ReceiptEmailDeliveryType | null;
  maskedRecipient: string | null;
  sentAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  sanitizedFailureCode: string | null;
  sanitizedFailureMessage: string | null;
};

export type ReceiptEmailDeliveryRecord = {
  id: string;
  status: string;
  deliveryType: string;
  recipientEmailMasked: string;
  attemptCount: number;
  sentAt: Date | null;
  lastAttemptAt: Date | null;
  sanitizedFailureCode: string | null;
  sanitizedFailureMessage: string | null;
};

export type ReceiptEmailDeliveryAttemptStore = {
  createOrGetClaim(input: {
    sourceType: ReceiptEmailSourceType;
    sourceId: string;
    recipientEmail: string;
    deliveryType: ReceiptEmailDeliveryType;
    idempotencyKey: string;
    requestedByUserId?: string | null;
  }): Promise<ReceiptEmailDeliveryRecord>;
  claimAttempt(id: string): Promise<number>;
  findById(id: string): Promise<ReceiptEmailDeliveryRecord | null>;
  markResult(input: {
    id: string;
    status: "SENT" | "FAILED";
    providerMessageId?: string | null;
    sentAt?: Date | null;
    sanitizedFailureCode?: string | null;
    sanitizedFailureMessage?: string | null;
  }): Promise<ReceiptEmailDeliveryRecord>;
};

export type ReceiptEmailLineItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ReceiptEmailSnapshot = {
  sourceType: ReceiptEmailSourceType;
  receiptNumber: string;
  completedAt: Date | string;
  customerName?: string | null;
  lineItems: ReceiptEmailLineItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number | null;
  total: number;
  paymentMethodLabel: string;
  fulfillmentMethod: string;
  fulfillmentSummary?: string | null;
  supportEmail: string;
  orderStatusUrl?: string | null;
};

function envEnabled(env: Record<string, string | undefined>, name: string) {
  return env[name]?.trim().toLowerCase() === "true";
}

function envValue(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function receiptEmailFeatureConfig(env: Record<string, string | undefined> = process.env) {
  return {
    storefrontReceiptEmailsEnabled: envEnabled(env, STOREFRONT_RECEIPT_EMAILS_FLAG),
    posReceiptEmailsEnabled: envEnabled(env, POS_RECEIPT_EMAILS_FLAG)
  };
}

export function receiptEmailEnabled(sourceType: ReceiptEmailSourceType, env: Record<string, string | undefined> = process.env) {
  const config = receiptEmailFeatureConfig(env);
  return sourceType === "STOREFRONT_ORDER" ? config.storefrontReceiptEmailsEnabled : config.posReceiptEmailsEnabled;
}

export class ReceiptEmailConfigurationError extends Error {
  code = "RECEIPT_EMAIL_NOT_CONFIGURED";

  constructor(message = "Receipt email is not configured.") {
    super(message);
    this.name = "ReceiptEmailConfigurationError";
  }
}

export function receiptEmailDeliveryAvailable(sourceType: ReceiptEmailSourceType, env: Record<string, string | undefined> = process.env) {
  return receiptEmailEnabled(sourceType, env) && emailProviderConfigured(env);
}

function senderConfigForSource(sourceType: ReceiptEmailSourceType) {
  return sourceType === "STOREFRONT_ORDER"
    ? { envName: STOREFRONT_EMAIL_FROM_ENV, displayName: "GameDayGrabs Orders", profile: "STOREFRONT_ORDER" as const }
    : { envName: POS_RECEIPT_EMAIL_FROM_ENV, displayName: "GameDayGrabs Receipts", profile: "POS_RECEIPT" as const };
}

function extractEmailAddress(value: string) {
  const trimmed = value.trim();
  if (/[\r\n]/.test(trimmed)) return null;
  const bracketMatch = trimmed.match(/^[^<>\r\n]*<([^<>\s]+@[^<>\s]+)>$/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const bareMatch = trimmed.match(/^[^\s<>,;]+@[^\s<>,;]+$/);
  return bareMatch?.[0]?.trim() ?? null;
}

function validMailbox(value: string | null) {
  if (!value) return null;
  const email = extractEmailAddress(value);
  return normalizeReceiptEmail(email) ? email : null;
}

function formatSender(displayName: string, configuredFrom: string) {
  const email = extractEmailAddress(configuredFrom);
  return email ? `${displayName} <${email}>` : null;
}

export function receiptEmailSenderProfile(sourceType: ReceiptEmailSourceType, env: Record<string, string | undefined> = process.env) {
  const config = senderConfigForSource(sourceType);
  const configuredFrom = envValue(env, config.envName);
  const fallbackFrom = envValue(env, "EMAIL_FROM");
  const configuredAddress = configuredFrom ? validMailbox(configuredFrom) : null;
  const fallbackAddress = fallbackFrom ? validMailbox(fallbackFrom) : null;
  const activeFrom = configuredAddress ? formatSender(config.displayName, configuredAddress) : fallbackAddress ? fallbackFrom : null;
  return {
    profile: config.profile,
    displayName: config.displayName,
    address: activeFrom ? extractEmailAddress(activeFrom) : null,
    from: activeFrom,
    configured: Boolean(configuredFrom),
    valid: Boolean(activeFrom),
    profileValueValid: !configuredFrom || Boolean(configuredAddress),
    profileValueInvalid: Boolean(configuredFrom && !configuredAddress),
    fallbackValueValid: Boolean(fallbackAddress),
    usingEmailFromFallback: !configuredAddress && Boolean(fallbackAddress)
  };
}

export function receiptEmailSenderDiagnostics(env: Record<string, string | undefined> = process.env) {
  const storefront = receiptEmailSenderProfile("STOREFRONT_ORDER", env);
  const pos = receiptEmailSenderProfile("POS_SALE", env);
  return {
    storefrontEmailFromConfigured: Boolean(envValue(env, STOREFRONT_EMAIL_FROM_ENV)),
    posReceiptEmailFromConfigured: Boolean(envValue(env, POS_RECEIPT_EMAIL_FROM_ENV)),
    emailFromFallbackConfigured: Boolean(envValue(env, "EMAIL_FROM")),
    replyToConfigured: Boolean(envValue(env, "EMAIL_REPLY_TO")),
    storefront,
    pos,
    domainAuthenticationStatus: emailProviderConfig(env).provider === "resend" ? "manual_check_required" : "not_applicable"
  };
}

export function normalizeReceiptEmail(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function maskReceiptEmail(value: string | null | undefined) {
  const normalized = normalizeReceiptEmail(value);
  if (!normalized) return null;
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function receiptDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })
    : "Date unavailable";
}

function compact(lines: Array<string | null | undefined>) {
  return lines.map((line) => line?.trim()).filter((line): line is string => Boolean(line));
}

function receiptCopy(snapshot: ReceiptEmailSnapshot) {
  return snapshot.sourceType === "STOREFRONT_ORDER"
    ? {
        designation: "Order confirmation",
        subject: `Order confirmed — ${snapshot.receiptNumber}`,
        preheader: "We received your GameDayGrabs order and payment.",
        heading: "Thanks for your order.",
        referenceLabel: "Order number",
        fulfillmentFallback: "Shipping fulfillment"
      }
    : {
        designation: "POS receipt",
        subject: `Your GameDayGrabs receipt — ${snapshot.receiptNumber}`,
        preheader: "Your receipt from GameDayGrabs.",
        heading: "Thanks for your purchase.",
        referenceLabel: "Receipt",
        fulfillmentFallback: "In-person fulfillment"
      };
}

function textReceipt(snapshot: ReceiptEmailSnapshot, testMode = false) {
  const copy = receiptCopy(snapshot);
  return compact([
    testMode ? "TEST RECEIPT" : null,
    testMode ? "No payment was made." : null,
    testMode ? "No order or POS sale was created." : null,
    testMode ? "" : null,
    `GameDayGrabs ${copy.designation}`,
    copy.preheader,
    `${copy.referenceLabel}: ${snapshot.receiptNumber}`,
    `Completed: ${receiptDate(snapshot.completedAt)}`,
    snapshot.customerName ? `Customer: ${snapshot.customerName}` : null,
    "",
    "Items",
    ...snapshot.lineItems.map((item) => `${item.quantity} x ${item.name} @ ${money(item.unitPrice)} = ${money(item.lineTotal)}`),
    "",
    `Subtotal: ${money(snapshot.subtotal)}`,
    snapshot.discount > 0 ? `Discount: -${money(snapshot.discount)}` : `Discount: ${money(0)}`,
    snapshot.shipping > 0 ? `Shipping: ${money(snapshot.shipping)}` : snapshot.sourceType === "STOREFRONT_ORDER" ? `Shipping: ${money(0)}` : null,
    snapshot.tax === null ? "Tax: Not recorded" : `Tax: ${money(snapshot.tax)}`,
    `Total paid: ${money(snapshot.total)}`,
    "",
    `Payment: ${snapshot.paymentMethodLabel}`,
    `Fulfillment: ${snapshot.fulfillmentMethod}`,
    snapshot.fulfillmentSummary,
    snapshot.orderStatusUrl ? `Order status: ${snapshot.orderStatusUrl}` : null,
    `Support: ${snapshot.supportEmail}`,
    testMode ? "This message was sent from the GameDayGrabs administrator receipt preview." : "Thank you for collecting with us."
  ]).join("\n");
}

function summaryRow(label: string, value: string, strong = false) {
  return [
    "<tr>",
    `<td style="padding:6px 0;color:${strong ? "#101828" : "#475467"};font-size:${strong ? "16px" : "14px"};font-weight:${strong ? "900" : "700"};">${htmlEscape(label)}</td>`,
    `<td align="right" style="padding:6px 0;color:${strong ? "#FF6A00" : "#101828"};font-size:${strong ? "16px" : "14px"};font-weight:900;white-space:nowrap;">${htmlEscape(value)}</td>`,
    "</tr>"
  ].join("");
}

function itemRows(snapshot: ReceiptEmailSnapshot) {
  return snapshot.lineItems
    .map((item) =>
      [
        "<tr>",
        `<td style="padding:10px 8px 10px 0;border-bottom:1px solid #EAECF0;"><p style="margin:0;color:#101828;font-size:14px;line-height:1.35;font-weight:800;">${htmlEscape(item.name)}</p><p style="margin:4px 0 0;color:#667085;font-size:13px;line-height:1.35;">Qty ${item.quantity} &times; ${money(item.unitPrice)}</p></td>`,
        `<td align="right" style="padding:10px 0 10px 8px;border-bottom:1px solid #EAECF0;color:#101828;font-size:14px;font-weight:900;white-space:nowrap;">${money(item.lineTotal)}</td>`,
        "</tr>"
      ].join("")
    )
    .join("");
}

export function buildReceiptEmail(snapshot: ReceiptEmailSnapshot, options: { testMode?: boolean } = {}) {
  const copy = receiptCopy(snapshot);
  const subject = options.testMode
    ? snapshot.sourceType === "STOREFRONT_ORDER"
      ? "[TEST] GameDayGrabs order confirmation"
      : "[TEST] GameDayGrabs POS receipt"
    : copy.subject;
  const text = textReceipt(snapshot, Boolean(options.testMode));
  const statusLink = snapshot.orderStatusUrl
    ? `<a href="${htmlEscape(snapshot.orderStatusUrl)}" style="color:#FF6A00;font-weight:900;text-decoration:none;">View order status</a>`
    : "";
  const html = [
    '<!doctype html>',
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><style>body{margin:0;background:#FFF7EB;color:#101828;font-family:Arial,Helvetica,sans-serif}.card{max-width:680px;background:#fff;border:1px solid #D0D5DD;border-radius:20px;overflow:hidden}.content{padding:24px}@media(max-width:480px){.content{padding:18px}.card{border-radius:14px}}</style></head>',
    '<body>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF7EB;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="card">',
    '<tr><td style="padding:20px 24px;border-bottom:1px solid #EAECF0;background:#fff;">',
    '<strong style="font-size:20px;color:#101828;" aria-label="GameDayGrabs">GameDay<span style="color:#FF6A00;">Grabs</span></strong>',
    `<div style="margin-top:4px;color:#667085;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:900;">${htmlEscape(copy.designation)}</div>`,
    '</td></tr>',
    '<tr><td class="content">',
    `<div style="display:none;max-height:0;overflow:hidden;color:#fff;opacity:0;">${htmlEscape(copy.preheader)}</div>`,
    options.testMode
      ? '<div style="margin:0 0 18px;padding:14px;border:2px solid #FF6A00;border-radius:14px;background:#101828;color:#fff;"><strong style="display:block;font-size:16px;">TEST RECEIPT</strong><span style="display:block;margin-top:4px;font-size:13px;font-weight:800;">No payment was made. No order or POS sale was created.</span></div>'
      : "",
    `<h1 style="margin:0;color:#101828;font-size:24px;line-height:1.2;">${htmlEscape(copy.heading)}</h1>`,
    `<p style="margin:8px 0 18px;color:#475467;font-size:15px;line-height:1.55;font-weight:650;">${htmlEscape(copy.referenceLabel)} ${htmlEscape(snapshot.receiptNumber)} was completed ${htmlEscape(receiptDate(snapshot.completedAt))}.</p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #EAECF0;border-radius:14px;border-collapse:separate;margin:14px 0 18px;"><tr><td style="padding:16px;">',
    `<p style="margin:0 0 10px;color:#101828;font-size:15px;font-weight:900;">Purchased items</p>`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${itemRows(snapshot)}</table>`,
    '</td></tr></table>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0;">',
    summaryRow("Subtotal", money(snapshot.subtotal)),
    summaryRow("Discount", snapshot.discount > 0 ? `-${money(snapshot.discount)}` : money(0)),
    snapshot.sourceType === "STOREFRONT_ORDER" || snapshot.shipping > 0 ? summaryRow("Shipping", money(snapshot.shipping)) : "",
    summaryRow("Tax", snapshot.tax === null ? "Not recorded" : money(snapshot.tax)),
    summaryRow("Total paid", money(snapshot.total), true),
    '</table>',
    '<div style="margin:18px 0;padding:16px;border:1px solid #EAECF0;border-radius:14px;background:#FFF9F0;">',
    `<p style="margin:0 0 6px;color:#101828;font-size:14px;font-weight:900;">Payment</p><p style="margin:0 0 12px;color:#475467;font-size:14px;font-weight:700;">${htmlEscape(snapshot.paymentMethodLabel)}</p>`,
    `<p style="margin:0 0 6px;color:#101828;font-size:14px;font-weight:900;">Fulfillment</p><p style="margin:0;color:#475467;font-size:14px;font-weight:700;">${htmlEscape(snapshot.fulfillmentMethod || copy.fulfillmentFallback)}${snapshot.fulfillmentSummary ? ` - ${htmlEscape(snapshot.fulfillmentSummary)}` : ""}</p>`,
    '</div>',
    statusLink ? `<p style="margin:18px 0;">${statusLink}</p>` : "",
    `<p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.5;font-weight:700;">Questions? Email <a href="mailto:${htmlEscape(snapshot.supportEmail)}" style="color:#FF6A00;">${htmlEscape(snapshot.supportEmail)}</a> or visit <a href="https://www.gamedaygrabs.com" style="color:#FF6A00;">gamedaygrabs.com</a>. This receipt contains customer-facing transaction information only.</p>`,
    options.testMode ? '<p style="margin:14px 0 0;color:#667085;font-size:12px;line-height:1.5;font-weight:800;">This message was sent from the GameDayGrabs administrator receipt preview.</p>' : "",
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>'
  ].join("");
  return { subject, text, html };
}

function sourcePrefix(sourceType: ReceiptEmailSourceType) {
  if (sourceType === "STOREFRONT_ORDER") return "storefront";
  if (sourceType === "POS_SALE") return "pos";
  return "admin_preview";
}

function deliveryToDTO(delivery: {
  status: string;
  deliveryType: string;
  recipientEmailMasked: string;
  sentAt: Date | null;
  lastAttemptAt: Date | null;
  attemptCount: number;
  sanitizedFailureCode: string | null;
  sanitizedFailureMessage: string | null;
}): ReceiptEmailDeliveryDTO {
  return {
    status: delivery.status === "SENT" || delivery.status === "FAILED" || delivery.status === "PENDING" ? delivery.status : "PENDING",
    deliveryType: delivery.deliveryType === "PREVIEW" ? "PREVIEW" : delivery.deliveryType === "RESEND" ? "RESEND" : "INITIAL",
    maskedRecipient: delivery.recipientEmailMasked,
    sentAt: delivery.sentAt?.toISOString() ?? null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    attemptCount: delivery.attemptCount,
    sanitizedFailureCode: delivery.sanitizedFailureCode,
    sanitizedFailureMessage: delivery.sanitizedFailureMessage
  };
}

export function notRequestedReceiptEmailDelivery(): ReceiptEmailDeliveryDTO {
  return {
    status: "NOT_REQUESTED",
    deliveryType: null,
    maskedRecipient: null,
    sentAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    sanitizedFailureCode: null,
    sanitizedFailureMessage: null
  };
}

export function fallbackReceiptEmailDelivery(input: {
  status: Exclude<ReceiptEmailDeliveryStatus, "NOT_REQUESTED">;
  deliveryType: ReceiptEmailDeliveryType;
  recipientEmail?: string | null;
  sanitizedFailureCode?: string | null;
  sanitizedFailureMessage?: string | null;
  sentAt?: Date | null;
  attemptCount?: number;
}): ReceiptEmailDeliveryDTO {
  const sentAt = input.sentAt?.toISOString() ?? null;
  return {
    status: input.status,
    deliveryType: input.deliveryType,
    maskedRecipient: maskReceiptEmail(input.recipientEmail) ?? null,
    sentAt,
    lastAttemptAt: sentAt ?? new Date().toISOString(),
    attemptCount: input.attemptCount ?? 1,
    sanitizedFailureCode: input.sanitizedFailureCode ?? null,
    sanitizedFailureMessage: input.sanitizedFailureMessage ?? null
  };
}

export async function latestReceiptEmailDelivery(sourceType: ReceiptEmailSourceType, sourceId: string) {
  const delivery = await prisma.receiptEmailDelivery.findFirst({
    where: { sourceType, sourceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  return delivery ? deliveryToDTO(delivery) : notRequestedReceiptEmailDelivery();
}

async function createDeliveryClaim(input: {
  sourceType: ReceiptEmailSourceType;
  sourceId: string;
  recipientEmail: string;
  deliveryType: ReceiptEmailDeliveryType;
  idempotencyKey: string;
  requestedByUserId?: string | null;
}): Promise<ReceiptEmailDeliveryRecord> {
  const normalized = normalizeReceiptEmail(input.recipientEmail);
  if (!normalized) throw new Error("Enter a valid receipt email address.");
  const masked = maskReceiptEmail(normalized) ?? "***";
  try {
    return await prisma.receiptEmailDelivery.create({
      data: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        recipientEmailNormalized: normalized,
        recipientEmailMasked: masked,
        deliveryType: input.deliveryType,
        idempotencyKey: input.idempotencyKey,
        requestedByUserId: input.requestedByUserId ?? null
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.receiptEmailDelivery.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
    }
    throw error;
  }
}

async function claimDeliveryAttempt(id: string) {
  const result = await prisma.receiptEmailDelivery.updateMany({
    where: { id, status: "PENDING", attemptCount: 0 },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date()
    }
  });
  return result.count;
}

async function findDeliveryById(id: string): Promise<ReceiptEmailDeliveryRecord | null> {
  return prisma.receiptEmailDelivery.findUnique({ where: { id } });
}

async function markDeliveryResult(input: {
  id: string;
  status: "SENT" | "FAILED";
  providerMessageId?: string | null;
  sentAt?: Date | null;
  sanitizedFailureCode?: string | null;
  sanitizedFailureMessage?: string | null;
}): Promise<ReceiptEmailDeliveryRecord> {
  return prisma.receiptEmailDelivery.update({
    where: { id: input.id },
    data: {
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      sentAt: input.sentAt ?? null,
      sanitizedFailureCode: input.sanitizedFailureCode ?? null,
      sanitizedFailureMessage: input.sanitizedFailureMessage ?? null
    }
  });
}

export const prismaReceiptEmailDeliveryStore: ReceiptEmailDeliveryAttemptStore = {
  createOrGetClaim: createDeliveryClaim,
  claimAttempt: claimDeliveryAttempt,
  findById: findDeliveryById,
  markResult: markDeliveryResult
};

function receiptEmailHeaders(input: { sourceType: ReceiptEmailSourceType; receiptNumber: string; deliveryType: ReceiptEmailDeliveryType }) {
  return {
    "X-Entity-Ref-ID": `gdd:${input.receiptNumber}:receipt`,
    "X-GDD-Notification-Type": input.sourceType === "ADMIN_PREVIEW" ? "receipt_preview" : input.sourceType === "STOREFRONT_ORDER" ? "storefront_receipt" : "pos_receipt",
    "X-GDD-Order-Number": input.receiptNumber
  };
}

function receiptEmailTags(input: { sourceType: ReceiptEmailSourceType; receiptNumber: string; deliveryType: ReceiptEmailDeliveryType }) {
  return [
    { name: "orderNumber", value: input.receiptNumber },
    { name: "notificationType", value: input.sourceType === "ADMIN_PREVIEW" ? "receiptPreview" : input.sourceType === "STOREFRONT_ORDER" ? "storefrontReceipt" : "posReceipt" },
    { name: "environment", value: process.env.VERCEL_ENV || process.env.NODE_ENV || "development" }
  ];
}

export type ReceiptEmailDeliveryAttemptInput = {
  sourceType: ReceiptEmailSourceType;
  sourceId: string;
  recipientEmail: string;
  deliveryType: ReceiptEmailDeliveryType;
  idempotencyKey: string;
  snapshot: ReceiptEmailSnapshot;
  senderFrom?: string | null;
  requestedByUserId?: string | null;
  requestId?: string | null;
};

export type ReceiptEmailDeliveryAttemptDeps = {
  store: ReceiptEmailDeliveryAttemptStore;
  render: (snapshot: ReceiptEmailSnapshot) => ReturnType<typeof buildReceiptEmail>;
  send: (message: EmailMessage, options: { idempotencyKey: string }) => Promise<EmailSendResult>;
  audit?: (input: {
    userId?: string | null;
    action: string;
    entityType: ReceiptEmailSourceType;
    entityId: string;
    summary: string;
    requestId?: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  providerName?: string;
};

function statusUnavailableDelivery(input: {
  deliveryType: ReceiptEmailDeliveryType;
  recipientEmail: string;
  sentAt?: Date | null;
  message: string;
}) {
  return fallbackReceiptEmailDelivery({
    status: "PENDING",
    deliveryType: input.deliveryType,
    recipientEmail: input.recipientEmail,
    sentAt: input.sentAt ?? null,
    attemptCount: 1,
    sanitizedFailureCode: "RECEIPT_EMAIL_STATUS_UNAVAILABLE",
    sanitizedFailureMessage: input.message
  });
}

export async function runReceiptEmailDeliveryAttempt(
  input: ReceiptEmailDeliveryAttemptInput,
  deps: ReceiptEmailDeliveryAttemptDeps
): Promise<ReceiptEmailDeliveryDTO> {
  const delivery = await deps.store.createOrGetClaim({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    recipientEmail: input.recipientEmail,
    deliveryType: input.deliveryType,
    idempotencyKey: input.idempotencyKey,
    requestedByUserId: input.requestedByUserId
  });
  if (delivery.status === "SENT" || delivery.status === "FAILED" || delivery.attemptCount > 0) return deliveryToDTO(delivery);

  const claimed = await deps.store.claimAttempt(delivery.id);
  if (claimed !== 1) {
    const current = await deps.store.findById(delivery.id);
    return current
      ? deliveryToDTO(current)
      : statusUnavailableDelivery({
          deliveryType: input.deliveryType,
          recipientEmail: input.recipientEmail,
          message: "Receipt email delivery status could not be loaded."
        });
  }

  const claimedDelivery = (await deps.store.findById(delivery.id)) ?? { ...delivery, attemptCount: 1, lastAttemptAt: new Date() };
  const prefix = sourcePrefix(input.sourceType);
  if (input.deliveryType === "INITIAL" && input.sourceType === "POS_SALE") {
    try {
      await deps.audit?.({
        userId: input.requestedByUserId ?? null,
        action: "pos.receipt_email.requested",
        entityType: input.sourceType,
        entityId: input.sourceId,
        summary: `POS receipt email requested for ${input.snapshot.receiptNumber}.`,
        requestId: input.requestId,
        metadata: { receiptNumber: input.snapshot.receiptNumber, maskedEmail: delivery.recipientEmailMasked, deliveryStatus: "PENDING", attemptNumber: 1 }
      });
    } catch {
      // Receipt audit logging is best-effort; it must never fail a completed sale.
    }
  }

  let rendered: ReturnType<typeof buildReceiptEmail>;
  try {
    rendered = deps.render(input.snapshot);
  } catch {
    try {
      const updated = await deps.store.markResult({
        id: delivery.id,
        status: "FAILED",
        sanitizedFailureCode: "RECEIPT_EMAIL_RENDER_FAILED",
        sanitizedFailureMessage: "Receipt email could not be prepared."
      });
      return deliveryToDTO(updated);
    } catch {
      return statusUnavailableDelivery({
        deliveryType: input.deliveryType,
        recipientEmail: input.recipientEmail,
        message: "Receipt email delivery status could not be saved."
      });
    }
  }

  const message: EmailMessage = {
    to: input.recipientEmail,
    from: input.senderFrom ?? receiptEmailSenderProfile(input.sourceType).from ?? undefined,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers: receiptEmailHeaders({ sourceType: input.sourceType, receiptNumber: input.snapshot.receiptNumber, deliveryType: input.deliveryType }),
    tags: receiptEmailTags({ sourceType: input.sourceType, receiptNumber: input.snapshot.receiptNumber, deliveryType: input.deliveryType })
  };
  const sendResult = await deps.send(message, { idempotencyKey: input.idempotencyKey });
  const status = sendResult.status === "sent" ? "SENT" : "FAILED";
  let updated: ReceiptEmailDeliveryRecord;
  try {
    updated = await deps.store.markResult({
      id: delivery.id,
      status,
      providerMessageId: sendResult.providerMessageId,
      sentAt: sendResult.sentAt,
      sanitizedFailureCode: sendResult.status === "sent" ? null : sendResult.status === "not_configured" ? "EMAIL_PROVIDER_NOT_CONFIGURED" : "EMAIL_PROVIDER_FAILED",
      sanitizedFailureMessage: sendResult.status === "sent" ? null : sendResult.failureReason ?? sendResult.detail
    });
  } catch {
    return statusUnavailableDelivery({
      deliveryType: input.deliveryType,
      recipientEmail: input.recipientEmail,
      message:
        sendResult.status === "sent"
          ? "The email provider accepted the receipt, but final delivery status could not be saved."
          : "Receipt email delivery status could not be saved."
    });
  }

  try {
    await deps.audit?.({
      userId: input.requestedByUserId ?? null,
      action: `${prefix}.receipt_email.${input.deliveryType === "RESEND" && status === "SENT" ? "resent" : status === "SENT" ? "sent" : "failed"}`,
      entityType: input.sourceType,
      entityId: input.sourceId,
      summary: `${input.sourceType === "STOREFRONT_ORDER" ? "Storefront" : "POS"} receipt email ${status === "SENT" ? "sent" : "failed"} for ${input.snapshot.receiptNumber}.`,
      requestId: input.requestId,
      metadata: {
        receiptNumber: input.snapshot.receiptNumber,
        deliveryStatus: status,
        maskedEmail: claimedDelivery.recipientEmailMasked,
        attemptNumber: updated.attemptCount,
        provider: deps.providerName ?? "none"
      }
    });
  } catch {
    // Receipt audit logging is best-effort; delivery result remains authoritative.
  }
  return deliveryToDTO(updated);
}

export async function requestReceiptEmailDelivery(input: {
  sourceType: ReceiptEmailSourceType;
  sourceId: string;
  recipientEmail: string | null | undefined;
  deliveryType: ReceiptEmailDeliveryType;
  idempotencyKey: string;
  snapshot: ReceiptEmailSnapshot;
  requestedByUserId?: string | null;
  requestId?: string | null;
  env?: EmailSendOptions["env"];
  fetchImpl?: EmailSendOptions["fetchImpl"];
}): Promise<ReceiptEmailDeliveryDTO> {
  const normalized = normalizeReceiptEmail(input.recipientEmail);
  if (!normalized) return notRequestedReceiptEmailDelivery();
  if (!receiptEmailDeliveryAvailable(input.sourceType, input.env ?? process.env)) {
    throw new ReceiptEmailConfigurationError();
  }

  const providerConfig = emailProviderConfig(input.env ?? process.env);
  return runReceiptEmailDeliveryAttempt(
    {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      recipientEmail: normalized,
      deliveryType: input.deliveryType,
      idempotencyKey: input.idempotencyKey,
      snapshot: input.snapshot,
      senderFrom: receiptEmailSenderProfile(input.sourceType, input.env ?? process.env).from,
      requestedByUserId: input.requestedByUserId,
      requestId: input.requestId
    },
    {
      store: prismaReceiptEmailDeliveryStore,
      render: buildReceiptEmail,
      send: (message, options) =>
        sendEmailViaProvider(message, {
          env: input.env,
          fetchImpl: input.fetchImpl,
          idempotencyKey: options.idempotencyKey
        }),
      audit: logAudit,
      providerName: providerConfig.provider
    }
  );
}

export async function attachPosReceiptEmailDeliveryResult<TReceipt extends { saleReference: string; receiptEmailDelivery: ReceiptEmailDeliveryDTO }>(input: {
  receipt: TReceipt;
  requestedReceiptEmail: string | null | undefined;
  snapshot: ReceiptEmailSnapshot;
  requestedByUserId: string;
  requestId?: string | null;
  requestDelivery?: typeof requestReceiptEmailDelivery;
}): Promise<TReceipt> {
  if (!input.requestedReceiptEmail) return input.receipt;
  const requestDelivery = input.requestDelivery ?? requestReceiptEmailDelivery;
  try {
    const delivery = await requestDelivery({
      sourceType: "POS_SALE",
      sourceId: input.receipt.saleReference,
      recipientEmail: input.requestedReceiptEmail,
      deliveryType: "INITIAL",
      idempotencyKey: `receipt:pos:initial:${input.receipt.saleReference}:${input.requestedReceiptEmail}`,
      snapshot: input.snapshot,
      requestedByUserId: input.requestedByUserId,
      requestId: input.requestId
    });
    return { ...input.receipt, receiptEmailDelivery: delivery };
  } catch {
    return {
      ...input.receipt,
      receiptEmailDelivery: fallbackReceiptEmailDelivery({
        status: "FAILED",
        deliveryType: "INITIAL",
        recipientEmail: input.requestedReceiptEmail,
        sanitizedFailureCode: "RECEIPT_EMAIL_UNAVAILABLE",
        sanitizedFailureMessage: "The sale completed, but the receipt email could not be sent."
      })
    };
  }
}
