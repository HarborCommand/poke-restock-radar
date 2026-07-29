import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildReceiptEmail,
  fallbackReceiptEmailDelivery,
  attachPosReceiptEmailDeliveryResult,
  maskReceiptEmail,
  notRequestedReceiptEmailDelivery,
  normalizeReceiptEmail,
  receiptEmailDeliveryAvailable,
  receiptEmailFeatureConfig,
  receiptEmailSenderDiagnostics,
  receiptEmailSenderProfile,
  runReceiptEmailDeliveryAttempt,
  type ReceiptEmailDeliveryAttemptStore,
  type ReceiptEmailDeliveryRecord,
  type ReceiptEmailSnapshot
} from "../src/lib/receipt-email";
import {
  buildReceiptEmailPreview,
  previewTestIdempotencyKey,
  sendReceiptEmailPreviewToAdmin
} from "../src/lib/receipt-email-preview";
import { stableReceiptEmailIdempotencyKey } from "../src/lib/receipt-email-client";
import type { EmailSendResult } from "../src/lib/email-provider";
import type { SessionUser } from "../src/types/radar";

const source = (path: string) => readFileSync(path, "utf8");

const receiptEmailSource = source("src/lib/receipt-email.ts");
const radarServiceSource = source("src/lib/radar-service.ts");
const storefrontSource = source("src/lib/storefront.ts");
const radarAppSource = source("src/components/RadarApp.tsx");
const globalsCssSource = source("src/app/globals.css");
const validationSource = source("src/lib/validation.ts");
const rateLimitSource = source("src/lib/rate-limit.ts");
const posSaleRouteSource = source("src/app/api/radar/pos/sales/route.ts");
const posResendRouteSource = source("src/app/api/radar/pos/sales/[saleReference]/receipt-email/route.ts");
const storefrontResendRouteSource = source("src/app/api/radar/storefront/orders/[orderId]/receipt-email/route.ts");
const receiptPreviewRouteSource = source("src/app/api/radar/receipt-email-preview/route.ts");
const receiptPreviewSource = source("src/lib/receipt-email-preview.ts");
const schemaSource = source("prisma/schema.prisma");
const migrationSource = source("prisma/migrations/20260727120000_receipt_email_deliveries/migration.sql");

const hiddenInternalPattern =
  /cost basis|costBasis|profit|internal note|admin note|private note|inventory lot|lot id|stripe secret|payment_method_details|card number|cvc|cvv|idempotency key|database id/i;

const previewAdmin: SessionUser = {
  id: "admin-preview-1",
  email: "AdminPreview@example.com",
  name: "Admin Preview",
  role: "ADMIN",
  canAddSightings: true,
  canAddComps: true,
  canRunChecks: true,
  canReceivePushAlerts: true,
  preferredZone: "MIAMI",
  customZoneName: null,
  hideDistantStores: false,
  currentLatitude: null,
  currentLongitude: null,
  locationUpdatedAt: null,
  sessionVersion: 0
};

const previewEmailEnv = {
  RESEND_API_KEY: "test_resend_key",
  EMAIL_FROM: "GameDayGrabs <hello@example.com>",
  STOREFRONT_EMAIL_FROM: "orders@gamedaygrabs.com",
  POS_RECEIPT_EMAIL_FROM: "receipts@gamedaygrabs.com",
  EMAIL_REPLY_TO: "support@gamedaygrabs.com"
};

const previewRequestIdA = "11111111-1111-4111-8111-111111111111";
const previewRequestIdB = "22222222-2222-4222-8222-222222222222";

function makeDeliveryRecord(input: {
  id?: string;
  status?: string;
  deliveryType?: string;
  recipientEmailMasked?: string;
  attemptCount?: number;
  sentAt?: Date | null;
  lastAttemptAt?: Date | null;
  sanitizedFailureCode?: string | null;
  sanitizedFailureMessage?: string | null;
} = {}): ReceiptEmailDeliveryRecord {
  return {
    id: input.id ?? "delivery-1",
    status: input.status ?? "PENDING",
    deliveryType: input.deliveryType ?? "RESEND",
    recipientEmailMasked: input.recipientEmailMasked ?? "c***@example.com",
    attemptCount: input.attemptCount ?? 0,
    sentAt: input.sentAt ?? null,
    lastAttemptAt: input.lastAttemptAt ?? null,
    sanitizedFailureCode: input.sanitizedFailureCode ?? null,
    sanitizedFailureMessage: input.sanitizedFailureMessage ?? null
  };
}

function makeInMemoryDeliveryStore(options: { failMark?: boolean | "once" } = {}) {
  const byId = new Map<string, ReceiptEmailDeliveryRecord>();
  const byKey = new Map<string, string>();
  let nextId = 1;
  let failedMark = false;
  const store: ReceiptEmailDeliveryAttemptStore & { records: () => ReceiptEmailDeliveryRecord[] } = {
    async createOrGetClaim(input) {
      const existingId = byKey.get(input.idempotencyKey);
      if (existingId) return { ...byId.get(existingId)! };
      const record = makeDeliveryRecord({
        id: `delivery-${nextId++}`,
        deliveryType: input.deliveryType,
        recipientEmailMasked: maskReceiptEmail(input.recipientEmail) ?? "***"
      });
      byId.set(record.id, record);
      byKey.set(input.idempotencyKey, record.id);
      return { ...record };
    },
    async claimAttempt(id) {
      const record = byId.get(id);
      if (!record || record.status !== "PENDING" || record.attemptCount !== 0) return 0;
      byId.set(id, { ...record, attemptCount: 1, lastAttemptAt: new Date("2026-07-27T12:00:00.000Z") });
      return 1;
    },
    async findById(id) {
      const record = byId.get(id);
      return record ? { ...record } : null;
    },
    async markResult(input) {
      if (options.failMark === true || (options.failMark === "once" && !failedMark)) {
        failedMark = true;
        throw new Error("mark failed");
      }
      const current = byId.get(input.id);
      if (!current) throw new Error("missing");
      const updated = {
        ...current,
        status: input.status,
        providerMessageId: input.providerMessageId ?? null,
        sentAt: input.sentAt ?? null,
        sanitizedFailureCode: input.sanitizedFailureCode ?? null,
        sanitizedFailureMessage: input.sanitizedFailureMessage ?? null
      };
      byId.set(input.id, updated);
      return { ...updated };
    },
    records() {
      return [...byId.values()].map((record) => ({ ...record }));
    }
  };
  return store;
}

function successfulSendResult(): EmailSendResult {
  return {
    status: "sent",
    provider: "resend",
    sentAt: new Date("2026-07-27T12:00:01.000Z"),
    detail: "accepted",
    failureReason: null,
    providerMessageId: "email_123"
  };
}

function failedSendResult(): EmailSendResult {
  return {
    status: "failed",
    provider: "resend",
    sentAt: null,
    detail: "failed",
    failureReason: "Provider failed.",
    providerMessageId: null
  };
}

function deliveryAttemptInput(idempotencyKey = "receipt:unit:same-key") {
  return {
    sourceType: "POS_SALE" as const,
    sourceId: "POS-123",
    recipientEmail: "collector@example.com",
    deliveryType: "RESEND" as const,
    idempotencyKey,
    snapshot: posSnapshot,
    requestedByUserId: "admin-1",
    requestId: "req-1"
  };
}

const storefrontSnapshot: ReceiptEmailSnapshot = {
  sourceType: "STOREFRONT_ORDER",
  receiptNumber: "GDD-20260727-ABCD",
  completedAt: "2026-07-27T16:45:00.000Z",
  customerName: "Guest Collector",
  lineItems: [
    {
      name: "Mega Evolution Perfect Order Booster Bundle <script>alert('x')</script>",
      quantity: 2,
      unitPrice: 44.99,
      lineTotal: 89.98
    },
    {
      name: "Pokémon TCG: Mega Moonlit Tin",
      quantity: 1,
      unitPrice: 39.99,
      lineTotal: 39.99
    }
  ],
  subtotal: 129.97,
  discount: 10,
  shipping: 4.99,
  tax: 8.75,
  total: 133.71,
  paymentMethodLabel: "Securely processed by Stripe",
  fulfillmentMethod: "Shipping",
  fulfillmentSummary: "Ships to the checkout address.",
  supportEmail: "gamedaygrabs@outlook.com",
  orderStatusUrl: "https://www.gamedaygrabs.com/order-status?order=GDD-20260727-ABCD"
};

const posSnapshot: ReceiptEmailSnapshot = {
  sourceType: "POS_SALE",
  receiptNumber: "POS-7F2D19A8",
  completedAt: "2026-07-27T18:15:00.000Z",
  customerName: "Linked Collector",
  lineItems: [
    {
      name: "Pitch Black Elite Trainer Box",
      quantity: 1,
      unitPrice: 75,
      lineTotal: 75
    },
    {
      name: "Chaos Rising Premium Checklane Blister",
      quantity: 3,
      unitPrice: 19.99,
      lineTotal: 59.97
    }
  ],
  subtotal: 134.97,
  discount: 5,
  shipping: 0,
  tax: 9.1,
  total: 139.07,
  paymentMethodLabel: "Manual POS payment",
  fulfillmentMethod: "In-person pickup",
  fulfillmentSummary: "Completed at the counter.",
  supportEmail: "gamedaygrabs@outlook.com"
};

test("receipt renderer produces branded storefront HTML and text from persisted values", () => {
  const email = buildReceiptEmail(storefrontSnapshot);
  const combined = `${email.subject}\n${email.html}\n${email.text}`;

  assert.equal(email.subject, "Order confirmed — GDD-20260727-ABCD");
  assert.match(email.html, /Thanks for your order\./);
  assert.match(email.html, /We received your GameDayGrabs order and payment\./);
  assert.match(email.html, /GameDay<span style="color:#FF6A00;">Grabs<\/span>/);
  assert.match(combined, /GDD-20260727-ABCD/);
  assert.match(combined, /Guest Collector/);
  assert.match(combined, /Mega Evolution Perfect Order Booster Bundle/);
  assert.match(combined, /Pokémon TCG: Mega Moonlit Tin/);
  assert.match(combined, /2 x Mega Evolution Perfect Order Booster Bundle/);
  assert.match(email.html, /Qty 2 &times; \$44\.99/);
  assert.match(combined, /Discount: -\$10\.00/);
  assert.match(combined, /Subtotal: \$129\.97/);
  assert.match(combined, /Shipping: \$4\.99/);
  assert.match(combined, /Tax: \$8\.75/);
  assert.match(combined, /Total paid: \$133\.71/);
  assert.match(combined, /Securely processed by Stripe/);
  assert.match(combined, /Ships to the checkout address/);
  assert.match(combined, /gamedaygrabs@outlook\.com/);
  assert.match(combined, /https:\/\/www\.gamedaygrabs\.com\/order-status/);
  assert.doesNotMatch(email.html, /<script>/i);
  assert.match(email.html, /&lt;script&gt;alert/);
  assert.doesNotMatch(combined, hiddenInternalPattern);
});

test("receipt renderer produces POS receipt content without exposing internals", () => {
  const email = buildReceiptEmail(posSnapshot);
  const combined = `${email.subject}\n${email.html}\n${email.text}`;

  assert.equal(email.subject, "Your GameDayGrabs receipt — POS-7F2D19A8");
  assert.match(email.html, /Thanks for your purchase\./);
  assert.match(email.html, /Your receipt from GameDayGrabs\./);
  assert.match(combined, /POS-7F2D19A8/);
  assert.match(combined, /Linked Collector/);
  assert.match(combined, /Pitch Black Elite Trainer Box/);
  assert.match(combined, /Chaos Rising Premium Checklane Blister/);
  assert.match(combined, /3 x Chaos Rising Premium Checklane Blister @ \$19\.99 = \$59\.97/);
  assert.match(combined, /Discount: -\$5\.00/);
  assert.match(combined, /Subtotal: \$134\.97/);
  assert.doesNotMatch(combined, /Shipping:/);
  assert.match(combined, /Tax: \$9\.10/);
  assert.match(combined, /Total paid: \$139\.07/);
  assert.match(combined, /Manual POS payment/);
  assert.match(combined, /In-person pickup/);
  assert.doesNotMatch(combined, hiddenInternalPattern);
});

test("receipt renderer shows supplied persisted reward summary without calculating rewards", () => {
  const email = buildReceiptEmail({
    ...storefrontSnapshot,
    rewardSummary: {
      pointsEarned: 129,
      availableBalance: 3905,
      pendingBalance: 0,
      rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
    }
  });
  const combined = `${email.html}\n${email.text}`;

  assert.match(combined, /You earned 129 points!/);
  assert.match(combined, /Points earned this purchase[\s\S]*\+129/);
  assert.match(combined, /Available balance[\s\S]*3905 points/);
  assert.doesNotMatch(combined, /Pending points/);
  assert.match(combined, /View My Rewards/);
  assert.match(combined, /https:\/\/www\.gamedaygrabs\.com\/account\/rewards/);
  assert.doesNotMatch(combined, /threshold|progress|dollar value|expires/i);
  assert.doesNotMatch(combined, /customerAccount|ledger|cost basis|profit|private note|internal note/i);
  assert.doesNotMatch(receiptEmailSource, /rewardPointsForOrderSubtotal|rewardPointsForEligibleSubtotalCents|rewardLedgerEntry\.(create|upsert)|rewardBalance\.(create|update|upsert)/);
});

test("receipt renderer shows pending points only when supplied persisted pending balance is positive", () => {
  const pending = buildReceiptEmail({
    ...storefrontSnapshot,
    rewardSummary: {
      pointsEarned: 124,
      availableBalance: 8012,
      pendingBalance: 124,
      rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
    }
  });
  const availableOnly = buildReceiptEmail({
    ...posSnapshot,
    rewardSummary: {
      pointsEarned: 21,
      availableBalance: 3926,
      pendingBalance: 0,
      rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
    }
  });

  assert.match(`${pending.html}\n${pending.text}`, /Pending points[\s\S]*124 points/);
  assert.match(`${availableOnly.html}\n${availableOnly.text}`, /You earned 21 points!/);
  assert.doesNotMatch(`${availableOnly.html}\n${availableOnly.text}`, /Pending points/);
});

test("receipt renderer omits reward block for guests, disabled rewards, missing ledger, malformed values, and unsafe reward links", () => {
  const cases: ReceiptEmailSnapshot[] = [
    storefrontSnapshot,
    { ...storefrontSnapshot, rewardSummary: null },
    { ...storefrontSnapshot, rewardSummary: { pointsEarned: 0, availableBalance: 10, pendingBalance: 0, rewardsUrl: "https://www.gamedaygrabs.com/account/rewards" } },
    { ...storefrontSnapshot, rewardSummary: { pointsEarned: -1, availableBalance: 10, pendingBalance: 0, rewardsUrl: "https://www.gamedaygrabs.com/account/rewards" } },
    { ...storefrontSnapshot, rewardSummary: { pointsEarned: 10, availableBalance: -1, pendingBalance: 0, rewardsUrl: "https://www.gamedaygrabs.com/account/rewards" } },
    { ...storefrontSnapshot, rewardSummary: { pointsEarned: 10.5, availableBalance: 10, pendingBalance: 0, rewardsUrl: "https://www.gamedaygrabs.com/account/rewards" } },
    { ...storefrontSnapshot, rewardSummary: { pointsEarned: 10, availableBalance: 10, pendingBalance: 0, rewardsUrl: "https://www.gamedaygrabs.com/account/rewards?customer=abc" } }
  ];

  for (const snapshot of cases) {
    const email = buildReceiptEmail(snapshot);
    const combined = `${email.html}\n${email.text}`;
    assert.doesNotMatch(combined, /You earned \d+ points!/);
    assert.doesNotMatch(combined, /View My Rewards/);
  }
});

test("receipt footer removes internal customer-facing sentence while keeping support and test-preview footer", () => {
  const real = buildReceiptEmail(storefrontSnapshot);
  const testPreview = buildReceiptEmail(storefrontSnapshot, { testMode: true });
  const combinedReal = `${real.html}\n${real.text}`;
  const combinedPreview = `${testPreview.html}\n${testPreview.text}`;

  assert.doesNotMatch(`${combinedReal}\n${combinedPreview}`, /This receipt contains customer-facing transaction information only/);
  assert.match(combinedReal, /gamedaygrabs@outlook\.com/);
  assert.match(combinedReal, /gamedaygrabs\.com/);
  assert.match(combinedPreview, /This message was sent from the GameDayGrabs administrator receipt preview\./);
});

test("receipt delivery atomically claims a same-key resend before provider contact", async () => {
  const store = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const send = async (): Promise<EmailSendResult> => {
    providerCount += 1;
    return successfulSendResult();
  };

  const [first, second] = await Promise.all([
    runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" }),
    runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" })
  ]);

  assert.equal(providerCount, 1);
  assert.equal(store.records().length, 1);
  assert.equal(store.records()[0].attemptCount, 1);
  assert.ok([first.status, second.status].includes("SENT"));
  assert.ok([first.status, second.status].every((status) => status === "SENT" || status === "PENDING"));
});

test("provider success with final persistence failure stays pending and same key cannot resend", async () => {
  const store = makeInMemoryDeliveryStore({ failMark: "once" });
  let providerCount = 0;
  const send = async (): Promise<EmailSendResult> => {
    providerCount += 1;
    return successfulSendResult();
  };

  const first = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" });
  const second = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" });
  const recovery = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput("receipt:unit:new-key"), { store, render: buildReceiptEmail, send, providerName: "resend" });

  assert.equal(providerCount, 2);
  assert.equal(first.status, "PENDING");
  assert.equal(first.attemptCount, 1);
  assert.equal(first.sentAt, null);
  assert.equal(first.sanitizedFailureCode, "RECEIPT_EMAIL_STATUS_UNAVAILABLE");
  assert.equal(first.sanitizedFailureMessage, "The email provider accepted the receipt, but final delivery status could not be saved.");
  assert.equal(second.status, "PENDING");
  assert.equal(recovery.status, "SENT");
});

test("provider failure with final persistence failure protects the attempt from same-key retry", async () => {
  const store = makeInMemoryDeliveryStore({ failMark: true });
  let providerCount = 0;
  const send = async (): Promise<EmailSendResult> => {
    providerCount += 1;
    return failedSendResult();
  };

  const first = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" });
  const second = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), { store, render: buildReceiptEmail, send, providerName: "resend" });

  assert.equal(providerCount, 1);
  assert.equal(store.records()[0].attemptCount, 1);
  assert.equal(first.status, "PENDING");
  assert.equal(first.sanitizedFailureCode, "RECEIPT_EMAIL_STATUS_UNAVAILABLE");
  assert.equal(second.status, "PENDING");
});

test("receipt audit failure does not escape after authoritative delivery persistence", async () => {
  const store = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const result = await runReceiptEmailDeliveryAttempt(deliveryAttemptInput(), {
    store,
    render: buildReceiptEmail,
    send: async (): Promise<EmailSendResult> => {
      providerCount += 1;
      return successfulSendResult();
    },
    audit: async () => {
      throw new Error("audit unavailable");
    },
    providerName: "resend"
  });

  assert.equal(providerCount, 1);
  assert.equal(result.status, "SENT");
  assert.equal(store.records()[0].status, "SENT");
  assert.equal(store.records()[0].attemptCount, 1);
});

test("POS receipt attachment with feature unavailable creates no delivery attempt and stays not requested", async () => {
  let providerCount = 0;
  const completedReceipt = {
    saleReference: "POS-COMPLETE-1",
    completedMarker: "sale-persisted",
    receiptEmailDelivery: notRequestedReceiptEmailDelivery()
  };

  const result = await attachPosReceiptEmailDeliveryResult({
    receipt: completedReceipt,
    requestedReceiptEmail: null,
    snapshot: posSnapshot,
    requestedByUserId: "admin-1",
    requestDelivery: async () => {
      providerCount += 1;
      throw new Error("should not call");
    }
  });

  assert.equal(providerCount, 0);
  assert.equal(result.saleReference, completedReceipt.saleReference);
  assert.equal(result.completedMarker, "sale-persisted");
  assert.equal(result.receiptEmailDelivery.status, "NOT_REQUESTED");
});

test("POS receipt claim failure after sale completion preserves the sale and reports safe failure", async () => {
  let providerCount = 0;
  const completedReceipt = {
    saleReference: "POS-COMPLETE-2",
    completedMarker: "sale-persisted",
    inventoryDeductedOnce: true,
    receiptEmailDelivery: notRequestedReceiptEmailDelivery()
  };

  const result = await attachPosReceiptEmailDeliveryResult({
    receipt: completedReceipt,
    requestedReceiptEmail: "collector@example.com",
    snapshot: posSnapshot,
    requestedByUserId: "admin-1",
    requestDelivery: async () => {
      providerCount += 1;
      throw new Error("claim failed");
    }
  });

  assert.equal(providerCount, 1);
  assert.equal(result.saleReference, completedReceipt.saleReference);
  assert.equal(result.completedMarker, "sale-persisted");
  assert.equal(result.inventoryDeductedOnce, true);
  assert.equal(result.receiptEmailDelivery.status, "FAILED");
  assert.equal(result.receiptEmailDelivery.sanitizedFailureCode, "RECEIPT_EMAIL_UNAVAILABLE");
  assert.equal(result.receiptEmailDelivery.sanitizedFailureMessage, "The sale completed, but the receipt email could not be sent.");
});

test("client receipt resend keys are generated once per request and reusable for a retry", () => {
  const firstClickKey = stableReceiptEmailIdempotencyKey("receipt-resend:POS-123", "fixed-random-id");
  const retryKey = firstClickKey;
  const nextClickKey = stableReceiptEmailIdempotencyKey("receipt-resend:POS-123", "next-random-id");

  assert.equal(firstClickKey, retryKey);
  assert.notEqual(firstClickKey, nextClickKey);
  assert.match(radarAppSource, /disabled=\{sendingReceipt\}/);
  assert.match(radarAppSource, /disabled=\{receiptResending \|\| !storefrontReceiptResendReady\}/);
  assert.doesNotMatch(radarAppSource, /requestJson[\s\S]{0,240}retry:\s*true/);
});

test("receipt email configuration defaults disabled and normalizes recipients safely", () => {
  assert.deepEqual(receiptEmailFeatureConfig({}), {
    storefrontReceiptEmailsEnabled: false,
    posReceiptEmailsEnabled: false
  });
  assert.deepEqual(
    receiptEmailFeatureConfig({
      STOREFRONT_RECEIPT_EMAILS_ENABLED: "true",
      POS_RECEIPT_EMAILS_ENABLED: " TRUE "
    }),
    { storefrontReceiptEmailsEnabled: true, posReceiptEmailsEnabled: true }
  );
  assert.equal(normalizeReceiptEmail(" Collector@Example.COM "), "collector@example.com");
  assert.equal(normalizeReceiptEmail("not-an-email"), null);
  assert.equal(maskReceiptEmail("Collector@Example.COM"), "c***@example.com");
});

test("receipt delivery and retry never create or modify authoritative rewards", async () => {
  const store = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const rewardSnapshot: ReceiptEmailSnapshot = {
    ...posSnapshot,
    rewardSummary: {
      pointsEarned: 21,
      availableBalance: 3926,
      pendingBalance: 0,
      rewardsUrl: "https://www.gamedaygrabs.com/account/rewards"
    }
  };

  const first = await runReceiptEmailDeliveryAttempt(
    { ...deliveryAttemptInput("receipt:reward-snapshot"), snapshot: rewardSnapshot },
    {
      store,
      render: buildReceiptEmail,
      send: async (): Promise<EmailSendResult> => {
        providerCount += 1;
        return successfulSendResult();
      },
      providerName: "resend"
    }
  );
  const retry = await runReceiptEmailDeliveryAttempt(
    { ...deliveryAttemptInput("receipt:reward-snapshot"), snapshot: rewardSnapshot },
    {
      store,
      render: buildReceiptEmail,
      send: async (): Promise<EmailSendResult> => {
        providerCount += 1;
        return successfulSendResult();
      },
      providerName: "resend"
    }
  );

  assert.equal(providerCount, 1);
  assert.equal(first.status, "SENT");
  assert.equal(retry.status, "SENT");
  assert.equal(store.records().length, 1);
  assert.doesNotMatch(receiptEmailSource, /rewardLedgerEntry\.(create|upsert|update|updateMany)|rewardBalance\.(create|upsert|update|updateMany)/);
});

test("receipt sender profiles are selected server-side with EMAIL_FROM fallback", () => {
  const env = {
    RESEND_API_KEY: "test_resend_key",
    EMAIL_FROM: "GameDayGrabs <hello@example.com>",
    STOREFRONT_EMAIL_FROM: "orders@gamedaygrabs.com",
    POS_RECEIPT_EMAIL_FROM: "GameDayGrabs Register <receipts@gamedaygrabs.com>",
    EMAIL_REPLY_TO: "support@gamedaygrabs.com"
  };

  const storefront = receiptEmailSenderProfile("STOREFRONT_ORDER", env);
  const pos = receiptEmailSenderProfile("POS_SALE", env);
  const fallback = receiptEmailSenderProfile("POS_SALE", { EMAIL_FROM: "GameDayGrabs <hello@example.com>" });
  const invalidProfileFallback = receiptEmailSenderProfile("POS_SALE", {
    EMAIL_FROM: "GameDayGrabs <hello@example.com>",
    POS_RECEIPT_EMAIL_FROM: "GameDayGrabs Receipts <receipts@gamedaygrabs.com>\r\nBcc:evil@example.com"
  });
  const diagnostics = receiptEmailSenderDiagnostics(env);

  assert.equal(storefront.from, "GameDayGrabs Orders <orders@gamedaygrabs.com>");
  assert.equal(pos.from, "GameDayGrabs Receipts <receipts@gamedaygrabs.com>");
  assert.equal(fallback.from, "GameDayGrabs <hello@example.com>");
  assert.equal(fallback.usingEmailFromFallback, true);
  assert.equal(invalidProfileFallback.from, "GameDayGrabs <hello@example.com>");
  assert.equal(invalidProfileFallback.profileValueInvalid, true);
  assert.equal(invalidProfileFallback.usingEmailFromFallback, true);
  assert.equal(diagnostics.storefrontEmailFromConfigured, true);
  assert.equal(diagnostics.posReceiptEmailFromConfigured, true);
  assert.equal(diagnostics.emailFromFallbackConfigured, true);
  assert.equal(diagnostics.replyToConfigured, true);
});

test("receipt delivery message uses trusted sender profile and no client-supplied from", async () => {
  const store = makeInMemoryDeliveryStore();
  const messages: Array<{ from?: string; subject: string }> = [];

  await runReceiptEmailDeliveryAttempt(
    {
      ...deliveryAttemptInput("receipt:sender-profile"),
      sourceType: "STOREFRONT_ORDER",
      sourceId: "order-1",
      snapshot: storefrontSnapshot,
      senderFrom: "GameDayGrabs Orders <orders@gamedaygrabs.com>"
    },
    {
      store,
      render: buildReceiptEmail,
      send: async (message): Promise<EmailSendResult> => {
        messages.push({ from: message.from, subject: message.subject });
        return successfulSendResult();
      },
      providerName: "resend"
    }
  );

  assert.equal(messages[0]?.from, "GameDayGrabs Orders <orders@gamedaygrabs.com>");
  assert.equal(messages[0]?.subject, "Order confirmed — GDD-20260727-ABCD");
  assert.doesNotMatch(posResendRouteSource, /fromAddress|senderAddress|senderFrom|emailFrom/i);
  assert.doesNotMatch(storefrontResendRouteSource, /fromAddress|senderAddress|senderFrom|emailFrom/i);
});

test("receipt preview messages are fixture-only, clearly marked, and hide internals", () => {
  const storefront = buildReceiptEmailPreview("storefront", {
    EMAIL_FROM: "GameDayGrabs <hello@example.com>",
    STOREFRONT_EMAIL_FROM: "orders@gamedaygrabs.com",
    EMAIL_REPLY_TO: "support@gamedaygrabs.com"
  });
  const pos = buildReceiptEmailPreview("pos", {
    EMAIL_FROM: "GameDayGrabs <hello@example.com>",
    POS_RECEIPT_EMAIL_FROM: "receipts@gamedaygrabs.com"
  });

  assert.equal(storefront.subject, "[TEST] GameDayGrabs order confirmation");
  assert.equal(pos.subject, "[TEST] GameDayGrabs POS receipt");
  assert.equal(storefront.sender.from, "GameDayGrabs Orders <orders@gamedaygrabs.com>");
  assert.equal(pos.sender.from, "GameDayGrabs Receipts <receipts@gamedaygrabs.com>");
  assert.match(storefront.html, /TEST RECEIPT/);
  assert.match(storefront.text, /No payment was made\./);
  assert.match(storefront.text, /No order or POS sale was created\./);
  assert.match(storefront.text, /This message was sent from the GameDayGrabs administrator receipt preview\./);
  assert.match(pos.html, /Thanks for your purchase\./);
  assert.doesNotMatch(pos.text, /Shipping:/);
  assert.doesNotMatch(`${storefront.html}\n${storefront.text}\n${pos.html}\n${pos.text}`, hiddenInternalPattern);
});

test("admin receipt preview same-token retries use one durable ADMIN_PREVIEW claim", async () => {
  const store = makeInMemoryDeliveryStore();
  const sent: Array<{ to: string; from?: string; subject: string; idempotencyKey: string }> = [];
  let auditCalls = 0;
  const sendPreview = () =>
    sendReceiptEmailPreviewToAdmin(
      { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview" },
      {
        env: previewEmailEnv,
        store,
        send: async (message, options): Promise<EmailSendResult> => {
          sent.push({ to: message.to, from: message.from, subject: message.subject, idempotencyKey: options.idempotencyKey });
          return successfulSendResult();
        },
        audit: async () => {
          auditCalls += 1;
          throw new Error("audit down");
        }
      }
    );

  const [first, retry] = await Promise.all([sendPreview(), sendPreview()]);
  const records = store.records();

  assert.equal(records.length, 1);
  assert.equal(records[0].deliveryType, "PREVIEW");
  assert.equal(records[0].attemptCount, 1);
  assert.equal(records[0].status, "SENT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "adminpreview@example.com");
  assert.equal(sent[0].from, "GameDayGrabs Receipts <receipts@gamedaygrabs.com>");
  assert.equal(sent[0].subject, "[TEST] GameDayGrabs POS receipt");
  assert.equal(sent[0].idempotencyKey, previewTestIdempotencyKey(previewAdmin.id, "pos", previewRequestIdA));
  assert.ok(["SENT", "UNCERTAIN"].includes(first.status));
  assert.ok(["SENT", "UNCERTAIN"].includes(retry.status));
  assert.ok([first.status, retry.status].includes("SENT"));
  assert.equal(first.maskedRecipient, "a***@example.com");
  assert.equal([first.reused, retry.reused].filter(Boolean).length, 1);
  assert.equal(auditCalls, 1);
});

test("admin receipt preview remains idempotent across serverless instances sharing the durable store", async () => {
  const sharedStore = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const makeDeps = () => ({
    env: previewEmailEnv,
    store: sharedStore,
    send: async (): Promise<EmailSendResult> => {
      providerCount += 1;
      return successfulSendResult();
    },
    audit: async () => {}
  });

  const first = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "storefront", previewRequestId: previewRequestIdA, requestId: "req-a" },
    makeDeps()
  );
  const second = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "storefront", previewRequestId: previewRequestIdA, requestId: "req-b" },
    makeDeps()
  );

  assert.equal(sharedStore.records().length, 1);
  assert.equal(providerCount, 1);
  assert.equal(first.status, "SENT");
  assert.equal(second.status, "SENT");
  assert.equal(second.reused, true);
});

test("admin receipt preview reports uncertain after provider success with final persistence failure without resending retry", async () => {
  const store = makeInMemoryDeliveryStore({ failMark: "once" });
  let providerCount = 0;
  const deps = {
    env: previewEmailEnv,
    store,
    send: async (): Promise<EmailSendResult> => {
      providerCount += 1;
      return successfulSendResult();
    },
    audit: async () => {}
  };

  const first = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview" },
    deps
  );
  const retry = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview-retry" },
    deps
  );

  assert.equal(providerCount, 1);
  assert.equal(store.records().length, 1);
  assert.equal(store.records()[0].attemptCount, 1);
  assert.equal(first.status, "UNCERTAIN");
  assert.equal(first.safeFailureCode, "RECEIPT_EMAIL_STATUS_UNAVAILABLE");
  assert.match(first.safeFailureMessage ?? "", /provider may have accepted/i);
  assert.equal(retry.status, "UNCERTAIN");
  assert.equal(retry.reused, true);
});

test("admin receipt preview persists provider failures and does not retry the same request token", async () => {
  const store = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const deps = {
    env: previewEmailEnv,
    store,
    send: async (): Promise<EmailSendResult> => {
      providerCount += 1;
      return failedSendResult();
    },
    audit: async () => {}
  };

  const first = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview" },
    deps
  );
  const retry = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview-retry" },
    deps
  );

  assert.equal(providerCount, 1);
  assert.equal(first.status, "FAILED");
  assert.equal(first.safeFailureCode, "EMAIL_PROVIDER_FAILED");
  assert.equal(retry.status, "FAILED");
  assert.equal(retry.reused, true);
});

test("admin receipt preview new intentional clicks use distinct request tokens", async () => {
  const store = makeInMemoryDeliveryStore();
  let providerCount = 0;
  const deps = {
    env: previewEmailEnv,
    store,
    send: async (): Promise<EmailSendResult> => {
      providerCount += 1;
      return successfulSendResult();
    },
    audit: async () => {}
  };

  const first = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview-a" },
    deps
  );
  const second = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdB, requestId: "req-preview-b" },
    deps
  );

  assert.equal(providerCount, 2);
  assert.equal(store.records().length, 2);
  assert.equal(first.status, "SENT");
  assert.equal(second.status, "SENT");
  assert.equal(first.reused, false);
  assert.equal(second.reused, false);
});

test("admin receipt preview validates sender and recipient safety without exposing internal identifiers", async () => {
  const store = makeInMemoryDeliveryStore();
  const messages: Array<{ to: string; from?: string; subject: string }> = [];
  const env = {
    RESEND_API_KEY: "test_resend_key",
    EMAIL_FROM: "GameDayGrabs <hello@example.com>",
    POS_RECEIPT_EMAIL_FROM: "GameDayGrabs Receipts <receipts@gamedaygrabs.com>\r\nBcc:evil@example.com"
  };
  const preview = buildReceiptEmailPreview("pos", env, previewAdmin.email);

  const result = await sendReceiptEmailPreviewToAdmin(
    { user: previewAdmin, previewType: "pos", previewRequestId: previewRequestIdA, requestId: "req-preview" },
    {
      env,
      store,
      send: async (message): Promise<EmailSendResult> => {
        messages.push({ to: message.to, from: message.from, subject: message.subject });
        return successfulSendResult();
      },
      audit: async () => {}
    }
  );
  const serializedResult = JSON.stringify(result);

  assert.equal(preview.sender.profileValueInvalid, true);
  assert.equal(preview.sender.usingEmailFromFallback, true);
  assert.equal(preview.sender.from, "GameDayGrabs <hello@example.com>");
  assert.equal(preview.sendReadiness.ready, true);
  assert.equal(messages[0].to, "adminpreview@example.com");
  assert.equal(messages[0].from, "GameDayGrabs <hello@example.com>");
  assert.equal(result.status, "SENT");
  assert.doesNotMatch(serializedResult, /receipt-preview|admin-preview-1|email_123|AdminPreview@example\.com|adminpreview@example\.com/i);
});

test("admin receipt preview route is admin-only, rate limited, and cannot accept arbitrary recipient or sender", () => {
  assert.match(receiptPreviewRouteSource, /requireUser/);
  assert.match(receiptPreviewRouteSource, /requireAdmin/);
  assert.match(receiptPreviewRouteSource, /admin_receipt_preview_test/);
  assert.match(receiptPreviewRouteSource, /identifiers: \[\{ scope: "email", value: user\.email \}\]/);
  assert.match(rateLimitSource, /admin_receipt_preview_test[\s\S]{0,260}maxAttempts: 3/);
  assert.match(receiptPreviewRouteSource, /previewSchema/);
  assert.match(receiptPreviewRouteSource, /z\.enum\(\["storefront", "pos"\]\)/);
  assert.match(receiptPreviewRouteSource, /previewRequestId: z\.string\(\)\.uuid\(\)/);
  assert.match(receiptPreviewRouteSource, /existingPreviewDeliveryResult/);
  assert.match(receiptPreviewSource, /sourceType: "ADMIN_PREVIEW"/);
  assert.match(receiptPreviewSource, /deliveryType: "PREVIEW"/);
  assert.match(receiptPreviewSource, /previewTestIdempotencyKey\(input\.user\.id, input\.previewType, input\.previewRequestId\)/);
  assert.doesNotMatch(receiptPreviewRouteSource, /recipient|toEmail|emailTo|fromAddress|senderAddress/);
  assert.doesNotMatch(receiptPreviewSource, /new Map|previewDedup|Date\.now|Math\.floor\(.*60_000/);
  assert.doesNotMatch(receiptPreviewSource, /storefrontOrder\.create|inventorySale\.create|customerAccount\.create|paymentEvent\.create|inventoryItem\.update|rewardLedgerEntry\.create|taxAdjustment\.create|checkout/);
  assert.match(radarAppSource, /crypto\.randomUUID\(\)/);
  assert.match(radarAppSource, /body: JSON\.stringify\(\{ previewType, previewRequestId \}\)/);
  assert.match(radarAppSource, /result\.status === "SENT"/);
  assert.match(radarAppSource, /result\.status === "NOT_CONFIGURED"/);
  assert.match(radarAppSource, /result\.status === "UNCERTAIN"/);
  assert.match(radarAppSource, /disabled=\{busy \|\| !readiness\?\.ready\}/);
});

test("delivery persistence is narrowly scoped, idempotent, and does not store rendered receipt bodies", () => {
  assert.match(schemaSource, /model ReceiptEmailDelivery/);
  assert.match(schemaSource, /idempotencyKey\s+String\s+@unique/);
  assert.match(schemaSource, /sourceType\s+String/);
  assert.match(schemaSource, /sourceId\s+String/);
  assert.match(schemaSource, /recipientEmailNormalized\s+String/);
  assert.match(schemaSource, /recipientEmailMasked\s+String/);
  assert.match(schemaSource, /requestedByUserId\s+String\?/);
  assert.match(migrationSource, /CREATE TABLE "ReceiptEmailDelivery"/);
  assert.match(migrationSource, /ReceiptEmailDelivery_idempotencyKey_key/);
  assert.doesNotMatch(schemaSource, /htmlBody|textBody|emailBody|renderedBody/);
  assert.match(receiptEmailSource, /P2002/);
  assert.match(receiptEmailSource, /findUniqueOrThrow\(\{ where: \{ idempotencyKey/);
  assert.match(receiptEmailSource, /updateMany\(\{\s*where: \{ id, status: "PENDING", attemptCount: 0 \}/);
  assert.match(receiptEmailSource, /attemptCount: \{ increment: 1 \}/);
  assert.match(receiptEmailSource, /if \(delivery\.status === "SENT" \|\| delivery\.status === "FAILED" \|\| delivery\.attemptCount > 0\) return deliveryToDTO\(delivery\)/);
  assert.doesNotMatch(receiptEmailSource, /markDeliveryResult[\s\S]{0,500}attemptCount: \{ increment: 1 \}/);
});

test("storefront sends exactly one automatic order-confirmation receipt on the durable paid side effect", () => {
  assert.match(storefrontSource, /async function completePaidCheckoutSideEffects\(order/);
  assert.match(storefrontSource, /if \(order\.paymentStatus !== "paid"\) return;/);
  assert.match(storefrontSource, /await awardRewardsForPaidOrder\(order\);/);
  assert.match(storefrontSource, /await sendStorefrontOrderConfirmationEmail\(await loadFreshStorefrontOrder\(order\.id\)\);/);
  assert.doesNotMatch(storefrontSource, /await sendStorefrontReceiptEmail\(order\);/);
  assert.doesNotMatch(storefrontSource, /receipt:storefront:initial:\$\{order\.id\}:\$\{recipient\}/);
  assert.match(storefrontSource, /receiptEmailEnabled\("STOREFRONT_ORDER"\)/);
  assert.match(storefrontSource, /receiptPresentationEnabled[\s\S]{0,240}buildReceiptEmail\(receiptSnapshot\)/);
  assert.match(storefrontSource, /: buildOrderConfirmationEmail\(\{/);
  assert.match(storefrontSource, /subject: receiptEmail\.subject/);
  assert.match(storefrontSource, /from: receiptEmail \? receiptEmailSenderProfile\("STOREFRONT_ORDER"\)\.from : null/);
  assert.match(storefrontSource, /customerEmailEventId\("order_confirmation", order\.id\)/);
  assert.match(storefrontSource, /catch \{\s*\/\/ Customer email delivery\/status persistence is best-effort/);
  assert.match(storefrontSource, /normalizeReceiptEmail\(order\.customerEmail\) \?\? normalizeReceiptEmail\(order\.customer\?\.email\)/);
  assert.doesNotMatch(storefrontSource, /createCheckoutSession[\s\S]{0,1000}sendStorefrontReceiptEmail/);
  assert.match(storefrontSource, /sendStorefrontOrderReceiptEmail/);
  assert.match(storefrontResendRouteSource, /export async function GET/);
  assert.match(storefrontResendRouteSource, /getStorefrontOrderReceiptEmailStatus/);
  assert.match(storefrontResendRouteSource, /requireUser/);
  assert.match(storefrontResendRouteSource, /authorizeAdminMutation/);
  assert.match(storefrontResendRouteSource, /checkPublicRateLimit/);
  assert.match(storefrontResendRouteSource, /sendStorefrontOrderReceiptEmail/);
  assert.match(radarAppSource, /Receipt resend is not configured\./);
  assert.match(radarAppSource, /receiptDeliveryStatus\?\.configured === true/);
  assert.match(radarAppSource, /disabled=\{receiptResending \|\| !storefrontReceiptResendReady\}/);
});

test("receipt reward summaries are built only from persisted linked-account rewards and recipient matches", () => {
  assert.match(storefrontSource, /rewardReceiptSummaryFromPersistedResult/);
  assert.match(storefrontSource, /recipientEmail/);
  assert.match(storefrontSource, /account: order\.customerAccount/);
  assert.match(storefrontSource, /pointsEarned: rewardSummary\.pointsEarned/);
  assert.match(storefrontSource, /ledgerCount: rewardSummary\.ledgerCount/);
  assert.match(radarServiceSource, /rewardReceiptSummaryForPosSaleReference\(receipt\.saleReference, recipientEmail\)/);
  assert.match(radarServiceSource, /snapshot: await posReceiptEmailSnapshot\(receipt, supportEmail, requestedReceiptEmail\)/);
  assert.match(radarServiceSource, /snapshot: await posReceiptEmailSnapshot\(receipt, supportEmail, requestedEmail\)/);
  assert.match(receiptPreviewSource, /pos_recipient_mismatch/);
  assert.match(receiptPreviewSource, /rewards_disabled/);
  assert.match(receiptPreviewSource, /guest_unlinked/);
  assert.doesNotMatch(receiptEmailSource, /customerAccountId|ledgerId|rewardLedgerEntryId|metadataJson/);
  assert.match(receiptEmailSource, /validatedReceiptRewardSummary/);
  assert.match(receiptEmailSource, new RegExp('url\\.pathname === "/account/rewards"'));
  assert.match(receiptEmailSource, /url\.search === ""/);
});

test("POS checkout keeps email optional, validates when checked, and never creates accounts from guest receipt email", () => {
  assert.match(validationSource, /emailReceipt/);
  assert.match(validationSource, /receiptEmail/);
  assert.match(validationSource, /Enter an email address for the receipt\./);
  assert.match(radarAppSource, /const \[emailReceipt, setEmailReceipt\] = useState\(false\)/);
  assert.match(radarAppSource, /Email receipt/);
  assert.match(radarAppSource, /Receipt email is not configured/);
  assert.match(radarAppSource, /receiptEmailReady=\{posReceiptEmailReady\}/);
  assert.match(radarAppSource, /if \(!receiptEmailReady\)[\s\S]{0,120}Receipt email is not configured\./);
  assert.match(radarAppSource, /No account is required/);
  assert.match(radarAppSource, /setReceiptEmail\(result\.match\.displayEmail\)/);
  assert.match(radarAppSource, /emailReceipt && posReceiptEmailReady && !validReceiptEmail\(receiptEmail\)/);
  assert.match(radarAppSource, /receiptEmail: posReceiptEmailReady && emailReceipt \? receiptEmail\.trim\(\) : undefined/);
  assert.match(radarServiceSource, /input\.emailReceipt && posReceiptEmailReady \? normalizeReceiptEmail/);
  assert.match(radarServiceSource, /receiptEmailDelivery: notRequestedReceiptEmailDelivery\(\)/);
  assert.match(radarAppSource, /Receipt not emailed/);
  assert.match(radarAppSource, /Change email and send/);
  assert.doesNotMatch(radarServiceSource, /receiptEmail[\s\S]{0,300}createCustomerAccount/);
  assert.doesNotMatch(radarServiceSource, /receiptEmail[\s\S]{0,300}connectOrCreate/);
});

test("POS receipt email control stays compact, semantic, and receipt scoped", () => {
  assert.match(radarAppSource, /<label className="pos-receipt-email-toggle" htmlFor="pos-email-receipt">/);
  assert.match(radarAppSource, /id="pos-email-receipt"[\s\S]{0,160}type="checkbox"/);
  assert.match(radarAppSource, /<span>Email receipt<\/span>/);
  assert.match(radarAppSource, /className="pos-receipt-email-helper"/);
  assert.match(globalsCssSource, /\.pos-receipt-email-toggle\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*fit-content;/);
  assert.match(globalsCssSource, /\.pos-receipt-email-toggle input\s*\{[^}]*appearance:\s*none;[^}]*width:\s*20px;[^}]*height:\s*20px;/);
  assert.match(globalsCssSource, /\.pos-receipt-email-toggle input\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-width:\s*20px;[^}]*max-height:\s*20px;[^}]*padding:\s*0;/);
  assert.match(globalsCssSource, /\.pos-receipt-email-toggle input:focus-visible\s*\{/);
  assert.match(globalsCssSource, /\.pos-receipt-email-toggle:has\(input:disabled\)\s*\{/);
  assert.doesNotMatch(globalsCssSource, /\.pos-receipt-email-toggle\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(globalsCssSource, /\.pos-receipt-email-toggle input\s*\{[^}]*width:\s*100%;/);
});

test("POS sale integrity is independent from receipt-email delivery failure", () => {
  assert.match(posSaleRouteSource, /requestId/);
  assert.match(radarServiceSource, /emailReceipt\?: boolean/);
  assert.match(radarServiceSource, /attachPosReceiptEmailDeliveryResult\(\{/);
  assert.match(receiptEmailSource, /requestDelivery \?\? requestReceiptEmailDelivery/);
  assert.match(receiptEmailSource, /return \{ \.\.\.input\.receipt, receiptEmailDelivery: delivery \};/);
  assert.match(receiptEmailSource, /fallbackReceiptEmailDelivery/);
  assert.match(receiptEmailSource, /The sale completed, but the receipt email could not be sent\./);
  assert.match(receiptEmailSource, /sendEmailViaProvider/);
  assert.match(receiptEmailSource, /const status = sendResult\.status === "sent" \? "SENT" : "FAILED";/);
  assert.match(receiptEmailSource, /sanitizedFailureCode/);
  assert.doesNotMatch(receiptEmailSource, /throw sendResult|throw new Error\(sendResult/);
});

test("manual POS receipt resend is admin-only, rate limited, and constrained to canonical receipts", () => {
  assert.match(posResendRouteSource, /requireUser/);
  assert.match(posResendRouteSource, /authorizeAdminMutation/);
  assert.match(posResendRouteSource, /receiptEmailResendSchema/);
  assert.match(posResendRouteSource, /admin_receipt_email/);
  assert.match(posResendRouteSource, /sendPosReceiptEmail/);
  assert.match(rateLimitSource, /"admin_receipt_email"/);
  assert.match(radarServiceSource, /receiptForExistingPosSale/);
  assert.match(radarServiceSource, /posReceiptEmailSnapshot\(receipt/);
  assert.match(radarServiceSource, /Receipt resend idempotency key is required\./);
  assert.match(validationSource, /idempotencyKey: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(120\)\.regex/);
  assert.doesNotMatch(radarServiceSource, /receipt:pos:resend:[\s\S]{0,120}Date\.now/);
  assert.doesNotMatch(storefrontSource, /receipt:storefront:resend:[\s\S]{0,120}Date\.now/);
  assert.doesNotMatch(radarAppSource, /receipt-resend[^\\n]*Date\.now/);
  assert.doesNotMatch(radarAppSource, /order-receipt-resend[^\\n]*Date\.now/);
  assert.doesNotMatch(posResendRouteSource, /html|body|subject/);
});

test("audit events use masked metadata and never log full receipt bodies", () => {
  assert.match(receiptEmailSource, /pos\.receipt_email\.requested/);
  assert.match(receiptEmailSource, /receipt_email\.\$\{input\.deliveryType === "RESEND" && status === "SENT" \? "resent" : status === "SENT" \? "sent" : "failed"\}/);
  assert.match(receiptEmailSource, /maskedEmail: delivery\.recipientEmailMasked/);
  assert.match(receiptEmailSource, /attemptNumber: updated\.attemptCount/);
  assert.doesNotMatch(receiptEmailSource, /metadata:[\s\S]{0,500}(html|text|lineItems|recipientEmailNormalized)/);
});

test("receipt delivery availability is deterministic and does not create disabled pending attempts", () => {
  const configured = {
    POS_RECEIPT_EMAILS_ENABLED: "true",
    STOREFRONT_RECEIPT_EMAILS_ENABLED: "true",
    RESEND_API_KEY: "test_resend_key",
    EMAIL_FROM: "GameDayGrabs <receipts@example.com>"
  };
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", configured), true);
  assert.equal(receiptEmailDeliveryAvailable("STOREFRONT_ORDER", configured), true);
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", { ...configured, POS_RECEIPT_EMAILS_ENABLED: "false" }), false);
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", { POS_RECEIPT_EMAILS_ENABLED: "true" }), false);
  assert.deepEqual(notRequestedReceiptEmailDelivery(), {
    status: "NOT_REQUESTED",
    deliveryType: null,
    maskedRecipient: null,
    sentAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    sanitizedFailureCode: null,
    sanitizedFailureMessage: null
  });
  assert.doesNotMatch(receiptEmailSource, /RECEIPT_EMAILS_DISABLED[\s\S]{0,240}status: "PENDING"/);
});

test("receipt delivery fallback DTOs are sanitized and preserve completed-sale behavior", () => {
  const delivery = fallbackReceiptEmailDelivery({
    status: "FAILED",
    deliveryType: "INITIAL",
    recipientEmail: "Collector@example.com",
    sanitizedFailureCode: "RECEIPT_EMAIL_UNAVAILABLE",
    sanitizedFailureMessage: "The sale completed, but the receipt email could not be sent."
  });
  assert.equal(delivery.status, "FAILED");
  assert.equal(delivery.deliveryType, "INITIAL");
  assert.equal(delivery.maskedRecipient, "c***@example.com");
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.sanitizedFailureCode, "RECEIPT_EMAIL_UNAVAILABLE");
  assert.equal(delivery.sanitizedFailureMessage, "The sale completed, but the receipt email could not be sent.");
});
