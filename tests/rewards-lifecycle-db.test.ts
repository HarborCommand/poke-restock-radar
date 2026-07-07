import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-rewards-lifecycle-"));
const testDbPath = path.join(testDbDir, "rewards-lifecycle.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
process.env.CUSTOMER_REWARDS_ENABLED = "true";
process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";
process.env.CUSTOMER_REWARD_PENDING_DAYS = "0";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const rewardsModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-rewards.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const {
  awardRewardsForPaidOrder,
  releasePendingRewardsForOrder,
  reverseRewardsForOrder,
  rewardSummaryForOrder
} = rewardsModule as typeof import("../src/lib/customer-rewards");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

async function createRewardTestOrder(input: {
  subtotal?: number;
  itemLineTotal?: number;
  paymentStatus?: string;
  status?: string;
  fulfillmentStatus?: string;
  refundedAmount?: number;
  isTestOrder?: boolean;
}) {
  const user = await prisma.user.create({
    data: {
      email: `${unique("rewards-owner")}@example.test`,
      name: "Rewards Test Owner",
      role: "ADMIN",
      passwordHash: "test-hash"
    }
  });
  const subtotal = input.subtotal ?? input.itemLineTotal ?? 125.75;
  const order = await prisma.storefrontOrder.create({
    data: {
      userId: user.id,
      orderNumber: unique("RWD"),
      customerEmail: `${unique("collector")}@example.test`,
      customerName: "Rewards Customer",
      status: input.status ?? "paid",
      paymentStatus: input.paymentStatus ?? "paid",
      fulfillmentStatus: input.fulfillmentStatus ?? "unfulfilled",
      subtotal,
      shippingCharged: 7.99,
      tax: 3.25,
      total: subtotal + 7.99 + 3.25,
      refundedAmount: input.refundedAmount ?? 0,
      isTestOrder: input.isTestOrder ?? false
    }
  });
  return {
    ...order,
    customer: null,
    items: [{ lineTotal: input.itemLineTotal ?? subtotal }],
    rewardLedgerEntries: []
  };
}

async function ledgerForOrder(orderId: string) {
  return prisma.rewardLedgerEntry.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
}

async function balanceForOrder(orderId: string) {
  const ledger = await ledgerForOrder(orderId);
  assert.ok(ledger[0]?.customerAccountId, "expected a reward ledger customer account");
  const balance = await prisma.rewardBalance.findUnique({ where: { customerAccountId: ledger[0].customerAccountId } });
  assert.ok(balance, "expected reward balance");
  return balance;
}

test("paid order award creates one pending ledger entry and is duplicate-safe", async () => {
  const order = await createRewardTestOrder({ itemLineTotal: 125.75 });

  assert.deepEqual(await awardRewardsForPaidOrder(order), { status: "pending", points: 125 });
  assert.deepEqual(await awardRewardsForPaidOrder(order), { status: "already_awarded", points: 125 });

  const ledger = await ledgerForOrder(order.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].points, 125);
  assert.equal(ledger[0].type, "earn");
  assert.equal(ledger[0].status, "pending");
  assert.equal(ledger[0].source, "stripe_checkout");
  assert.equal(ledger[0].eligibleSubtotalCents, 12575);
  assert.equal(ledger[0].idempotencyKey, `rewards:earn:${order.id}`);
  assert.ok(ledger[0].availableAt);
  assert.equal(ledger[0].settledAt, null);

  const balance = await balanceForOrder(order.id);
  assert.equal(balance.pendingPoints, 125);
  assert.equal(balance.availablePoints, 0);
  assert.equal(balance.lifetimeEarnedPoints, 125);
});

test("release on shipped and picked_up moves pending to available once", async () => {
  const shippedOrder = await createRewardTestOrder({ itemLineTotal: 50 });
  await awardRewardsForPaidOrder(shippedOrder);

  assert.deepEqual(await releasePendingRewardsForOrder(shippedOrder.id, "shipped"), { status: "released", points: 50 });
  assert.deepEqual(await releasePendingRewardsForOrder(shippedOrder.id, "shipped"), { status: "no_pending_rewards", points: 0 });

  const shippedBalance = await balanceForOrder(shippedOrder.id);
  assert.equal(shippedBalance.pendingPoints, 0);
  assert.equal(shippedBalance.availablePoints, 50);
  assert.equal(shippedBalance.lifetimeEarnedPoints, 50);
  const [shippedLedger] = await ledgerForOrder(shippedOrder.id);
  assert.equal(shippedLedger.status, "available");
  assert.ok(shippedLedger.settledAt);

  const pickupOrder = await createRewardTestOrder({ itemLineTotal: 42 });
  await awardRewardsForPaidOrder(pickupOrder);
  assert.deepEqual(await releasePendingRewardsForOrder(pickupOrder.id, "picked_up"), { status: "released", points: 42 });
  assert.deepEqual(await releasePendingRewardsForOrder(pickupOrder.id, "picked_up"), { status: "no_pending_rewards", points: 0 });

  const pickupBalance = await balanceForOrder(pickupOrder.id);
  assert.equal(pickupBalance.pendingPoints, 0);
  assert.equal(pickupBalance.availablePoints, 42);
  assert.equal(pickupBalance.lifetimeEarnedPoints, 42);
});

test("full reversal before release removes pending points and is idempotent", async () => {
  const order = await createRewardTestOrder({ itemLineTotal: 80, status: "canceled" });
  await awardRewardsForPaidOrder(order);

  assert.deepEqual(await reverseRewardsForOrder({ ...order, status: "canceled" }, { reason: "cancel", idempotencyKey: "cancel-before-release" }), {
    status: "reversed",
    points: 80
  });
  assert.deepEqual(await reverseRewardsForOrder({ ...order, status: "canceled" }, { reason: "cancel", idempotencyKey: "cancel-before-release" }), {
    status: "already_reversed",
    points: 0
  });

  const balance = await balanceForOrder(order.id);
  assert.equal(balance.pendingPoints, 0);
  assert.equal(balance.availablePoints, 0);
  assert.equal(balance.lifetimeEarnedPoints, 80);
  const ledger = await ledgerForOrder(order.id);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].status, "canceled");
  assert.equal(ledger[1].points, -80);
  assert.equal(ledger[1].status, "reversed");
});

test("full reversal after release removes available points and duplicate reversal is safe", async () => {
  const order = await createRewardTestOrder({ itemLineTotal: 90, paymentStatus: "refunded", status: "refunded", refundedAmount: 105 });
  await awardRewardsForPaidOrder({ ...order, paymentStatus: "paid", status: "paid", refundedAmount: 0 });
  await releasePendingRewardsForOrder(order.id, "shipped");

  assert.deepEqual(
    await reverseRewardsForOrder({ ...order, paymentStatus: "refunded", status: "refunded", refundedAmount: 105 }, { reason: "refund", idempotencyKey: "refund-after-release" }),
    { status: "reversed", points: 90 }
  );
  assert.deepEqual(
    await reverseRewardsForOrder({ ...order, paymentStatus: "refunded", status: "refunded", refundedAmount: 105 }, { reason: "refund", idempotencyKey: "refund-after-release" }),
    { status: "already_reversed", points: 0 }
  );

  const balance = await balanceForOrder(order.id);
  assert.equal(balance.pendingPoints, 0);
  assert.equal(balance.availablePoints, 0);
  assert.equal(balance.lifetimeEarnedPoints, 90);
  const ledger = await ledgerForOrder(order.id);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].status, "canceled");
  assert.equal(ledger[1].points, -90);
});

test("partial refund prorates against eligible product subtotal", async () => {
  const order = await createRewardTestOrder({ itemLineTotal: 100, paymentStatus: "partially_refunded", status: "partially_refunded", refundedAmount: 25 });
  await awardRewardsForPaidOrder({ ...order, paymentStatus: "paid", status: "paid", refundedAmount: 0 });
  await releasePendingRewardsForOrder(order.id, "shipped");

  assert.deepEqual(
    await reverseRewardsForOrder(
      { ...order, paymentStatus: "partially_refunded", status: "partially_refunded", refundedAmount: 25 },
      { reason: "refund", idempotencyKey: "partial-refund", refundedAmount: 25 }
    ),
    { status: "reversed", points: 25 }
  );
  assert.deepEqual(
    await reverseRewardsForOrder(
      { ...order, paymentStatus: "partially_refunded", status: "partially_refunded", refundedAmount: 25 },
      { reason: "refund", idempotencyKey: "partial-refund", refundedAmount: 25 }
    ),
    { status: "already_reversed", points: 0 }
  );

  const balance = await balanceForOrder(order.id);
  assert.equal(balance.pendingPoints, 0);
  assert.equal(balance.availablePoints, 75);
  assert.equal(balance.lifetimeEarnedPoints, 100);
  const ledger = await ledgerForOrder(order.id);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[1].points, -25);
});

test("legacy null-status ledger entries summarize safely", () => {
  const availableLegacy = rewardSummaryForOrder({
    isTestOrder: false,
    rewardLedgerEntries: [{ points: 10, type: "earn", status: null }]
  });
  assert.equal(availableLegacy.pointsPending, 0);
  assert.equal(availableLegacy.pointsAvailable, 10);
  assert.equal(availableLegacy.netPoints, 10);
  assert.equal(availableLegacy.status, "Rewards available");

  const reversedLegacy = rewardSummaryForOrder({
    isTestOrder: false,
    rewardLedgerEntries: [
      { points: 10, type: "earn", status: null },
      { points: -4, type: "reverse", status: null }
    ]
  });
  assert.equal(reversedLegacy.pointsPending, 0);
  assert.equal(reversedLegacy.pointsAvailable, 6);
  assert.equal(reversedLegacy.pointsReversed, 4);
  assert.equal(reversedLegacy.status, "Rewards adjusted");
});

test("test and unpaid orders do not earn rewards", async () => {
  const testOrder = await createRewardTestOrder({ itemLineTotal: 60, isTestOrder: true });
  assert.deepEqual(await awardRewardsForPaidOrder(testOrder), { status: "test_order", points: 0 });
  assert.equal((await ledgerForOrder(testOrder.id)).length, 0);

  const unpaidOrder = await createRewardTestOrder({ itemLineTotal: 60, paymentStatus: "pending", status: "pending_payment" });
  assert.deepEqual(await awardRewardsForPaidOrder(unpaidOrder), { status: "not_paid", points: 0 });
  assert.equal((await ledgerForOrder(unpaidOrder.id)).length, 0);
});
