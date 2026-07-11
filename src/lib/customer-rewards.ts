import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import {
  CustomerAccountIdentityConflictError,
  findOrCreateCustomerAccountByNormalizedEmail,
  normalizeCustomerAccountEmail,
  type CurrentCustomerAccount
} from "@/lib/customer-account-auth";

const rewardPointsPerDollar = 1;
const defaultRewardPendingDays = 0;
const rewardLedgerStatuses = new Set(["pending", "available", "reversed", "canceled"]);
const rewardSources = {
  stripeCheckout: "stripe_checkout",
  pos: "pos"
} as const;

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
    id?: string;
    points: number;
    type: string;
    status?: string | null;
  }>;
};

type RewardLedgerTx = Prisma.TransactionClient;
type RewardLedgerStatus = "pending" | "available" | "reversed" | "canceled";
type RewardReleaseReason = "shipped" | "picked_up" | "fulfilled" | "delay_elapsed";

export type PosRewardLedgerSummary = {
  pointsEarned: number;
  pointsReversed: number;
  netPoints: number;
  ledgerCount: number;
  status: "not_eligible" | "available" | "reversed";
};

export type CustomerRewardActivityItem = {
  id: string;
  points: number;
  type: string;
  status: string;
  sourceType: "online" | "pos" | "adjustment" | "other";
  createdAt: string;
  availableAt: string | null;
  settledAt: string | null;
  orderNumber: string | null;
};

function customerRewardActivitySource(entry: { source: string | null; order: { orderNumber: string } | null }) {
  if (entry.order) return "online" as const;
  const source = entry.source?.trim().toLowerCase() ?? "";
  if (source === "pos" || source === "admin_pos_link_backfill" || source === "admin_legacy_sale_backfill") return "pos" as const;
  if (source === "admin_adjustment") return "adjustment" as const;
  return "other" as const;
}

export type StorefrontOrderRewardSummary = {
  pointsEarned: number;
  pointsReversed: number;
  pointsPending: number;
  pointsAvailable: number;
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

function posRewardFeatureEnabled() {
  const config = customerAccountFeatureConfig();
  return config.customerAccountsEnabled && config.customerRewardsEnabled && config.customerPosRewardsEnabled;
}

export function customerRewardsEnabled() {
  return rewardFeatureEnabled();
}

export function customerPosRewardsEnabled() {
  return posRewardFeatureEnabled();
}

export function configuredRewardPendingDays(env: Record<string, string | undefined> = process.env) {
  const raw = env.CUSTOMER_REWARD_PENDING_DAYS?.trim();
  if (!raw) return defaultRewardPendingDays;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultRewardPendingDays;
  return Math.floor(parsed);
}

function rewardAvailableAt(now = new Date()) {
  return new Date(now.getTime() + configuredRewardPendingDays() * 24 * 60 * 60 * 1000);
}

function normalizedRewardLedgerStatus(entry: { points: number; type: string; status?: string | null }): RewardLedgerStatus {
  if (entry.status && rewardLedgerStatuses.has(entry.status)) return entry.status as RewardLedgerStatus;
  if (entry.points < 0 || entry.type === "reverse") return "reversed";
  if (entry.points > 0) return "available";
  return "canceled";
}

export function rewardEligibleSubtotalCents(order: Pick<RewardOrder, "subtotal" | "items">) {
  const itemSubtotalCents = order.items.reduce((sum, item) => sum + centsFromMoney(item.lineTotal), 0);
  if (itemSubtotalCents > 0) return itemSubtotalCents;
  return centsFromMoney(order.subtotal);
}

export function rewardPointsForOrderSubtotal(order: Pick<RewardOrder, "subtotal" | "items">) {
  return Math.floor((rewardEligibleSubtotalCents(order) / 100) * rewardPointsPerDollar);
}

export function rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents: number) {
  return Math.floor((Math.max(0, eligibleSubtotalCents) / 100) * rewardPointsPerDollar);
}

function orderCustomerEmail(order: RewardOrder) {
  return normalizeCustomerAccountEmail(order.customerEmail ?? order.customer?.email ?? null);
}

async function ensureRewardCustomerAccount(tx: RewardLedgerTx, order: RewardOrder) {
  const email = orderCustomerEmail(order);
  if (!email) return null;
  const account = await findOrCreateCustomerAccountByNormalizedEmail(email, tx);
  if (!account) return null;
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

async function applyRewardBalanceDelta(
  tx: RewardLedgerTx,
  customerAccountId: string,
  input: { availableDelta?: number; pendingDelta?: number; lifetimeEarnedDelta?: number }
) {
  const availableDelta = input.availableDelta ?? 0;
  const pendingDelta = input.pendingDelta ?? 0;
  const lifetimeEarnedDelta = input.lifetimeEarnedDelta ?? 0;
  if (availableDelta === 0 && pendingDelta === 0 && lifetimeEarnedDelta === 0) return;
  const updateData: Prisma.RewardBalanceUpdateInput = {};
  if (availableDelta !== 0) updateData.availablePoints = { increment: availableDelta };
  if (pendingDelta !== 0) updateData.pendingPoints = { increment: pendingDelta };
  if (lifetimeEarnedDelta !== 0) updateData.lifetimeEarnedPoints = { increment: lifetimeEarnedDelta };

  await tx.rewardBalance.upsert({
    where: { customerAccountId },
    create: {
      customerAccountId,
      availablePoints: availableDelta,
      lifetimeEarnedPoints: lifetimeEarnedDelta,
      pendingPoints: pendingDelta
    },
    update: updateData
  });
}

async function createRewardLedgerEntry(input: {
  tx: RewardLedgerTx;
  customerAccountId: string;
  orderId: string | null;
  idempotencyKey: string;
  points: number;
  type: "earn" | "reverse";
  reason: string;
  status: RewardLedgerStatus;
  source: string;
  availableAt?: Date | null;
  settledAt?: Date | null;
  eligibleSubtotalCents?: number | null;
  reversalOfEntryId?: string | null;
  balanceDelta: { availableDelta?: number; pendingDelta?: number; lifetimeEarnedDelta?: number };
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
      status: input.status,
      source: input.source,
      availableAt: input.availableAt,
      settledAt: input.settledAt,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
      reversalOfEntryId: input.reversalOfEntryId,
      metadataJson: JSON.stringify(input.metadata)
    }
  });
  await applyRewardBalanceDelta(input.tx, input.customerAccountId, input.balanceDelta);
  return { created: true, points: ledger.points };
}

export async function rewardSummaryForPosSaleReference(
  saleReference: string,
  client: RewardLedgerTx | typeof prisma = prisma
): Promise<PosRewardLedgerSummary> {
  const ledger = await client.rewardLedgerEntry.findMany({
    where: {
      source: rewardSources.pos,
      idempotencyKey: {
        in: [`rewards:pos:earn:${saleReference}`, `rewards:pos:refund:${saleReference}`]
      }
    },
    select: {
      points: true
    }
  });
  const pointsEarned = ledger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
  const pointsReversed = Math.abs(ledger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
  const netPoints = pointsEarned - pointsReversed;
  return {
    pointsEarned,
    pointsReversed,
    netPoints,
    ledgerCount: ledger.length,
    status: pointsEarned <= 0 ? "not_eligible" : netPoints <= 0 ? "reversed" : "available"
  };
}

export async function awardRewardsForCompletedPosSale(
  input: {
    customerAccountId: string | null;
    saleReference: string;
    eligibleSubtotalCents: number;
    taxCentsExcluded: number;
    itemCount: number;
  },
  tx?: RewardLedgerTx
) {
  if (!posRewardFeatureEnabled()) return { status: "disabled" as const, points: 0 };
  if (!input.customerAccountId) return { status: "missing_customer_account" as const, points: 0 };

  const eligibleSubtotalCents = Math.max(0, Math.round(input.eligibleSubtotalCents));
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (points <= 0) return { status: "no_points" as const, points: 0 };

  const run = async (client: RewardLedgerTx) => {
    const now = new Date();
    const result = await createRewardLedgerEntry({
      tx: client,
      customerAccountId: input.customerAccountId!,
      orderId: null,
      idempotencyKey: `rewards:pos:earn:${input.saleReference}`,
      points,
      type: "earn",
      reason: "Completed POS sale eligible item subtotal",
      status: "available",
      source: rewardSources.pos,
      availableAt: now,
      settledAt: now,
      eligibleSubtotalCents,
      balanceDelta: {
        availableDelta: points,
        lifetimeEarnedDelta: points
      },
      metadata: {
        saleReference: input.saleReference,
        eligibleSubtotalCents,
        taxCentsExcluded: input.taxCentsExcluded,
        itemCount: input.itemCount,
        releaseRule: "Manual POS rewards are available immediately after completed sale.",
        rule: "1 point per eligible adjusted POS subtotal dollar"
      }
    });
    return { status: result.created ? ("available" as const) : ("already_awarded" as const), points: result.points };
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

export async function reverseRewardsForPosSale(
  input: {
    saleReference: string;
    reason: "refund";
  },
  tx?: RewardLedgerTx
) {
  const run = async (client: RewardLedgerTx) => {
    const earnEntry = await client.rewardLedgerEntry.findUnique({
      where: { idempotencyKey: `rewards:pos:earn:${input.saleReference}` },
      select: {
        id: true,
        customerAccountId: true,
        points: true,
        eligibleSubtotalCents: true
      }
    });
    if (!earnEntry || earnEntry.points <= 0) return { status: "no_award" as const, points: 0 };

    const existingReversed = await client.rewardLedgerEntry.findMany({
      where: {
        source: rewardSources.pos,
        OR: [
          { idempotencyKey: `rewards:pos:refund:${input.saleReference}` },
          { reversalOfEntryId: earnEntry.id }
        ]
      },
      select: {
        points: true
      }
    });
    const reversedPoints = Math.abs(existingReversed.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
    const pointsToReverse = Math.max(0, earnEntry.points - reversedPoints);
    if (pointsToReverse <= 0) return { status: "already_reversed" as const, points: 0 };

    const now = new Date();
    const result = await createRewardLedgerEntry({
      tx: client,
      customerAccountId: earnEntry.customerAccountId,
      orderId: null,
      idempotencyKey: `rewards:pos:refund:${input.saleReference}`,
      points: -pointsToReverse,
      type: "reverse",
      reason: "Manual POS refund reward reversal",
      status: "reversed",
      source: rewardSources.pos,
      availableAt: null,
      settledAt: now,
      eligibleSubtotalCents: earnEntry.eligibleSubtotalCents,
      reversalOfEntryId: earnEntry.id,
      balanceDelta: {
        availableDelta: -pointsToReverse
      },
      metadata: {
        saleReference: input.saleReference,
        reason: input.reason,
        pointsPreviouslyEarned: earnEntry.points
      }
    });
    return { status: result.created ? ("reversed" as const) : ("already_reversed" as const), points: Math.abs(result.points) };
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

export async function awardRewardsForPaidOrder(order: RewardOrder) {
  if (!rewardFeatureEnabled()) return { status: "disabled" as const, points: 0 };
  if (order.isTestOrder) return { status: "test_order" as const, points: 0 };
  if (order.paymentStatus !== "paid") return { status: "not_paid" as const, points: 0 };

  const eligibleSubtotalCents = rewardEligibleSubtotalCents(order);
  const points = rewardPointsForOrderSubtotal(order);
  if (points <= 0) return { status: "no_points" as const, points: 0 };

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    let account: Awaited<ReturnType<typeof ensureRewardCustomerAccount>>;
    try {
      account = await ensureRewardCustomerAccount(tx, order);
    } catch (error) {
      if (error instanceof CustomerAccountIdentityConflictError) return { status: "customer_account_conflict" as const, points: 0 };
      throw error;
    }
    if (!account) return { status: "missing_customer_email" as const, points: 0 };
    const result = await createRewardLedgerEntry({
      tx,
      customerAccountId: account.id,
      orderId: order.id,
      idempotencyKey: `rewards:earn:${order.id}`,
      points,
      type: "earn",
      reason: "Paid order eligible item subtotal pending release",
      status: "pending",
      source: rewardSources.stripeCheckout,
      availableAt: rewardAvailableAt(now),
      settledAt: null,
      eligibleSubtotalCents,
      balanceDelta: {
        pendingDelta: points,
        lifetimeEarnedDelta: points
      },
      metadata: {
        orderNumber: order.orderNumber,
        eligibleSubtotalCents,
        shippingCentsExcluded: centsFromMoney(order.shippingCharged),
        taxCentsExcluded: centsFromMoney(order.tax),
        discountCentsExcluded: 0,
        releaseRule: "Pending until order is shipped, picked up, or cleared by the configured pending period.",
        rule: "1 point per eligible item subtotal dollar"
      }
    });
    return { status: result.created ? ("pending" as const) : ("already_awarded" as const), points: result.points };
  });
}

export async function releasePendingRewardsForOrder(orderId: string, reason: RewardReleaseReason, now = new Date()) {
  if (!rewardFeatureEnabled()) return { status: "disabled" as const, points: 0 };

  return prisma.$transaction(async (tx) => {
    const ledger = await tx.rewardLedgerEntry.findMany({
      where: { orderId },
      select: {
        id: true,
        customerAccountId: true,
        points: true,
        type: true,
        status: true,
        availableAt: true
      }
    });
    const pendingEntries = ledger.filter((entry) => {
      if (entry.points <= 0 || entry.type !== "earn" || normalizedRewardLedgerStatus(entry) !== "pending") return false;
      if (reason !== "delay_elapsed") return true;
      return !entry.availableAt || entry.availableAt.getTime() <= now.getTime();
    });
    if (!pendingEntries.length) return { status: "no_pending_rewards" as const, points: 0 };

    const pendingEarnPoints = pendingEntries.reduce((sum, entry) => sum + entry.points, 0);
    const reversedPoints = Math.abs(ledger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
    const customerAccountId = pendingEntries[0]?.customerAccountId;
    if (!customerAccountId) return { status: "no_pending_rewards" as const, points: 0 };

    let remainingReversedPoints = reversedPoints;
    let claimedReleasePoints = 0;
    let claimedEntries = 0;
    for (const entry of pendingEntries) {
      const entryReversedPoints = Math.min(entry.points, remainingReversedPoints);
      remainingReversedPoints -= entryReversedPoints;
      const entryReleasePoints = Math.max(0, entry.points - entryReversedPoints);
      const claimed = await tx.rewardLedgerEntry.updateMany({
        where: { id: entry.id, status: "pending" },
        data: {
          status: entryReleasePoints > 0 ? "available" : "canceled",
          settledAt: now
        }
      });
      if (claimed.count !== 1) continue;
      claimedEntries += 1;
      claimedReleasePoints += entryReleasePoints;
    }

    if (claimedEntries === 0) return { status: "no_pending_rewards" as const, points: 0 };
    if (claimedReleasePoints <= 0) return { status: "already_reversed" as const, points: 0 };
    await applyRewardBalanceDelta(tx, customerAccountId, {
      pendingDelta: -claimedReleasePoints,
      availableDelta: claimedReleasePoints
    });
    return { status: "released" as const, points: claimedReleasePoints };
  });
}

export async function reverseRewardsForOrder(
  order: RewardOrder,
  input: { reason: "refund" | "cancel" | "test_order"; idempotencyKey: string; refundedAmount?: number | null }
) {
  const existingLedger = await prisma.rewardLedgerEntry.findMany({
    where: { orderId: order.id },
    select: { id: true, customerAccountId: true, points: true, type: true, status: true }
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
    const now = new Date();
    const currentLedger = await tx.rewardLedgerEntry.findMany({
      where: { orderId: order.id },
      select: { id: true, customerAccountId: true, points: true, type: true, status: true }
    });
    const currentEarned = currentLedger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
    const currentReversed = Math.abs(currentLedger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
    const currentPointsToReverse = Math.max(0, Math.min(currentEarned, targetReversal) - currentReversed);
    const customerAccountId = currentLedger.find((entry) => entry.customerAccountId)?.customerAccountId;
    if (!customerAccountId || currentPointsToReverse <= 0) return { status: "already_reversed" as const, points: 0 };
    const pendingEarnPoints = currentLedger
      .filter((entry) => entry.points > 0 && normalizedRewardLedgerStatus(entry) === "pending")
      .reduce((sum, entry) => sum + entry.points, 0);
    const pendingRemaining = Math.max(0, pendingEarnPoints - currentReversed);
    const pendingToReverse = Math.min(currentPointsToReverse, pendingRemaining);
    const availableToReverse = currentPointsToReverse - pendingToReverse;
    const earningEntry = currentLedger.find((entry) => entry.points > 0 && entry.type === "earn") ?? null;

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
      status: "reversed",
      source: rewardSources.stripeCheckout,
      settledAt: now,
      availableAt: null,
      eligibleSubtotalCents,
      reversalOfEntryId: earningEntry?.id ?? null,
      balanceDelta: {
        pendingDelta: pendingToReverse > 0 ? -pendingToReverse : 0,
        availableDelta: availableToReverse > 0 ? -availableToReverse : 0
      },
      metadata: {
        orderNumber: order.orderNumber,
        reason: input.reason,
        eligibleSubtotalCents,
        cumulativeRefundedCents,
        targetReversalPoints: targetReversal,
        previousReversedPoints: currentReversed,
        pendingPointsReversed: pendingToReverse,
        availablePointsReversed: availableToReverse,
        partialRefundLimitation: "Partial reward reversal is prorated against eligible product subtotal unless future refund metadata captures exact product-subtotal refund amount."
      }
    });
    if (targetReversal >= currentEarned) {
      await tx.rewardLedgerEntry.updateMany({
        where: { orderId: order.id, type: "earn", points: { gt: 0 } },
        data: {
          status: "canceled",
          settledAt: now
        }
      });
    }
    return { status: result.created ? ("reversed" as const) : ("already_reversed" as const), points: Math.abs(result.points) };
  });
}

export function rewardSummaryForOrder(order: Pick<RewardOrder, "isTestOrder" | "rewardLedgerEntries">): StorefrontOrderRewardSummary {
  const ledger = order.rewardLedgerEntries ?? [];
  const pointsEarned = ledger.filter((entry) => entry.points > 0).reduce((sum, entry) => sum + entry.points, 0);
  const pointsReversed = Math.abs(ledger.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
  const pendingGross = ledger
    .filter((entry) => entry.points > 0 && normalizedRewardLedgerStatus(entry) === "pending")
    .reduce((sum, entry) => sum + entry.points, 0);
  const pointsPending = Math.max(0, pendingGross - pointsReversed);
  const pointsAvailable = Math.max(0, pointsEarned - pointsReversed - pointsPending);
  const netPoints = pointsEarned - pointsReversed;
  const status = order.isTestOrder
    ? "Test/smoke order: no rewards"
    : pointsEarned > 0
      ? pointsReversed > 0
        ? "Rewards adjusted"
        : pointsPending > 0
          ? "Rewards pending"
          : "Rewards available"
      : "No rewards recorded";
  return {
    pointsEarned,
    pointsReversed,
    pointsPending,
    pointsAvailable,
    netPoints,
    ledgerCount: ledger.length,
    status,
    redemptionEnabled: false
  };
}

export async function listCustomerRewardActivity(account: CurrentCustomerAccount, take = 12): Promise<CustomerRewardActivityItem[]> {
  if (!rewardFeatureEnabled() || !account.emailVerifiedAt) return [];
  const boundedTake = Math.max(1, Math.min(50, Number.isFinite(take) ? Math.floor(take) : 12));
  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: { customerAccountId: account.id },
    select: {
      id: true,
      points: true,
      type: true,
      status: true,
      source: true,
      availableAt: true,
      settledAt: true,
      createdAt: true,
      order: {
        select: {
          orderNumber: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: boundedTake
  });
  return ledger.map((entry) => ({
    id: entry.id,
    points: entry.points,
    type: entry.type,
    status: normalizedRewardLedgerStatus(entry),
    sourceType: customerRewardActivitySource(entry),
    createdAt: entry.createdAt.toISOString(),
    availableAt: entry.availableAt?.toISOString() ?? null,
    settledAt: entry.settledAt?.toISOString() ?? null,
    orderNumber: entry.order?.orderNumber ?? null
  }));
}
