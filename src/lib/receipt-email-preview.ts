import type { SessionUser } from "@/types/radar";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { emailProviderConfig, sendEmailViaProvider, type EmailMessage, type EmailSendOptions, type EmailSendResult } from "@/lib/email-provider";
import {
  buildReceiptEmail,
  maskReceiptEmail,
  normalizeReceiptEmail,
  prismaReceiptEmailDeliveryStore,
  receiptEmailSenderDiagnostics,
  receiptEmailSenderProfile,
  runReceiptEmailDeliveryAttempt,
  type ReceiptEmailDeliveryAttemptStore,
  type ReceiptEmailDeliveryDTO,
  type ReceiptEmailPreviewType,
  type ReceiptEmailSnapshot,
  type ReceiptEmailSourceType
} from "@/lib/receipt-email";

export type ReceiptPreviewSendStatus = "SENT" | "FAILED" | "NOT_CONFIGURED" | "UNCERTAIN";
export type ReceiptPreviewFixtureKey =
  | "storefront_linked_rewards"
  | "pos_linked_rewards"
  | "linked_pending_rewards"
  | "storefront_later_authorized_resend"
  | "guest_unlinked"
  | "pos_recipient_mismatch"
  | "rewards_disabled"
  | "storefront_partial_reversal"
  | "storefront_full_reversal"
  | "pos_partial_reversal"
  | "pos_full_reversal";

export type PreviewSendResult = {
  previewType: ReceiptEmailPreviewType;
  status: ReceiptPreviewSendStatus;
  provider: EmailSendResult["provider"];
  maskedRecipient: string;
  reused: boolean;
  sentAt: string | null;
  safeFailureCode: string | null;
  safeFailureMessage: string | null;
};

type PreviewSendDeps = {
  env?: EmailSendOptions["env"];
  fetchImpl?: EmailSendOptions["fetchImpl"];
  send?: (message: EmailMessage, options: { idempotencyKey: string }) => Promise<EmailSendResult>;
  audit?: typeof logAudit;
  store?: ReceiptEmailDeliveryAttemptStore;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function completedAt() {
  return "2026-07-28T16:30:00.000Z";
}

function sourceTypeForPreview(previewType: ReceiptEmailPreviewType): Exclude<ReceiptEmailSourceType, "ADMIN_PREVIEW"> {
  return previewType === "storefront" ? "STOREFRONT_ORDER" : "POS_SALE";
}

function receiptNumberForPreview(previewType: ReceiptEmailPreviewType) {
  return previewType === "storefront" ? "TEST-GDD-20260728" : "TEST-POS-20260728";
}

export const receiptEmailPreviewFixtureOptions: Array<{
  key: ReceiptPreviewFixtureKey;
  previewType: ReceiptEmailPreviewType;
  label: string;
  description: string;
}> = [
  {
    key: "storefront_linked_rewards",
    previewType: "storefront",
    label: "Storefront linked account with points earned",
    description: "Verified linked account; receipt recipient matches; persisted storefront reward result exists."
  },
  {
    key: "pos_linked_rewards",
    previewType: "pos",
    label: "POS linked account with points earned",
    description: "Selected POS customer; receipt recipient matches; persisted POS reward result exists."
  },
  {
    key: "linked_pending_rewards",
    previewType: "storefront",
    label: "Linked account with pending points",
    description: "Verified linked account with authoritative pending points greater than zero."
  },
  {
    key: "storefront_later_authorized_resend",
    previewType: "storefront",
    label: "Later authorized resend with current balances",
    description: "Untouched award remains valid; account-wide balances are labeled as current values."
  },
  {
    key: "guest_unlinked",
    previewType: "storefront",
    label: "Guest/unlinked receipt with no reward block",
    description: "Ordinary guest receipt only; no account reward details are displayed."
  },
  {
    key: "pos_recipient_mismatch",
    previewType: "pos",
    label: "POS selected customer, different receipt email",
    description: "Receipt destination differs from the linked account email, so account rewards are omitted."
  },
  {
    key: "rewards_disabled",
    previewType: "storefront",
    label: "Rewards earning disabled",
    description: "Ordinary receipt only; reward earning is disabled."
  },
  {
    key: "storefront_partial_reversal",
    previewType: "storefront",
    label: "Storefront partial refund/reward reversed",
    description: "Ordinary receipt only; partial reward reversal suppresses stale account reward details."
  },
  {
    key: "storefront_full_reversal",
    previewType: "storefront",
    label: "Storefront full refund/reward reversed",
    description: "Ordinary receipt only; full reward reversal suppresses stale account reward details."
  },
  {
    key: "pos_partial_reversal",
    previewType: "pos",
    label: "POS partial refund/reward reversed",
    description: "Ordinary receipt only; partial POS reward reversal suppresses stale account reward details."
  },
  {
    key: "pos_full_reversal",
    previewType: "pos",
    label: "POS full refund/reward reversed",
    description: "Ordinary receipt only; full POS reward reversal suppresses stale account reward details."
  }
];

function previewFixtureOption(key: ReceiptPreviewFixtureKey) {
  return receiptEmailPreviewFixtureOptions.find((option) => option.key === key) ?? receiptEmailPreviewFixtureOptions[0];
}

function defaultFixtureForPreview(previewType: ReceiptEmailPreviewType): ReceiptPreviewFixtureKey {
  return previewType === "storefront" ? "storefront_linked_rewards" : "pos_linked_rewards";
}

export function previewSourceId(userId: string, previewType: ReceiptEmailPreviewType) {
  return `admin:${userId}:receipt-preview:${previewType}`;
}

export function previewTestIdempotencyKey(userId: string, previewType: ReceiptEmailPreviewType, previewRequestId: string) {
  if (!uuidPattern.test(previewRequestId)) throw new Error("Receipt preview request token must be a valid UUID.");
  return `receipt-preview:${userId}:${previewType}:${previewRequestId.toLowerCase()}`;
}

export function receiptEmailPreviewFixtures(): Record<ReceiptPreviewFixtureKey, ReceiptEmailSnapshot> {
  return {
    storefront_linked_rewards: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: receiptNumberForPreview("storefront"),
      completedAt: completedAt(),
      customerName: "Linked Preview Customer",
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
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: {
        pointsEarned: 94,
        availableBalance: 3905,
        pendingBalance: 94,
        rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
      }
    },
    pos_linked_rewards: {
      sourceType: "POS_SALE",
      receiptNumber: receiptNumberForPreview("pos"),
      completedAt: completedAt(),
      customerName: "Linked POS Customer",
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
      orderStatusUrl: null,
      rewardSummary: {
        pointsEarned: 21,
        availableBalance: 3926,
        pendingBalance: 0,
        rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
      }
    },
    linked_pending_rewards: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-PENDING",
      completedAt: completedAt(),
      customerName: "Pending Points Customer",
      lineItems: [
        { name: "PokÃ©mon TCG: Long Name Collector Bundle With Binder, Sleeves, and Booster Packs", quantity: 1, unitPrice: 124.99, lineTotal: 124.99 }
      ],
      subtotal: 124.99,
      discount: 0,
      shipping: 0,
      tax: 8.75,
      total: 133.74,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Local Pickup",
      fulfillmentSummary: "Pickup details will appear in your order updates.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: {
        pointsEarned: 124,
        availableBalance: 8012,
        pendingBalance: 124,
        rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
      }
    },
    storefront_later_authorized_resend: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-RESEND",
      completedAt: completedAt(),
      customerName: "Linked Preview Customer",
      lineItems: [
        { name: "PokÃ©mon TCG: Booster Bundle", quantity: 1, unitPrice: 39.99, lineTotal: 39.99 }
      ],
      subtotal: 39.99,
      discount: 0,
      shipping: 6.99,
      tax: 3.52,
      total: 50.5,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Shipping",
      fulfillmentSummary: "Ships after fulfillment is prepared.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: {
        pointsEarned: 39,
        availableBalance: 4200,
        pendingBalance: 0,
        rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
      }
    },
    guest_unlinked: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-GUEST",
      completedAt: completedAt(),
      customerName: "Preview Guest",
      lineItems: [{ name: "PokÃ©mon TCG: Mega Moonlit Tin", quantity: 1, unitPrice: 39.99, lineTotal: 39.99 }],
      subtotal: 39.99,
      discount: 0,
      shipping: 6.99,
      tax: 3.34,
      total: 50.32,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Shipping",
      fulfillmentSummary: "Ships after fulfillment is prepared.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: null
    },
    pos_recipient_mismatch: {
      sourceType: "POS_SALE",
      receiptNumber: "TEST-POS-MISMATCH",
      completedAt: completedAt(),
      customerName: "Selected Customer",
      lineItems: [{ name: "PokÃ©mon TCG: Scarlet & Violet Booster Pack", quantity: 2, unitPrice: 4.49, lineTotal: 8.98 }],
      subtotal: 8.98,
      discount: 0,
      shipping: 0,
      tax: 0.67,
      total: 9.65,
      paymentMethodLabel: "In-person payment",
      fulfillmentMethod: "In-person pickup",
      fulfillmentSummary: "Completed at the register.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: null,
      rewardSummary: null
    },
    rewards_disabled: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-REWARDS-OFF",
      completedAt: completedAt(),
      customerName: "Linked Preview Customer",
      lineItems: [{ name: "Ultra PRO 9-Pocket Trading Card Pages", quantity: 5, unitPrice: 4.99, lineTotal: 24.95 }],
      subtotal: 24.95,
      discount: 0,
      shipping: 0,
      tax: 1.87,
      total: 26.82,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Local Pickup",
      fulfillmentSummary: "Pickup details will appear in your order updates.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: null
    },
    storefront_partial_reversal: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-PARTIAL-REFUND",
      completedAt: completedAt(),
      customerName: "Linked Preview Customer",
      lineItems: [{ name: "PokÃ©mon TCG: Booster Bundle", quantity: 2, unitPrice: 39.99, lineTotal: 79.98 }],
      subtotal: 79.98,
      discount: 0,
      shipping: 6.99,
      tax: 6.09,
      total: 93.06,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Shipping",
      fulfillmentSummary: "Ships after fulfillment is prepared.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: null
    },
    storefront_full_reversal: {
      sourceType: "STOREFRONT_ORDER",
      receiptNumber: "TEST-GDD-FULL-REFUND",
      completedAt: completedAt(),
      customerName: "Linked Preview Customer",
      lineItems: [{ name: "PokÃ©mon TCG: Mega Moonlit Tin", quantity: 1, unitPrice: 39.99, lineTotal: 39.99 }],
      subtotal: 39.99,
      discount: 0,
      shipping: 6.99,
      tax: 3.34,
      total: 50.32,
      paymentMethodLabel: "Paid online",
      fulfillmentMethod: "Shipping",
      fulfillmentSummary: "Order was later refunded; this preview keeps the ordinary receipt only.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: "https://www.gamedaygrabs.com/order-status",
      rewardSummary: null
    },
    pos_partial_reversal: {
      sourceType: "POS_SALE",
      receiptNumber: "TEST-POS-PARTIAL-REFUND",
      completedAt: completedAt(),
      customerName: "Linked POS Customer",
      lineItems: [{ name: "PokÃ©mon TCG: Scarlet & Violet Booster Pack", quantity: 4, unitPrice: 4.49, lineTotal: 17.96 }],
      subtotal: 17.96,
      discount: 0,
      shipping: 0,
      tax: 1.35,
      total: 19.31,
      paymentMethodLabel: "In-person payment",
      fulfillmentMethod: "In-person pickup",
      fulfillmentSummary: "Completed at the register.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: null,
      rewardSummary: null
    },
    pos_full_reversal: {
      sourceType: "POS_SALE",
      receiptNumber: "TEST-POS-FULL-REFUND",
      completedAt: completedAt(),
      customerName: "Linked POS Customer",
      lineItems: [{ name: "GameDayGrabs Soft Card Sleeves Pack", quantity: 2, unitPrice: 2.99, lineTotal: 5.98 }],
      subtotal: 5.98,
      discount: 0,
      shipping: 0,
      tax: 0.45,
      total: 6.43,
      paymentMethodLabel: "In-person payment",
      fulfillmentMethod: "In-person pickup",
      fulfillmentSummary: "Completed at the register.",
      supportEmail: "gamedaygrabs@outlook.com",
      orderStatusUrl: null,
      rewardSummary: null
    }
  };
}

function sendReadiness(previewType: ReceiptEmailPreviewType, adminEmail: string | null | undefined, env: EmailSendOptions["env"] = process.env) {
  const provider = emailProviderConfig(env);
  const sender = receiptEmailSenderProfile(sourceTypeForPreview(previewType), env);
  const adminRecipient = normalizeReceiptEmail(adminEmail);
  const reasons = [
    !provider.configured ? "Receipt email provider is not configured." : null,
    !sender.valid ? "No valid sender is configured for this receipt preview." : null,
    !adminRecipient ? "Your administrator account needs a valid email before sending a test receipt." : null
  ].filter((reason): reason is string => Boolean(reason));
  return {
    ready: reasons.length === 0,
    reasons,
    providerConfigured: provider.configured,
    provider: provider.provider,
    selectedSenderPresent: Boolean(sender.from),
    selectedSenderValid: sender.valid,
    selectedSenderUsesProfile: sender.valid && !sender.usingEmailFromFallback,
    selectedSenderUsesFallback: sender.usingEmailFromFallback,
    profileValueInvalid: sender.profileValueInvalid,
    replyToConfigured: receiptEmailSenderDiagnostics(env).replyToConfigured,
    domainAuthenticationStatus: provider.provider === "resend" ? "manual_check_required" : "not_applicable"
  };
}

export function buildReceiptEmailPreview(
  previewType: ReceiptEmailPreviewType,
  env: EmailSendOptions["env"] = process.env,
  adminEmail?: string | null,
  fixtureKey: ReceiptPreviewFixtureKey = defaultFixtureForPreview(previewType)
) {
  const option = previewFixtureOption(fixtureKey);
  const snapshot = receiptEmailPreviewFixtures()[fixtureKey];
  const sourceType = sourceTypeForPreview(previewType);
  const rendered = buildReceiptEmail(snapshot, { testMode: true });
  const sender = receiptEmailSenderProfile(sourceType, env);
  const diagnostics = receiptEmailSenderDiagnostics(env);
  return {
    previewType,
    fixtureKey,
    fixtureLabel: option.label,
    fixtureDescription: option.description,
    subject: rendered.subject,
    sender: {
      displayName: sender.displayName,
      address: sender.address,
      from: sender.from,
      configured: sender.configured,
      valid: sender.valid,
      profileValueInvalid: sender.profileValueInvalid,
      usingEmailFromFallback: sender.usingEmailFromFallback
    },
    replyToConfigured: diagnostics.replyToConfigured,
    sendReadiness: sendReadiness(previewType, adminEmail, env),
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

function previewStatusFromDelivery(delivery: ReceiptEmailDeliveryDTO): ReceiptPreviewSendStatus {
  if (delivery.status === "SENT") return "SENT";
  if (delivery.status === "FAILED" && delivery.sanitizedFailureCode === "EMAIL_PROVIDER_NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (delivery.status === "FAILED") return "FAILED";
  return "UNCERTAIN";
}

function previewResultFromDelivery(input: {
  previewType: ReceiptEmailPreviewType;
  delivery: ReceiptEmailDeliveryDTO;
  provider: EmailSendResult["provider"];
  recipientEmail: string;
  reused: boolean;
}): PreviewSendResult {
  const status = previewStatusFromDelivery(input.delivery);
  return {
    previewType: input.previewType,
    status,
    provider: input.provider,
    maskedRecipient: maskReceiptEmail(input.recipientEmail) ?? "***",
    reused: input.reused,
    sentAt: input.delivery.sentAt,
    safeFailureCode:
      status === "UNCERTAIN" && input.delivery.sanitizedFailureCode === "RECEIPT_EMAIL_STATUS_UNAVAILABLE"
        ? "RECEIPT_EMAIL_STATUS_UNAVAILABLE"
        : input.delivery.sanitizedFailureCode,
    safeFailureMessage:
      status === "UNCERTAIN"
        ? "The provider may have accepted the test email, but final delivery status could not be saved."
        : input.delivery.sanitizedFailureMessage
  };
}

export async function existingPreviewDeliveryResult(input: {
  user: SessionUser;
  previewType: ReceiptEmailPreviewType;
  previewRequestId: string;
}, env: EmailSendOptions["env"] = process.env): Promise<PreviewSendResult | null> {
  const recipient = normalizeReceiptEmail(input.user.email);
  if (!recipient) return null;
  const idempotencyKey = previewTestIdempotencyKey(input.user.id, input.previewType, input.previewRequestId);
  const delivery = await prisma.receiptEmailDelivery.findUnique({ where: { idempotencyKey } });
  if (!delivery || (delivery.status === "PENDING" && delivery.attemptCount === 0)) return null;
  return previewResultFromDelivery({
    previewType: input.previewType,
    delivery: {
      status: delivery.status === "SENT" || delivery.status === "FAILED" || delivery.status === "PENDING" ? delivery.status : "PENDING",
      deliveryType: delivery.deliveryType === "PREVIEW" ? "PREVIEW" : "RESEND",
      maskedRecipient: delivery.recipientEmailMasked,
      sentAt: delivery.sentAt?.toISOString() ?? null,
      lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
      attemptCount: delivery.attemptCount,
      sanitizedFailureCode: delivery.sanitizedFailureCode,
      sanitizedFailureMessage: delivery.sanitizedFailureMessage
    },
    provider: emailProviderConfig(env).provider,
    recipientEmail: recipient,
    reused: true
  });
}

export async function sendReceiptEmailPreviewToAdmin(input: {
  user: SessionUser;
  previewType: ReceiptEmailPreviewType;
  previewRequestId: string;
  requestId?: string | null;
}, deps: PreviewSendDeps = {}): Promise<PreviewSendResult> {
  const recipient = normalizeReceiptEmail(input.user.email);
  if (!recipient) throw new Error("Administrator account must have a valid email address before sending a receipt preview.");
  const readiness = sendReadiness(input.previewType, recipient, deps.env);
  if (!readiness.ready) throw new Error(readiness.reasons[0] ?? "Receipt preview email is not ready.");

  const sourceType = sourceTypeForPreview(input.previewType);
  const preview = buildReceiptEmailPreview(input.previewType, deps.env, recipient);
  const providerConfig = emailProviderConfig(deps.env ?? process.env);
  const idempotencyKey = previewTestIdempotencyKey(input.user.id, input.previewType, input.previewRequestId);
  let providerContacted = false;
  const send =
    deps.send ??
    ((message: EmailMessage, options: { idempotencyKey: string }) =>
      sendEmailViaProvider(message, {
        env: deps.env,
        fetchImpl: deps.fetchImpl,
        idempotencyKey: options.idempotencyKey
      }));
  const delivery = await runReceiptEmailDeliveryAttempt(
    {
      sourceType: "ADMIN_PREVIEW",
      sourceId: previewSourceId(input.user.id, input.previewType),
      recipientEmail: recipient,
      deliveryType: "PREVIEW",
      idempotencyKey,
      snapshot: receiptEmailPreviewFixtures()[defaultFixtureForPreview(input.previewType)],
      senderFrom: preview.sender.from,
      requestedByUserId: input.user.id,
      requestId: input.requestId
    },
    {
      store: deps.store ?? prismaReceiptEmailDeliveryStore,
      render: (snapshot) => buildReceiptEmail(snapshot, { testMode: true }),
      send: (message, options) => {
        providerContacted = true;
        return send(message, options);
      },
      audit: async (auditInput) => {
        try {
          await (deps.audit ?? logAudit)({
            user: input.user,
            action: auditInput.action.replace("admin_preview.receipt_email", "admin.receipt_email_preview"),
            entityType: "RECEIPT_EMAIL_PREVIEW",
            entityId: previewSourceId(input.user.id, input.previewType),
            summary: `Administrator receipt preview ${auditInput.metadata.deliveryStatus === "SENT" ? "sent" : "failed"} for ${input.previewType}.`,
            requestId: input.requestId,
            metadata: {
              previewType: input.previewType,
              maskedRecipient: maskReceiptEmail(recipient),
              provider: providerConfig.provider,
              status: auditInput.metadata.deliveryStatus,
              sourceType
            }
          });
        } catch {
          // Preview audit is best-effort and must not affect test-send status.
        }
      },
      providerName: providerConfig.provider
    }
  );

  return previewResultFromDelivery({
    previewType: input.previewType,
    delivery,
    provider: providerConfig.provider,
    recipientEmail: recipient,
    reused: !providerContacted
  });
}
