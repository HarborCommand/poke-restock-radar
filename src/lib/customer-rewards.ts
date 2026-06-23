import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { normalizeCustomerAccountEmail, type CurrentCustomerAccount } from "@/lib/customer-account-auth";

const rewardPointsPerDollar = 1;

type RewardOrderItem = {
  lineTotal: number;
};

type RewardOrder = {
  id: string;
  orderNumber: string;
  customerAccountId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  subtotal: number;
  shippingCharged: number;
  tax: number;
  total: number;
  paymentStatus: string;
  status: string;
  refundedAmount: number;
  isTestOrder: boolean;
  customer?: {
    email: string | null;
    customerAccountId?: string | null;
  } | null;
  items: RewardOrderItem[];
  rewardLedgerEntries?: Array<{
    points: number;
    type: string;
  }>;
};

type RewardLedgerTx = Prisma.TransactionClient;

export type CustomerRewardActivityItem = {
  id: string;
  points: number;
  type: string;
  reason: string;
  createdAt: string;
  orderNumber: string | null;
};

export type StorefrontOrderRewardSummary = {
  pointsEarned: number;
  pointsReversed: number;
  netPoints: number;
  ledgerCount: number;
  status: string;
  redemptionEnabled: false;
};

function centsFromMoney(value: number | null | undefined) {
  return Math.max(0, Math.round((value || 0) * 100));
}

function rewardFeatureEnabled() {
  const config = customerAccountFeatureConfig();
  return config.customerAccountsEnabled && config.customerRewardsEnabled;
}

export function customerRewardsEnabled() {
  return rewardFeatureEnabled();
}

export function rewardEligibleSubtotalCents(order: Pick<RewardOrder, "subtotal" | "items">) {
  const subtotalCents = centsFromMoney(order.subtotal);
  if (subtotalCents > 0) return subtotalCents;
  return order.items.reduce((sum, item) => sum + centsFromMoney(item.lineTotal), 0);
}

export function rewardPointsForOrderSubtotal(order: Pick<RewardOrder, "subtotal" | "items">) {
  return Math.floor((rewardEligibleSubtotalCents(order) / 100) * rewardPointsPerDollar);
}

function orderCustomerEmail(order: RewardOrder) {
  return normalizeCustomerAccountEmail(order.customerEmail ?? order.customer?.email ?? null);
}

async function ensureRewardCustomerAccount(tx: RewardLedgerTx, order: RewardOrder) {
  const email = orderCustomerEmail(order);
  if (!email) return null;
  const account = await tx.customerAccount.upsert({
    where: { email },
    update: {},
    create: { email, status: "active" },
    select: { id: true, email: true }
  });
  if (order.customerId) {
    await tx.storefrontCustomer.updateMany({
      where: { id: order.customerId, customerAccountId: null },
      data: { customerAccountId: account.id }
    });
  }
  if (order.customerAccountId !== account.id) {
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: { customerAccountId: account.id }
    });
  }
  return account;
}

async function upsertRewardBalance(tx: RewardLedgerTx, customerAccountId: string, points: number) {
  await tx.rewardBalance.upsert({
    where: { customerAccountId },
    create: {
      customerAccountId,
      availablePoints: points,
      lifetimeEarnedPoints: Math.max(0, points),
      pendingPoints: 0
    },
    update: {
      availablePoints: { increment: points },
      lifetimeEarnedPoints: points > 0 ? { increment: points } : undefined
    }
  });
}

async function createRewardLedgerEntry(input: {
  tx: RewardLedgerTx;
  customerAccountId: string;
  orderId: string;
  idempotencyKey: string;
  points: number;
  type: "earn" | "reverse";
  reason: string;
  metadata: Record<string, unknown>;
}) {
  const existing = await input.tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { created: false, points: existing.points };
  const ledger = await input.tx.rewardLedgerEntry.create({
    data: {
      customerAccountId: input.customerAccountId,
      orderId: input.orderId,
      idempotencyKey: input.idempotencyKey,
      points: input.points,
      type: input.type,
      reason: input.reason,
      metadataJson: JSON.stringify(input.metadata)
    }
  });
  await upsertRewardBalance(input.tx, input.customerAccountId, input.points);
  return { created: true, points: ledger.points };
}

export async function awardRewardsForPaidOrder(order: RewardOrder) {
  if (!rewardFeatureEnabled()) return { status: "disabled" as const, points: 0 };
  if (order.isTestOrder) return { status: "test_order" as const, points: 0 };
  if (order.paymentStatus !== "paid") return { status: "not_paid" as const, points: 0 };

  const eligibleSubtotalCents = rewardEligibleSubtotalCents(order);
  const points = rewardPointsForOrderSubtotal(order);
  if (points <= 0) return { status: "no_points" as const, points: 0 };

  return prisma.$transaction(async (tx) => {
    const account = await ensureRewardCustomerAccount(tx, order);
    if (!account) return { status: "missing_customer_email" as const, points: 0 };
    const result = await createRewardLedgerEntry({
      tx,
      customerAccountId: account.id,
      orderId: order.id,
      idempotencyKey: `rewards:earn:${order.id}`,
      points,
      type: "earn",
      reason: "Paid order eligible item subtotal",
      metadata: {
        orderNumber: order.orderNumber,
        eligibleSubtotalCents,
        shippingCentsExcluded: centsFromMoney(order.shippingCharged),
        taxCentsExcluded: centsFromMoney(order.tax),
        rule: "1 point per eligible item subtotal dollar"
      }
    });
    return { status: result.created ? ("awarded" as const) : ("already_awarded" as const), points: result.points };
  });
}

export async function reverseRewardsForOrder(
  order: RewardOrder,
  input: { reason: "refund" | "cancel" | "test_order"; idempotencyKey: string; refundedAmount?: number | null }
) {
  const existingLedger = await prisma.rewardLedgerEntry.findMany({
    where: { orderId: order.id },
    select: { customerAccountId: true, points: true, type: true }
  });
  const earnedPoints = existingLedger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
  if (earnedPoints <= 0) return { status: "no_award" as const, points: 0 };
  if (!rewardFeatureEnabled() && existingLedger.length === 0) return { status: "disabled" as const, points: 0 };

  const alreadyReversed = Math.abs(existingLedger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
  const eligibleSubtotalCents = rewardEligibleSubtotalCents(order);
  const shouldReverseAll =
    input.reason === "test_order" ||
    order.status === "canceled" ||
    order.paymentStatus === "refunded" ||
    order.status === "refunded";
  const cumulativeRefundedCents = Math.min(centsFromMoney(input.refundedAmount ?? order.refundedAmount), eligibleSubtotalCents);
  const targetReversal = shouldReverseAll
    ? earnedPoints
    : eligibleSubtotalCents > 0
      ? Math.min(earnedPoints, Math.floor((earnedPoints * cumulativeRefundedCents) / eligibleSubtotalCents))
      : earnedPoints;
  const pointsToReverse = Math.max(0, targetReversal - alreadyReversed);
  if (pointsToReverse <= 0) return { status: "already_reversed" as const, points: 0 };

  return prisma.$transaction(async (tx) => {
    const currentLedger = await tx.rewardLedgerEntry.findMany({
      where: { orderId: order.id },
      select: { customerAccountId: true, points: true, type: true }
    });
    const currentEarned = currentLedger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
    const currentReversed = Math.abs(currentLedger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
    const currentPointsToReverse = Math.max(0, Math.min(currentEarned, targetReversal) - currentReversed);
    const customerAccountId = currentLedger.find((entry) => entry.customerAccountId)?.customerAccountId;
    if (!customerAccountId || currentPointsToReverse <= 0) return { status: "already_reversed" as const, points: 0 };

    const result = await createRewardLedgerEntry({
      tx,
      customerAccountId,
      orderId: order.id,
      idempotencyKey: `rewards:reverse:${order.id}:${input.idempotencyKey}`,
      points: -currentPointsToReverse,
      type: "reverse",
      reason:
        input.reason === "test_order"
          ? "Test/smoke order excluded from rewards"
          : input.reason === "cancel"
            ? "Canceled order reward reversal"
            : "Refund reward reversal",
      metadata: {
        orderNumber: order.orderNumber,
        reason: input.reason,
        eligibleSubtotalCents,
        cumulativeRefundedCents,
        targetReversalPoints: targetReversal,
        previousReversedPoints: currentReversed
      }
    });
    return { status: result.created ? ("reversed" as const) : ("already_reversed" as const), points: Math.abs(result.points) };
  });
}

export function rewardSummaryForOrder(order: Pick<RewardOrder, "isTestOrder" | "rewardLedgerEntries">): StorefrontOrderRewardSummary {
  const ledger = order.rewardLedgerEntries ?? [];
  const pointsEarned = ledger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
  const pointsReversed = Math.abs(ledger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
  const netPoints = pointsEarned - pointsReversed;
  const status = order.isTestOrder
    ? "Test/smoke order: no rewards"
    : pointsEarned > 0
      ? pointsReversed > 0
        ? "Rewards adjusted"
        : "Rewards earned"
      : "No rewards recorded";
  return {
    pointsEarned,
    pointsReversed,
    netPoints,
    ledgerCount: ledger.length,
    status,
    redemptionEnabled: false
  };
}

export async function listCustomerRewardActivity(account: CurrentCustomerAccount, take = 12): Promise<CustomerRewardActivityItem[]> {
  if (!rewardFeatureEnabled() || !account.emailVerifiedAt) return [];
  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: { customerAccountId: account.id },
    select: {
      id: true,
      points: true,
      type: true,
      reason: true,
      createdAt: true,
      order: {
        select: {
          orderNumber: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take
  });
  return ledger.map((entry) => ({
    id: entry.id,
    points: entry.points,
    type: entry.type,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
    orderNumber: entry.order?.orderNumber ?? null
  }));
}
