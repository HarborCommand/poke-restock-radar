import type { SessionUser } from "@/types/radar";
import { logAudit } from "@/lib/audit";
import { emailProviderConfig, sendEmailViaProvider, type EmailMessage, type EmailSendOptions, type EmailSendResult } from "@/lib/email-provider";
import {
  buildReceiptEmail,
  maskReceiptEmail,
  normalizeReceiptEmail,
  receiptEmailSenderDiagnostics,
  receiptEmailSenderProfile,
  type ReceiptEmailPreviewType,
  type ReceiptEmailSnapshot,
  type ReceiptEmailSourceType
} from "@/lib/receipt-email";

type PreviewSendResult = {
  previewType: ReceiptEmailPreviewType;
  status: EmailSendResult["status"];
  provider: EmailSendResult["provider"];
  maskedRecipient: string;
  requestId: string | null;
  idempotencyKey: string;
  reused: boolean;
};

type PreviewSendDeps = {
  env?: EmailSendOptions["env"];
  fetchImpl?: EmailSendOptions["fetchImpl"];
  now?: Date;
  send?: (message: EmailMessage, options: { idempotencyKey: string }) => Promise<EmailSendResult>;
  audit?: typeof logAudit;
};

const previewDedup = new Map<string, { createdAt: number; result: PreviewSendResult }>();
const previewDedupTtlMs = 5 * 60 * 1000;

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function completedAt() {
  return "2026-07-28T16:30:00.000Z";
}

function sourceTypeForPreview(previewType: ReceiptEmailPreviewType): ReceiptEmailSourceType {
  return previewType === "storefront" ? "STOREFRONT_ORDER" : "POS_SALE";
}

export function receiptEmailPreviewFixtures(): Record<ReceiptEmailPreviewType, ReceiptEmailSnapshot> {
  return {
    storefront: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-20260728",
      completedAt: completedAt(),
      customerName: "Preview Customer",
      lineItems: [
        { name: "Pokémon TCG: Mega Evolution Booster Bundle", quantity: 2, unitPrice: 39.99, lineTotal: 79.98 },
        { name: "Ultra PRO 9-Pocket Trading Card Pages", quantity: 3, unitPrice: 4.99, lineTotal: 14.97 }
      ],
      subtotal: 94.95,
      discount: 5,
      shipping: 6.99,
      tax: 6.79,
      total: 103.73,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Shipping",
      fulfillmentSummary: "Ships after fulfillment is prepared.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status"
    },
    pos: {
      sourceType: "POS_SALE",
      receiptNumber: "TEST-POS-20260728",
      completedAt: completedAt(),
      customerName: "Preview Guest",
      lineItems: [
        { name: "Pokémon TCG: Scarlet & Violet Booster Pack", quantity: 4, unitPrice: 4.49, lineTotal: 17.96 },
        { name: "GameDayGrabs Soft Card Sleeves Pack", quantity: 2, unitPrice: 2.99, lineTotal: 5.98 }
      ],
      subtotal: 23.94,
      discount: 2,
      shipping: 0,
      tax: 1.65,
      total: 23.59,
      paymentMethodLabel: "In-person payment",
      fulfillmentMethod: "In-person pickup",
      fulfillmentSummary: "Completed at the register.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: null
    }
  };
}

export function buildReceiptEmailPreview(previewType: ReceiptEmailPreviewType, env: EmailSendOptions["env"] = process.env) {
  const snapshot = receiptEmailPreviewFixtures()[previewType];
  const sourceType = sourceTypeForPreview(previewType);
  const rendered = buildReceiptEmail(snapshot, { testMode: true });
  const sender = receiptEmailSenderProfile(sourceType, env);
  const diagnostics = receiptEmailSenderDiagnostics(env);
  return {
    previewType,
    subject: rendered.subject,
    sender: {
      displayName: sender.displayName,
      address: sender.address,
      from: sender.from,
      configured: sender.configured,
      usingEmailFromFallback: sender.usingEmailFromFallback
    },
    replyToConfigured: diagnostics.replyToConfigured,
    html: rendered.html,
    text: rendered.text,
    totals: {
      subtotal: money(snapshot.subtotal),
      discount: money(snapshot.discount),
      shipping: money(snapshot.shipping),
      tax: snapshot.tax === null ? "Not recorded" : money(snapshot.tax),
      total: money(snapshot.total)
    }
  };
}

function cleanupPreviewDedup(now: Date) {
  const cutoff = now.getTime() - previewDedupTtlMs;
  for (const [key, value] of previewDedup.entries()) {
    if (value.createdAt < cutoff) previewDedup.delete(key);
  }
}

export function previewTestIdempotencyKey(userId: string, previewType: ReceiptEmailPreviewType, now = new Date()) {
  const bucket = Math.floor(now.getTime() / 60_000);
  return `receipt-preview:${userId}:${previewType}:${bucket}`;
}

export function resetReceiptEmailPreviewDedupForTests() {
  previewDedup.clear();
}

export async function sendReceiptEmailPreviewToAdmin(input: {
  user: SessionUser;
  previewType: ReceiptEmailPreviewType;
  requestId?: string | null;
}, deps: PreviewSendDeps = {}): Promise<PreviewSendResult> {
  const recipient = normalizeReceiptEmail(input.user.email);
  if (!recipient) throw new Error("Administrator account must have a valid email address before sending a receipt preview.");

  const now = deps.now ?? new Date();
  cleanupPreviewDedup(now);
  const idempotencyKey = previewTestIdempotencyKey(input.user.id, input.previewType, now);
  const existing = previewDedup.get(idempotencyKey);
  if (existing) return { ...existing.result, reused: true };

  const sourceType = sourceTypeForPreview(input.previewType);
  const preview = buildReceiptEmailPreview(input.previewType, deps.env);
  const message: EmailMessage = {
    to: recipient,
    from: preview.sender.from ?? undefined,
    subject: preview.subject,
    text: preview.text,
    html: preview.html,
    headers: {
      "X-Entity-Ref-ID": `gdd:receipt-preview:${input.previewType}`,
      "X-GDD-Notification-Type": "receipt_preview",
      "X-GDD-Order-Number": input.previewType === "storefront" ? "TEST-GDD-20260728" : "TEST-POS-20260728"
    },
    tags: [
      { name: "notificationType", value: "receiptPreview" },
      { name: "environment", value: process.env.VERCEL_ENV || process.env.NODE_ENV || "development" },
      { name: "previewType", value: input.previewType }
    ]
  };
  const providerConfig = emailProviderConfig(deps.env ?? process.env);
  const send = deps.send ?? ((emailMessage, options) => sendEmailViaProvider(emailMessage, { env: deps.env, fetchImpl: deps.fetchImpl, idempotencyKey: options.idempotencyKey }));
  const sendResult = await send(message, { idempotencyKey });
  const result: PreviewSendResult = {
    previewType: input.previewType,
    status: sendResult.status,
    provider: sendResult.provider,
    maskedRecipient: maskReceiptEmail(recipient) ?? "***",
    requestId: input.requestId ?? null,
    idempotencyKey,
    reused: false
  };
  previewDedup.set(idempotencyKey, { createdAt: now.getTime(), result });

  try {
    await (deps.audit ?? logAudit)({
      user: input.user,
      action: `admin.receipt_email_preview.${sendResult.status === "sent" ? "sent" : "failed"}`,
      entityType: "RECEIPT_EMAIL_PREVIEW",
      entityId: input.user.id,
      summary: `Administrator receipt preview ${sendResult.status === "sent" ? "sent" : "failed"} for ${input.previewType}.`,
      requestId: input.requestId,
      metadata: {
        previewType: input.previewType,
        maskedRecipient: result.maskedRecipient,
        provider: providerConfig.provider,
        status: sendResult.status,
        sourceType
      }
    });
  } catch {
    // Preview audit is best-effort and must not turn this into an order, sale, or blocking workflow.
  }

  return result;
}
