import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/lib/db";
import {
  claimProviderEvent,
  completeProviderEvent,
  runTaxRefundTransaction
} from "../src/lib/tax-refund-concurrency";
import { applyStripeRefundSnapshot, cancelOrRefundStorefrontOrder } from "../src/lib/storefront";
import { refundPosSale } from "../src/lib/radar-service";
import type { SessionUser } from "../src/types/radar";

const enabled = Boolean(process.env.TAX_CONCURRENCY_DATABASE_URL);
const postgresTest = enabled ? test : test.skip;
const prefix = `tax-concurrency-${process.pid}`;
const userId = `${prefix}-user`;
const user: SessionUser = {
  id: userId,
  email: `${prefix}@example.test`,
  name: "Tax Concurrency Test",
  role: "ADMIN",
  canAddSightings: true,
  canAddComps: true,
  canRunChecks: true,
  canReceivePushAlerts: false
};
let sequence = 0;

function unique(label: string) {
  sequence += 1;
  return `${prefix}-${label}-${sequence}`;
}

async function createOrder(input: {
  taxCents?: number | null;
  customerAccountId?: string | null;
  paymentStatus?: string;
  status?: string;
  fulfillmentStatus?: string;
} = {}) {
  const id = unique("order");
  const taxCents = input.taxCents === undefined ? 800 : input.taxCents;
  const subtotalCents = taxCents === null ? 10_000 : 9_200;
  return prisma.storefrontOrder.create({
    data: {
      id,
      orderNumber: unique("number").toUpperCase(),
      userId,
      customerAccountId: input.customerAccountId ?? null,
      status: input.status ?? "paid",
      paymentStatus: input.paymentStatus ?? "paid",
      fulfillmentStatus: input.fulfillmentStatus ?? "shipped",
      stripePaymentIntentId: unique("pi"),
      subtotalCents,
      discountCents: 0,
      shippingCents: 0,
      taxableSubtotalCents: taxCents === null ? null : subtotalCents,
      taxCents,
      totalCents: 10_000,
      refundedTaxCents: taxCents === null ? null : 0,
      taxProvider: taxCents === null ? null : "stripe_tax",
      taxStatus: taxCents === null ? "not_recorded" : "collected",
      subtotal: subtotalCents / 100,
      tax: taxCents === null ? 0 : taxCents / 100,
      total: 100,
      paidAt: new Date(),
      isTestOrder: true
    }
  });
}

async function createPosSale(label: string) {
  const itemId = unique(`${label}-item`);
  const saleReference = unique(`${label}-pos`);
  await prisma.inventoryItem.create({
    data: { id: itemId, userId, itemType: "sealed", itemName: `Concurrency POS fixture ${label}`, cost: 50, quantity: 1, source: "Preview QA", purchasedAt: new Date() }
  });
  await prisma.inventorySale.create({
    data: {
      id: unique(`${label}-sale`), inventoryItemId: itemId, userId, quantitySold: 1, soldPricePerItem: 100,
      grossSale: 107, platform: "pos", netSale: 100, costBasis: 50, profitLoss: 50, saleReference,
      subtotalCents: 10_000, discountCents: 0, taxableSubtotalCents: 10_000, taxCents: 700, totalCents: 10_700,
      taxProvider: "configured_pos_rate", stateTaxCents: 600, countySurtaxCents: 100, combinedRateBasisPoints: 700,
      taxJurisdictionCountry: "US", taxJurisdictionState: "FL", taxJurisdictionCounty: "Snapshot County",
      taxStatus: "collected", taxExempt: false, refundedTaxCents: 0, soldAt: new Date()
    }
  });
  return { itemId, saleReference };
}

function refundInput(idempotencyKey: string, amount?: number) {
  return {
    reason: "customer_requested" as const,
    adminNote: "Dedicated Postgres concurrency fixture.",
    refundType: amount === undefined ? "full" as const : "partial" as const,
    partialRefundAmount: amount,
    returnItemsToStock: false,
    sendCustomerEmail: false,
    idempotencyKey
  };
}

function provider(counter: { calls: number }, delayMs = 30) {
  return {
    createRefund: async (input: { idempotencyKey: string }) => {
      counter.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { id: `re_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "_")}`, status: "succeeded" };
    }
  };
}

test.before(async () => {
  if (!enabled) return;
  assert.match(process.env.DATABASE_URL ?? "", /^postgres(?:ql)?:\/\//);
  assert.equal(process.env.DATABASE_URL, process.env.TAX_CONCURRENCY_DATABASE_URL);
  await prisma.user.upsert({
    where: { id: userId },
    update: { disabledAt: null },
    create: { id: userId, email: user.email, name: user.name, role: "ADMIN", passwordHash: "preview-test-only" }
  });
});

postgresTest("A. simultaneous duplicate payment webhooks persist one paid tax snapshot", async (t) => {
  const eventId = unique("event");
  const order = await createOrder({ taxCents: null, status: "pending", paymentStatus: "pending", fulfillmentStatus: "unfulfilled" });
  let invocations = 0;
  const claims = await Promise.all(Array.from({ length: 12 }, async () => {
    const claim = await claimProviderEvent({ eventId, eventType: "checkout.session.completed", orderId: order.id, provider: "stripe", payload: "{}" });
    if (claim === "claimed") {
      invocations += 1;
      await prisma.storefrontOrder.updateMany({
        where: { id: order.id, paymentStatus: { not: "paid" } },
        data: {
          status: "paid",
          paymentStatus: "paid",
          taxCents: 800,
          refundedTaxCents: 0,
          taxStatus: "collected",
          taxProvider: "stripe_tax",
          totalCents: 10_000
        }
      });
      await completeProviderEvent({ eventId, eventType: "checkout.session.completed", orderId: order.id, payload: "{}" });
    }
    return claim;
  }));
  assert.equal(claims.filter((claim) => claim === "claimed").length, 1);
  assert.equal(invocations, 1);
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.paymentStatus, "paid");
  assert.equal(persisted.taxCents, 800);
  assert.equal(await prisma.paymentEvent.count({ where: { eventId, eventType: "checkout.session.completed" } }), 1);
  t.diagnostic(JSON.stringify({ invocations: 12, businessInvocations: invocations, paymentEvents: 1, paymentStatus: persisted.paymentStatus, taxCents: persisted.taxCents }));
});

postgresTest("B. simultaneous duplicate full-refund webhooks apply one immutable tax adjustment", async (t) => {
  const order = await createOrder();
  const providerRefundId = unique("provider-refund");
  const results = await Promise.all(Array.from({ length: 8 }, () => applyStripeRefundSnapshot({
    orderId: order.id,
    providerRefundId,
    amountCents: 10_000,
    status: "succeeded"
  })));
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(persisted.paymentStatus, "refunded");
  assert.equal(persisted.refundedAmount, 100);
  assert.equal(persisted.refundedTaxCents, 800);
  assert.equal(persisted.taxCents, 800);
  assert.equal(await prisma.taxAdjustment.count({ where: { storefrontOrderId: order.id, providerReference: providerRefundId } }), 1);
  t.diagnostic(JSON.stringify({ invocations: 8, applied: 1, adjustments: 1, paymentStatus: persisted.paymentStatus, refundedTaxCents: persisted.refundedTaxCents }));
});

postgresTest("G. repeated admin full-refund submissions produce one provider and one tax effect", async (t) => {
  const order = await createOrder();
  const key = unique("duplicate-refund");
  const counter = { calls: 0 };
  await Promise.all(Array.from({ length: 8 }, () => cancelOrRefundStorefrontOrder(user, order.id, refundInput(key), provider(counter))));
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(counter.calls, 1);
  assert.equal(persisted.refundedAmount, 100);
  assert.equal(persisted.refundedTaxCents, 800);
  assert.equal(persisted.taxStatus, "refunded");
  assert.equal(await prisma.taxAdjustment.count({ where: { storefrontOrderId: order.id } }), 1);
  t.diagnostic(JSON.stringify({ invocations: 8, providerCalls: counter.calls, adjustments: 1, refundedAmountCents: 10_000, refundedTaxCents: persisted.refundedTaxCents }));
});

postgresTest("C. concurrent partial online refunds serialize and cumulative tax stays bounded", async (t) => {
  const order = await createOrder();
  const counter = { calls: 0 };
  await Promise.all([
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("partial-a"), 30), provider(counter)),
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("partial-b"), 30), provider(counter))
  ]);
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  const adjustments = await prisma.taxAdjustment.aggregate({
    where: { storefrontOrderId: order.id },
    _count: true,
    _sum: { refundedAmountCents: true, refundedTaxCents: true }
  });
  assert.equal(counter.calls, 2);
  assert.equal(persisted.refundedAmount, 60);
  assert.equal(persisted.refundedTaxCents, 480);
  assert.equal(adjustments._count, 2);
  assert.equal(adjustments._sum.refundedAmountCents, 6_000);
  assert.equal(adjustments._sum.refundedTaxCents, 480);
  assert.ok((persisted.refundedTaxCents ?? 0) <= (persisted.taxCents ?? 0));
  t.diagnostic(JSON.stringify({ invocations: 2, providerCalls: counter.calls, adjustments: adjustments._count, refundedAmountCents: 6_000, refundedTaxCents: persisted.refundedTaxCents }));
});

postgresTest("D. payment completion versus provider refund race converges after safe webhook retry", async (t) => {
  const order = await createOrder({ taxCents: null, status: "pending", paymentStatus: "pending", fulfillmentStatus: "unfulfilled" });
  const providerRefundId = unique("payment-refund-race");
  const paymentCompletion = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    await prisma.storefrontOrder.updateMany({
      where: {
        id: order.id,
        paymentStatus: { notIn: ["paid", "partially_refunded", "refunded"] },
        status: { notIn: ["canceled", "partially_refunded", "refunded"] }
      },
      data: {
        status: "paid",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        taxCents: 800,
        refundedTaxCents: 0,
        taxStatus: "collected",
        taxProvider: "stripe_tax"
      }
    });
  })();
  await Promise.allSettled([
    paymentCompletion,
    applyStripeRefundSnapshot({ orderId: order.id, providerRefundId, amountCents: 10_000, status: "succeeded" })
  ]);
  await paymentCompletion;
  await applyStripeRefundSnapshot({ orderId: order.id, providerRefundId, amountCents: 10_000, status: "succeeded" });
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.paymentStatus, "refunded");
  assert.equal(persisted.taxCents, 800);
  assert.equal(persisted.refundedTaxCents, 800);
  assert.equal(await prisma.taxAdjustment.count({ where: { storefrontOrderId: order.id, providerReference: providerRefundId } }), 1);
  t.diagnostic(JSON.stringify({ concurrentInvocations: 2, webhookRetries: 1, adjustments: 1, paymentStatus: persisted.paymentStatus, refundedTaxCents: persisted.refundedTaxCents }));
});

postgresTest("overlapping excessive refunds reject before a second provider call", async () => {
  const order = await createOrder();
  const counter = { calls: 0 };
  const results = await Promise.allSettled([
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("excess-a"), 60), provider(counter, 50)),
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("excess-b"), 60), provider(counter, 50))
  ]);
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(counter.calls, 1);
  assert.equal(persisted.refundedAmount, 60);
  assert.equal(persisted.refundedTaxCents, 480);
});

postgresTest("provider failure rolls back order tax reward and adjustment state", async () => {
  const order = await createOrder();
  let calls = 0;
  await assert.rejects(() => cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("failure")), {
    createRefund: async () => {
      calls += 1;
      throw new Error("simulated test provider failure");
    }
  }), /simulated test provider failure/);
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(calls, 1);
  assert.equal(persisted.paymentStatus, "paid");
  assert.equal(persisted.refundedAmount, 0);
  assert.equal(persisted.refundedTaxCents, 0);
  assert.equal(await prisma.taxAdjustment.count({ where: { storefrontOrderId: order.id } }), 0);
  assert.equal(await prisma.rewardLedgerEntry.count({ where: { orderId: order.id, points: { lt: 0 } } }), 0);
});

postgresTest("historical unknown tax remains unknown through a full refund", async () => {
  const order = await createOrder({ taxCents: null });
  const counter = { calls: 0 };
  await cancelOrRefundStorefrontOrder(user, order.id, refundInput(unique("historical")), provider(counter));
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  const adjustment = await prisma.taxAdjustment.findFirstOrThrow({ where: { storefrontOrderId: order.id } });
  assert.equal(counter.calls, 1);
  assert.equal(persisted.refundedTaxCents, null);
  assert.equal(persisted.taxStatus, "not_recorded");
  assert.equal(adjustment.refundedTaxCents, 0);
  assert.match(adjustment.metadataJson ?? "", /historical_unknown/);
});

postgresTest("H. refund versus rewards reversal race excludes tax and reverses once", async (t) => {
  const customerId = unique("customer");
  await prisma.customerAccount.create({
    data: { id: customerId, userId, email: `${customerId}@example.test`, normalizedEmail: `${customerId}@example.test`, emailVerifiedAt: new Date() }
  });
  const order = await createOrder({ customerAccountId: customerId });
  await prisma.rewardBalance.create({ data: { customerAccountId: customerId, availablePoints: 92, lifetimeEarnedPoints: 92 } });
  await prisma.rewardLedgerEntry.create({
    data: { customerAccountId: customerId, orderId: order.id, points: 92, type: "earn", reason: "Test merchandise reward", idempotencyKey: `rewards:earn:${order.id}`, status: "available", eligibleSubtotalCents: 9_200 }
  });
  const counter = { calls: 0 };
  const key = unique("reward-refund");
  await Promise.all([
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(key), provider(counter)),
    cancelOrRefundStorefrontOrder(user, order.id, refundInput(key), provider(counter))
  ]);
  const reversals = await prisma.rewardLedgerEntry.findMany({ where: { orderId: order.id, points: { lt: 0 } } });
  const balance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: customerId } });
  assert.equal(counter.calls, 1);
  assert.equal(reversals.length, 1);
  assert.equal(reversals[0]?.points, -92);
  assert.equal(balance.availablePoints, 0);
  t.diagnostic(JSON.stringify({ invocations: 2, providerCalls: counter.calls, rewardReversals: reversals.length, reversedPoints: 92, availablePoints: balance.availablePoints }));
});

postgresTest("E. duplicate POS full refund uses the stored snapshot once despite settings changes", async (t) => {
  const { saleReference } = await createPosSale("duplicate");
  await prisma.storefrontSettings.upsert({
    where: { userId },
    update: { stateTaxRateBasisPoints: 900, countyTaxRateBasisPoints: 100 },
    create: { userId, stateTaxRateBasisPoints: 900, countyTaxRateBasisPoints: 100 }
  });
  const key = unique("pos-refund");
  const input = { idempotencyKey: key, refundType: "full" as const, reason: "customer_return", note: "Concurrency test", restoreInventory: false };
  await Promise.all([refundPosSale(user, saleReference, input), refundPosSale(user, saleReference, input)]);
  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference } });
  assert.equal(sale.refundedAmount, 107);
  assert.equal(sale.refundedTaxCents, 700);
  assert.equal(sale.taxStatus, "refunded");
  assert.equal(await prisma.taxAdjustment.count({ where: { saleReference } }), 1);
  t.diagnostic(JSON.stringify({ invocations: 2, adjustments: 1, refundedAmountCents: 10_700, refundedTaxCents: sale.refundedTaxCents, originalTaxCents: sale.taxCents }));
});

postgresTest("F. two partial POS refunds serialize and cannot exceed original collected tax", async (t) => {
  const { saleReference } = await createPosSale("partial");
  const results = await Promise.all([
    refundPosSale(user, saleReference, {
      idempotencyKey: unique("pos-partial-a"), refundType: "partial", partialRefundAmount: 50,
      reason: "customer_return", note: "Concurrent partial A", restoreInventory: false
    }),
    refundPosSale(user, saleReference, {
      idempotencyKey: unique("pos-partial-b"), refundType: "partial", partialRefundAmount: 50,
      reason: "customer_return", note: "Concurrent partial B", restoreInventory: false
    })
  ]);
  assert.equal(results.length, 2);
  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference } });
  const adjustments = await prisma.taxAdjustment.aggregate({
    where: { saleReference },
    _count: true,
    _sum: { refundedAmountCents: true, refundedTaxCents: true }
  });
  assert.equal(sale.refundedAmount, 100);
  assert.equal(adjustments._count, 2);
  assert.equal(adjustments._sum.refundedAmountCents, 10_000);
  assert.equal(adjustments._sum.refundedTaxCents, sale.refundedTaxCents);
  assert.ok((sale.refundedTaxCents ?? 0) <= (sale.taxCents ?? 0));
  t.diagnostic(JSON.stringify({ invocations: 2, adjustments: adjustments._count, refundedAmountCents: adjustments._sum.refundedAmountCents, refundedTaxCents: sale.refundedTaxCents, originalTaxCents: sale.taxCents }));
});

postgresTest("I. cancellation racing tax persistence leaves a deterministic canceled order without an orphan adjustment", async (t) => {
  const order = await createOrder({ taxCents: null, status: "pending", paymentStatus: "pending", fulfillmentStatus: "unfulfilled" });
  const cancellation = cancelOrRefundStorefrontOrder(user, order.id, {
    reason: "customer_requested",
    adminNote: "Cancellation versus tax persistence race.",
    refundType: "none",
    returnItemsToStock: false,
    sendCustomerEmail: false,
    idempotencyKey: unique("cancel-tax-race")
  });
  const taxPersistence = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return prisma.storefrontOrder.updateMany({
      where: {
        id: order.id,
        paymentStatus: { notIn: ["paid", "partially_refunded", "refunded", "refund_pending"] },
        status: { notIn: ["canceled", "refunded", "partially_refunded", "refund_pending"] }
      },
      data: { taxCents: 800, refundedTaxCents: 0, taxStatus: "collected", taxProvider: "stripe_tax" }
    });
  })();
  await Promise.all([cancellation, taxPersistence]);
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.status, "canceled");
  assert.equal(persisted.paymentStatus, "not_applicable");
  assert.equal(await prisma.taxAdjustment.count({ where: { storefrontOrderId: order.id } }), 0);
  t.diagnostic(JSON.stringify({ invocations: 2, status: persisted.status, paymentStatus: persisted.paymentStatus, adjustments: 0 }));
});

postgresTest("J. real Serializable conflicts retry within bounds without duplicating increments", async (t) => {
  const itemId = unique("serialization-item");
  await prisma.inventoryItem.create({
    data: { id: itemId, userId, itemType: "sealed", itemName: "Concurrency serialization fixture", cost: 1, quantity: 0, source: "Preview QA", purchasedAt: new Date() }
  });
  const invocationCount = 6;
  let ready = 0;
  let releaseFirstAttempts!: () => void;
  const firstAttemptGate = new Promise<void>((resolve) => { releaseFirstAttempts = resolve; });
  let attempts = 0;
  let retries = 0;
  await Promise.all(Array.from({ length: invocationCount }, async () => {
    let firstAttempt = true;
    await runTaxRefundTransaction(async (tx) => {
      attempts += 1;
      await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, select: { quantity: true } });
      if (firstAttempt) {
        firstAttempt = false;
        ready += 1;
        if (ready === invocationCount) releaseFirstAttempts();
        await firstAttemptGate;
      }
      await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: { increment: 1 } } });
    }, prisma, 8, () => { retries += 1; });
  }));
  const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  assert.equal(item.quantity, invocationCount);
  assert.ok(retries >= 1);
  assert.equal(attempts, invocationCount + retries);
  assert.ok(attempts <= invocationCount * 8);
  t.diagnostic(JSON.stringify({ invocations: invocationCount, attempts, serializationRetries: retries, finalQuantity: item.quantity, maxAttemptsPerInvocation: 8 }));
});

postgresTest("authoritative zero tax remains distinct from historical unknown during refund", async () => {
  const order = await createOrder({ taxCents: 0 });
  await applyStripeRefundSnapshot({
    orderId: order.id,
    providerRefundId: unique("zero-tax-refund"),
    amountCents: 10_000,
    status: "succeeded"
  });
  const persisted = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.taxCents, 0);
  assert.equal(persisted.refundedTaxCents, 0);
  assert.equal(persisted.taxStatus, "refunded");
});

test.after(async () => {
  if (!enabled) return;
  const testOrderIds = (await prisma.storefrontOrder.findMany({ where: { userId }, select: { id: true } })).map((order) => order.id);
  await prisma.paymentEvent.deleteMany({
    where: {
      OR: [
        { eventId: { startsWith: prefix } },
        ...(testOrderIds.length ? [{ orderId: { in: testOrderIds } }] : [])
      ]
    }
  });
  await prisma.storefrontOrder.deleteMany({ where: { userId, isTestOrder: true } });
  await prisma.inventorySale.deleteMany({ where: { userId, saleReference: { startsWith: prefix } } });
  await prisma.inventoryItem.deleteMany({ where: { userId } });
  await prisma.storefrontSettings.deleteMany({ where: { userId } });
  await prisma.customerAccount.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
