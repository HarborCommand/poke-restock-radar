import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { normalizeCustomerAccountEmail } from "@/lib/customer-account-auth";
import { configuredRewardPendingDays } from "@/lib/customer-rewards";
import { calculateExpectedRewardBalance } from "@/lib/reward-reconciliation";
import { workspaceCustomerWhereWithLegacy } from "@/lib/customer-workspace";
import type {
  CustomerRewardIntegrityClassification,
  CustomerRewardIntegrityReportDTO,
  CustomerRewardIntegritySectionDTO
} from "@/types/radar";

const boundedAccountLimit = 1_000;
const boundedLedgerEntryLimit = 10_000;
const boundedOrderLimit = 5_000;
const boundedPosSaleLimit = 5_000;
const canonicalPosPlatforms = ["pos", "POS"] as const;

const paidOrderWhere = {
  paymentStatus: "paid",
  isTestOrder: false
} as const;

type Section<T extends Record<string, unknown>> = CustomerRewardIntegritySectionDTO<T>;

function classify(reasons: string[], warningReasons: string[] = []): CustomerRewardIntegrityClassification {
  if (reasons.length) return "BLOCKED";
  if (warningReasons.length) return "WARNING";
  return "PASS";
}

function section<T extends Record<string, unknown>>(
  metrics: T,
  blockedReasons: string[],
  warningReasons: string[] = [],
  unavailable: boolean | string[] = false
): Section<T> {
  const unavailableReasons = Array.isArray(unavailable) ? unavailable : unavailable ? ["REPORT_LIMIT_REACHED"] : [];
  if (unavailableReasons.length) {
    return {
      classification: "UNAVAILABLE",
      reasons: [...unavailableReasons, ...blockedReasons, ...warningReasons],
      metrics
    };
  }
  return {
    classification: classify(blockedReasons, warningReasons),
    reasons: [...blockedReasons, ...warningReasons],
    metrics
  };
}

function statusOf(entry: { points: number; type: string; status: string | null }) {
  if (entry.status === "pending" || entry.status === "available" || entry.status === "reversed" || entry.status === "canceled") {
    return entry.status;
  }
  if (entry.points < 0 || entry.type === "reverse") return "reversed";
  if (entry.points > 0) return "available";
  return "canceled";
}

function countWhere<T>(values: T[], predicate: (value: T) => boolean) {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0);
}

function safeSum(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function absolute(value: number) {
  return Math.abs(Number.isFinite(value) ? value : 0);
}

function hasCanceledOrRefundedOrderState(order: { status: string; paymentStatus: string; refundStatus: string | null; refundedAmount: number }) {
  return (
    order.status === "canceled" ||
    order.status === "cancelled" ||
    order.status === "refunded" ||
    order.paymentStatus === "refunded" ||
    order.refundStatus === "refunded" ||
    order.refundedAmount > 0
  );
}

function deploymentTarget(env: Record<string, string | undefined> = process.env): CustomerRewardIntegrityReportDTO["deploymentTarget"] {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.VERCEL_ENV === "development") return "development";
  if (!env.VERCEL_ENV && env.NODE_ENV !== "production") return "local";
  return "unknown";
}

function reportEnvironment(env: Record<string, string | undefined> = process.env): CustomerRewardIntegrityReportDTO["environment"] {
  return env.VERCEL_ENV === "production" ? "production" : "non_production";
}

function accountEmailMismatch(record: {
  customerAccountId: string | null;
  customerEmail?: string | null;
  email?: string | null;
  customerAccount: { normalizedEmail: string | null; email: string } | null;
}) {
  if (!record.customerAccountId || !record.customerAccount) return false;
  const sourceEmail = normalizeCustomerAccountEmail(record.customerEmail ?? record.email);
  const accountEmail = normalizeCustomerAccountEmail(record.customerAccount.normalizedEmail ?? record.customerAccount.email);
  return Boolean(sourceEmail && accountEmail && sourceEmail !== accountEmail);
}

type PosSaleRow = {
  customerAccountId: string | null;
  customerEmail: string | null;
  platform: string;
  saleReference: string | null;
  rewardsEligible: boolean;
  refundStatus: string | null;
  refundedAmount: number;
  customerAccount: {
    status: string;
    normalizedEmail: string | null;
    email: string;
    emailVerifiedAt: Date | null;
  } | null;
};

function saleReferenceKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function aggregatePosTransactions(rows: PosSaleRow[]) {
  const missingReferenceRows = rows.filter((sale) => !saleReferenceKey(sale.saleReference));
  const grouped = new Map<string, PosSaleRow[]>();
  for (const sale of rows) {
    const reference = saleReferenceKey(sale.saleReference);
    if (!reference) continue;
    const list = grouped.get(reference) ?? [];
    list.push(sale);
    grouped.set(reference, list);
  }

  const transactions = [...grouped.entries()].map(([reference, lines]) => {
    const linkedCustomerAccountIds = new Set(lines.map((line) => line.customerAccountId).filter(Boolean) as string[]);
    const hasLinkedRows = linkedCustomerAccountIds.size > 0;
    const hasUnlinkedRows = lines.some((line) => !line.customerAccountId);
    const refundStates = new Set(lines.map((line) => line.refundStatus ?? "none"));
    const hasRefundedLine = lines.some((line) => line.refundStatus === "refunded");
    const hasActiveLine = lines.some((line) => line.refundStatus !== "refunded");
    const customerAccount = lines.find((line) => line.customerAccount)?.customerAccount ?? null;
    const customerAccountId = linkedCustomerAccountIds.size === 1 ? [...linkedCustomerAccountIds][0] : null;
    return {
      saleReference: reference,
      lineCount: lines.length,
      customerAccountId,
      linked: hasLinkedRows,
      unlinked: !hasLinkedRows,
      linkedToInactiveAccount: hasLinkedRows && customerAccount?.status !== "active",
      linkedToUnverifiedAccount: hasLinkedRows && !customerAccount?.emailVerifiedAt,
      emailMismatch: lines.some(accountEmailMismatch),
      rewardsEligible: lines.some((line) => line.rewardsEligible),
      refunded: hasRefundedLine && !hasActiveLine,
      partiallyRefunded: lines.some((line) => line.refundedAmount > 0) && !hasRefundedLine,
      aggregateRefundedAmount: safeSum(lines.map((line) => Number(line.refundedAmount) || 0)),
      conflictingCustomerLinks: linkedCustomerAccountIds.size > 1,
      contradictoryIdentityRows: hasLinkedRows && hasUnlinkedRows,
      incompatibleRefundState: refundStates.size > 1 && hasRefundedLine && hasActiveLine
    };
  });

  return {
    transactions,
    missingReferenceLineCount: missingReferenceRows.length,
    missingReferenceAffectedRecords: missingReferenceRows.length,
    conflictingCustomerLinkTransactions: transactions.filter((transaction) => transaction.conflictingCustomerLinks).length,
    contradictoryIdentityTransactions: transactions.filter((transaction) => transaction.contradictoryIdentityRows).length,
    incompatibleRefundStateTransactions: transactions.filter((transaction) => transaction.incompatibleRefundState).length
  };
}

export async function buildCustomerRewardIntegrityReport(ownerUserId: string): Promise<CustomerRewardIntegrityReportDTO> {
  const generatedAt = new Date();
  const customerScope = await workspaceCustomerWhereWithLegacy(prisma, ownerUserId);
  const config = customerAccountFeatureConfig();
  const configuredPendingDays = configuredRewardPendingDays();
  const runtimeMetrics = {
    customerAccountsEnabled: config.customerAccountsEnabled,
    customerRewardsEnabled: config.customerRewardsEnabled,
    customerPosRewardsEnabled: config.customerPosRewardsEnabled,
    customerRewardRedemptionEnabled: config.customerRewardRedemptionEnabled,
    customerRewardAdminAdjustmentsEnabled: config.customerRewardAdminAdjustmentsEnabled,
    customerAccountsExpectedEnabled: true,
    rewardEarningExpectedEnabled: false,
    posRewardEarningExpectedEnabled: false,
    redemptionExpectedEnabled: false,
    adminAdjustmentsExpectedEnabled: false,
    deploymentTarget: deploymentTarget(),
    accountProvider: config.accountProvider,
    rewardProvider: config.rewardsProvider,
    configuredPendingDays,
    storefrontRewardsBeginPending: true,
    posRewardsBeginAvailable: true,
    scheduledElapsedPendingReleaseExists: false,
    fulfillmentReleaseExists: true,
    refundReversalExists: true
  };
  const runtimeBlocked = [
    !config.customerAccountsEnabled ? "CUSTOMER_ACCOUNTS_DISABLED_WHILE_ACCOUNT_ACCESS_EXPECTED" : null,
    config.customerRewardsEnabled ? "CUSTOMER_REWARDS_ENABLED_BEFORE_CERTIFICATION" : null,
    config.customerPosRewardsEnabled ? "CUSTOMER_POS_REWARDS_ENABLED_BEFORE_CERTIFICATION" : null,
    config.customerRewardRedemptionEnabled ? "CUSTOMER_REWARD_REDEMPTION_ENABLED_WITHOUT_APPROVAL" : null,
    config.customerRewardAdminAdjustmentsEnabled ? "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED_WITHOUT_APPROVAL" : null
  ].filter(Boolean) as string[];

  const [customerTotal, customers, duplicateGroups, balanceCount, negativeBalanceCount] = await Promise.all([
    prisma.customerAccount.count({ where: customerScope }),
    prisma.customerAccount.findMany({
      where: customerScope,
      select: {
        id: true,
        status: true,
        normalizedEmail: true,
        emailVerifiedAt: true,
        rewardBalance: {
          select: {
            availablePoints: true,
            pendingPoints: true,
            lifetimeEarnedPoints: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: boundedAccountLimit + 1
    }),
    prisma.customerAccount.groupBy({
      by: ["normalizedEmail"],
      where: {
        AND: [
          customerScope,
          {
            normalizedEmail: {
              not: null
            }
          },
          {
            normalizedEmail: {
              not: ""
            }
          }
        ]
      },
      _count: { _all: true }
    }),
    prisma.rewardBalance.count({ where: { customerAccount: customerScope } }),
    prisma.rewardBalance.count({
      where: {
        customerAccount: customerScope,
        OR: [{ availablePoints: { lt: 0 } }, { pendingPoints: { lt: 0 } }, { lifetimeEarnedPoints: { lt: 0 } }]
      }
    })
  ]);
  const customerLimitReached = customers.length > boundedAccountLimit;
  const boundedCustomers = customers.slice(0, boundedAccountLimit);
  const duplicateCounts = duplicateGroups.map((group) => group._count._all).filter((count) => count > 1);
  const customerMetrics = {
    totalCustomerAccounts: customerTotal,
    activeAccounts: countWhere(boundedCustomers, (customer) => customer.status === "active"),
    inactiveDisabledAccounts: countWhere(boundedCustomers, (customer) => customer.status !== "active"),
    verifiedAccounts: countWhere(boundedCustomers, (customer) => Boolean(customer.emailVerifiedAt)),
    unverifiedAccounts: countWhere(boundedCustomers, (customer) => !customer.emailVerifiedAt),
    accountsWithNormalizedEmail: countWhere(boundedCustomers, (customer) => Boolean(customer.normalizedEmail?.trim())),
    accountsMissingNormalizedEmail: countWhere(boundedCustomers, (customer) => !customer.normalizedEmail?.trim()),
    duplicateNormalizedEmailGroups: duplicateCounts.length,
    duplicateNormalizedEmailRecords: safeSum(duplicateCounts),
    maximumDuplicateRecordsInOneGroup: Math.max(0, ...duplicateCounts),
    accountsWithRewardBalance: balanceCount,
    accountsWithoutRewardBalance: Math.max(0, customerTotal - balanceCount),
    accountsWithNegativeRewardFields: negativeBalanceCount,
    accountsWithInconsistentStatusVerification: countWhere(
      boundedCustomers,
      (customer) => customer.status !== "active" && Boolean(customer.emailVerifiedAt)
    ),
    boundedAccountLimit,
    boundedSamplePartial: customerLimitReached
  };

  const customerSection = section(
    customerMetrics,
    [
      customerMetrics.duplicateNormalizedEmailGroups > 0 ? "DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY" : null,
      customerMetrics.accountsWithNegativeRewardFields > 0 ? "NEGATIVE_REWARD_BALANCE_FIELD" : null
    ].filter(Boolean) as string[],
    [
      customerMetrics.unverifiedAccounts > 0 ? "UNVERIFIED_CUSTOMER_ACCOUNTS_PRESENT" : null,
      customerMetrics.accountsWithoutRewardBalance > 0 ? "CUSTOMER_ACCOUNTS_WITHOUT_REWARD_BALANCE" : null,
      customerMetrics.accountsMissingNormalizedEmail > 0 ? "CUSTOMER_ACCOUNTS_MISSING_NORMALIZED_EMAIL" : null
    ].filter(Boolean) as string[],
    customerLimitReached
  );

  const [storefrontCustomers, paidOrders, posSales] = await Promise.all([
    prisma.storefrontCustomer.findMany({
      where: { userId: ownerUserId },
      select: {
        customerAccountId: true,
        email: true,
        customerAccount: {
          select: {
            status: true,
            normalizedEmail: true,
            email: true,
            emailVerifiedAt: true
          }
        }
      },
      take: boundedOrderLimit + 1
    }),
    prisma.storefrontOrder.findMany({
      where: { userId: ownerUserId, ...paidOrderWhere },
      select: {
        customerAccountId: true,
        customerEmail: true,
        customerName: true,
        customerAccount: {
          select: {
            status: true,
            normalizedEmail: true,
            email: true,
            emailVerifiedAt: true
          }
        }
      },
      take: boundedOrderLimit + 1
    }),
    prisma.inventorySale.findMany({
      where: { userId: ownerUserId, platform: { in: [...canonicalPosPlatforms] } },
      select: {
        customerAccountId: true,
        customerEmail: true,
        platform: true,
        saleReference: true,
        rewardsEligible: true,
        refundStatus: true,
        refundedAmount: true,
        customerAccount: {
          select: {
            status: true,
            normalizedEmail: true,
            email: true,
            emailVerifiedAt: true
          }
        }
      },
      take: boundedPosSaleLimit + 1
    })
  ]);
  const storefrontCustomersLimitReached = storefrontCustomers.length > boundedOrderLimit;
  const paidOrdersLimitReached = paidOrders.length > boundedOrderLimit;
  const posSalesLimitReached = posSales.length > boundedPosSaleLimit;
  const boundedStorefrontCustomers = storefrontCustomers.slice(0, boundedOrderLimit);
  const boundedPaidOrders = paidOrders.slice(0, boundedOrderLimit);
  const boundedPosSales = posSales.slice(0, boundedPosSaleLimit);
  const posTransactionSummary = aggregatePosTransactions(boundedPosSales);
  const posTransactions = posTransactionSummary.transactions;
  const linkingMetrics = {
    boundedOrderLimit,
    boundedPosSaleLimit,
    boundedSamplePartial: storefrontCustomersLimitReached || paidOrdersLimitReached || posSalesLimitReached,
    storefrontCustomerTotal: boundedStorefrontCustomers.length,
    storefrontCustomerLinkedToCustomerAccount: countWhere(boundedStorefrontCustomers, (customer) => Boolean(customer.customerAccountId)),
    storefrontCustomerUnlinked: countWhere(boundedStorefrontCustomers, (customer) => !customer.customerAccountId),
    storefrontCustomerLinkedToMissingCustomerAccount: countWhere(
      boundedStorefrontCustomers,
      (customer) => Boolean(customer.customerAccountId) && !customer.customerAccount
    ),
    paidStorefrontOrderTotal: boundedPaidOrders.length,
    paidOrdersLinkedToCustomerAccount: countWhere(boundedPaidOrders, (order) => Boolean(order.customerAccountId)),
    paidOrdersUnlinked: countWhere(boundedPaidOrders, (order) => !order.customerAccountId),
    paidGuestOrders: countWhere(boundedPaidOrders, (order) => !order.customerAccountId && Boolean(order.customerEmail || order.customerName)),
    paidOrdersLinkedToInactiveAccount: countWhere(
      boundedPaidOrders,
      (order) => Boolean(order.customerAccountId) && order.customerAccount?.status !== "active"
    ),
    paidOrdersLinkedToUnverifiedAccount: countWhere(
      boundedPaidOrders,
      (order) => Boolean(order.customerAccountId) && !order.customerAccount?.emailVerifiedAt
    ),
    paidOrdersWithEmailMismatch: countWhere(boundedPaidOrders, accountEmailMismatch),
    posSaleLineRecordsEvaluated: boundedPosSales.length,
    posSalesTotal: posTransactions.length,
    posSalesLinkedToCustomerAccount: countWhere(posTransactions, (sale) => sale.linked),
    posSalesUnlinked: countWhere(posTransactions, (sale) => sale.unlinked),
    posSalesLinkedToInactiveAccount: countWhere(posTransactions, (sale) => sale.linkedToInactiveAccount),
    posSalesLinkedToUnverifiedAccount: countWhere(posTransactions, (sale) => sale.linkedToUnverifiedAccount),
    posSalesWithEmailMismatch: countWhere(posTransactions, (sale) => sale.emailMismatch),
    posSaleLineRecordsMissingSaleReference: posTransactionSummary.missingReferenceLineCount,
    posSaleMissingReferenceAffectedRecords: posTransactionSummary.missingReferenceAffectedRecords,
    posSaleTransactionsWithConflictingCustomerLinks: posTransactionSummary.conflictingCustomerLinkTransactions,
    posSaleTransactionsWithContradictoryIdentityRows: posTransactionSummary.contradictoryIdentityTransactions,
    posSaleTransactionsWithIncompatibleRefundState: posTransactionSummary.incompatibleRefundStateTransactions,
    posPlatformFilter: "pos" as const
  };
  const linkingSection = section(
    linkingMetrics,
    [
      linkingMetrics.storefrontCustomerLinkedToMissingCustomerAccount > 0 ? "STOREFRONT_CUSTOMER_MISSING_LINKED_ACCOUNT" : null,
      linkingMetrics.paidOrdersLinkedToInactiveAccount > 0 ? "PAID_ORDER_LINKED_TO_INACTIVE_ACCOUNT" : null,
      linkingMetrics.paidOrdersWithEmailMismatch > 0 ? "PAID_ORDER_ACCOUNT_EMAIL_MISMATCH" : null,
      linkingMetrics.posSalesLinkedToInactiveAccount > 0 ? "POS_SALE_LINKED_TO_INACTIVE_ACCOUNT" : null,
      linkingMetrics.posSalesWithEmailMismatch > 0 ? "POS_SALE_ACCOUNT_EMAIL_MISMATCH" : null,
      linkingMetrics.posSaleTransactionsWithConflictingCustomerLinks > 0 ? "POS_TRANSACTION_CONFLICTING_CUSTOMER_LINKS" : null,
      linkingMetrics.posSaleTransactionsWithContradictoryIdentityRows > 0 ? "POS_TRANSACTION_CONTRADICTORY_CUSTOMER_IDENTITY" : null,
      linkingMetrics.posSaleTransactionsWithIncompatibleRefundState > 0 ? "POS_TRANSACTION_INCOMPATIBLE_REFUND_STATE" : null
    ].filter(Boolean) as string[],
    [
      linkingMetrics.paidOrdersUnlinked > 0 ? "UNLINKED_HISTORICAL_PAID_ORDERS" : null,
      linkingMetrics.posSalesUnlinked > 0 ? "UNLINKED_HISTORICAL_POS_SALES" : null,
      linkingMetrics.paidOrdersLinkedToUnverifiedAccount > 0 ? "PAID_ORDER_LINKED_TO_UNVERIFIED_ACCOUNT" : null,
      linkingMetrics.posSalesLinkedToUnverifiedAccount > 0 ? "POS_SALE_LINKED_TO_UNVERIFIED_ACCOUNT" : null,
      linkingMetrics.posSaleLineRecordsMissingSaleReference > 0 ? "POS_SALE_REFERENCE_MISSING_FOR_TRANSACTION_GROUPING" : null
    ].filter(Boolean) as string[],
    storefrontCustomersLimitReached || paidOrdersLimitReached || posSalesLimitReached
  );

  const ledgerWhere = {
    customerAccount: customerScope,
    OR: [{ orderId: null }, { order: { userId: ownerUserId } }]
  };
  const [ledgerCount, ledgerEntries, duplicateIdempotencyGroups] = await Promise.all([
    prisma.rewardLedgerEntry.count({ where: ledgerWhere }),
    prisma.rewardLedgerEntry.findMany({
      where: ledgerWhere,
      select: {
        id: true,
        customerAccountId: true,
        orderId: true,
        points: true,
        type: true,
        status: true,
        source: true,
        idempotencyKey: true,
        reversalOfEntryId: true,
        metadataJson: true,
        availableAt: true,
        customerAccount: { select: { id: true } },
        order: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            fulfillmentStatus: true,
            refundedAmount: true,
            refundStatus: true
          }
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: boundedLedgerEntryLimit + 1
    }),
    prisma.rewardLedgerEntry.groupBy({
      by: ["idempotencyKey"],
      where: {
        ...ledgerWhere,
        idempotencyKey: { not: null }
      },
      _count: { _all: true }
    })
  ]);
  const ledgerLimitReached = ledgerEntries.length > boundedLedgerEntryLimit;
  const boundedLedger = ledgerEntries.slice(0, boundedLedgerEntryLimit);
  const ledgerIdSet = new Set(boundedLedger.map((entry) => entry.id));
  const duplicateLedgerKeyCounts = duplicateIdempotencyGroups.map((group) => group._count._all).filter((count) => count > 1);
  const invalidLedgerStatusType = (entry: { points: number; type: string; status: string | null }) => {
    const status = statusOf(entry);
    if (entry.points > 0 && entry.type === "reverse") return true;
    if (entry.points < 0 && entry.type === "earn") return true;
    if (entry.points > 0 && (status === "reversed" || status === "canceled")) return true;
    if (entry.points < 0 && (status === "pending" || status === "available")) return true;
    return false;
  };
  const reversalEntriesWithMissingOriginalEntry = ledgerLimitReached
    ? null
    : countWhere(boundedLedger, (entry) => Boolean(entry.reversalOfEntryId) && !ledgerIdSet.has(entry.reversalOfEntryId!));
  const ledgerMetrics = {
    allRewardLedgerEntries: ledgerCount,
    boundedEntryLimit: boundedLedgerEntryLimit,
    boundedSamplePartial: ledgerLimitReached,
    positiveEarnEntries: countWhere(boundedLedger, (entry) => entry.points > 0 && entry.type === "earn"),
    negativeReversalEntries: countWhere(boundedLedger, (entry) => entry.points < 0 || entry.type === "reverse"),
    pendingEntries: countWhere(boundedLedger, (entry) => statusOf(entry) === "pending"),
    availableEntries: countWhere(boundedLedger, (entry) => statusOf(entry) === "available"),
    reversedEntries: countWhere(boundedLedger, (entry) => statusOf(entry) === "reversed"),
    canceledEntries: countWhere(boundedLedger, (entry) => statusOf(entry) === "canceled"),
    onlineOrderSourceEntries: countWhere(boundedLedger, (entry) => entry.source === "stripe_checkout" || Boolean(entry.orderId)),
    posSourceEntries: countWhere(boundedLedger, (entry) => entry.source === "pos"),
    administrativeAdjustmentEntries: countWhere(boundedLedger, (entry) => entry.source === "admin_adjustment" || entry.source === "admin_backfill"),
    entriesWithMissingCustomerAccount: null,
    entriesWithMissingCustomerAccountSchemaEnforced: true,
    entriesWithMissingCustomerAccountConstraint: "Reward ledger entries require a customer account relation that cascades on account deletion.",
    orderLinkedEntriesWithMissingStorefrontOrder: null,
    orderLinkedEntriesWithMissingStorefrontOrderSchemaEnforced: true,
    orderLinkedEntriesWithMissingStorefrontOrderConstraint:
      "Order-linked reward entries use a storefront order relation that is nulled if the order is removed.",
    reversalEntriesMissingReversalOfEntryId: countWhere(
      boundedLedger,
      (entry) => (entry.points < 0 || entry.type === "reverse") && !entry.reversalOfEntryId
    ),
    reversalEntriesWithMissingOriginalEntry,
    reversalOriginalEntryCheckAvailable: !ledgerLimitReached,
    duplicateIdempotencyKeyGroups: duplicateLedgerKeyCounts.length,
    duplicateIdempotencyKeyRecords: safeSum(duplicateLedgerKeyCounts),
    ledgerEntriesWithZeroPoints: countWhere(boundedLedger, (entry) => entry.points === 0),
    ledgerEntriesWithInvalidStatusTypeCombinations: countWhere(boundedLedger, invalidLedgerStatusType),
    totalPositivePoints: safeSum(boundedLedger.filter((entry) => entry.points > 0).map((entry) => entry.points)),
    totalNegativePoints: safeSum(boundedLedger.filter((entry) => entry.points < 0).map((entry) => entry.points))
  };
  const ledgerSection = section(
    ledgerMetrics,
    [
      ledgerMetrics.reversalEntriesWithMissingOriginalEntry !== null && ledgerMetrics.reversalEntriesWithMissingOriginalEntry > 0
        ? "REWARD_REVERSAL_MISSING_ORIGINAL_ENTRY"
        : null,
      ledgerMetrics.duplicateIdempotencyKeyGroups > 0 ? "DUPLICATE_REWARD_IDEMPOTENCY_KEY" : null,
      ledgerMetrics.ledgerEntriesWithInvalidStatusTypeCombinations > 0 ? "INVALID_REWARD_LEDGER_STATUS_TYPE" : null
    ].filter(Boolean) as string[],
    [
      ledgerMetrics.ledgerEntriesWithZeroPoints > 0 ? "ZERO_POINT_LEDGER_ENTRIES" : null,
      ledgerMetrics.reversalEntriesMissingReversalOfEntryId > 0 ? "LEGACY_REVERSAL_WITHOUT_ORIGINAL_REFERENCE" : null
    ].filter(Boolean) as string[],
    ledgerLimitReached
  );

  const ledgerByCustomer = new Map<string, typeof boundedLedger>();
  for (const entry of boundedLedger) {
    const list = ledgerByCustomer.get(entry.customerAccountId) ?? [];
    list.push(entry);
    ledgerByCustomer.set(entry.customerAccountId, list);
  }
  let fullyReconciledAccounts = 0;
  let accountsWithAvailableMismatch = 0;
  let accountsWithPendingMismatch = 0;
  let accountsWithLifetimeEarnedMismatch = 0;
  let totalAbsoluteAvailablePointVariance = 0;
  let totalAbsolutePendingPointVariance = 0;
  let totalAbsoluteLifetimeEarnedVariance = 0;
  for (const customer of boundedCustomers) {
    const entries = ledgerByCustomer.get(customer.id) ?? [];
    const expected = calculateExpectedRewardBalance(entries).expected;
    const stored = customer.rewardBalance ?? { availablePoints: 0, pendingPoints: 0, lifetimeEarnedPoints: 0 };
    const availableDelta = stored.availablePoints - expected.availablePoints;
    const pendingDelta = stored.pendingPoints - expected.pendingPoints;
    const lifetimeDelta = stored.lifetimeEarnedPoints - expected.lifetimeEarnedPoints;
    if (availableDelta === 0 && pendingDelta === 0 && lifetimeDelta === 0) fullyReconciledAccounts += 1;
    if (availableDelta !== 0) accountsWithAvailableMismatch += 1;
    if (pendingDelta !== 0) accountsWithPendingMismatch += 1;
    if (lifetimeDelta !== 0) accountsWithLifetimeEarnedMismatch += 1;
    totalAbsoluteAvailablePointVariance += absolute(availableDelta);
    totalAbsolutePendingPointVariance += absolute(pendingDelta);
    totalAbsoluteLifetimeEarnedVariance += absolute(lifetimeDelta);
  }
  const balanceMetrics = {
    totalAccountsEvaluated: boundedCustomers.length,
    fullyReconciledAccounts,
    accountsWithAvailableMismatch,
    accountsWithPendingMismatch,
    accountsWithLifetimeEarnedMismatch,
    totalAbsoluteAvailablePointVariance,
    totalAbsolutePendingPointVariance,
    totalAbsoluteLifetimeEarnedVariance,
    negativeAvailableBalances: countWhere(boundedCustomers, (customer) => (customer.rewardBalance?.availablePoints ?? 0) < 0),
    negativePendingBalances: countWhere(boundedCustomers, (customer) => (customer.rewardBalance?.pendingPoints ?? 0) < 0),
    negativeLifetimeEarnedBalances: countWhere(boundedCustomers, (customer) => (customer.rewardBalance?.lifetimeEarnedPoints ?? 0) < 0),
    balancesWithoutAccounts: null,
    balancesWithoutAccountsSchemaEnforced: true,
    balancesWithoutAccountsConstraint: "Reward balances require a customer account relation and cascade on account deletion.",
    accountsWithMultipleBalanceRecords: null,
    accountsWithMultipleBalanceRecordsSchemaEnforced: true,
    accountsWithMultipleBalanceRecordsConstraint: "Reward balances are keyed one-to-one by customer account.",
    boundedEntryLimit: boundedLedgerEntryLimit,
    boundedSamplePartial: customerLimitReached || ledgerLimitReached,
    truncatedAccounts: ledgerLimitReached ? boundedCustomers.length : 0,
    formula:
      "Expected lifetime is the sum of positive ledger points; pending is positive pending points minus reversal metadata pendingPointsReversed; available is positive available points plus legacy/admin/POS negative reversals or minus reversal metadata availablePointsReversed. Negative expected balances are clamped to zero, matching the existing read-only reward audit helper."
  };
  const balanceSection = section(
    balanceMetrics,
    [
      balanceMetrics.accountsWithAvailableMismatch > 0 ? "AVAILABLE_REWARD_BALANCE_MISMATCH" : null,
      balanceMetrics.accountsWithPendingMismatch > 0 ? "PENDING_REWARD_BALANCE_MISMATCH" : null,
      balanceMetrics.accountsWithLifetimeEarnedMismatch > 0 ? "LIFETIME_REWARD_BALANCE_MISMATCH" : null,
      balanceMetrics.negativeAvailableBalances > 0 ? "NEGATIVE_AVAILABLE_BALANCE" : null,
      balanceMetrics.negativePendingBalances > 0 ? "NEGATIVE_PENDING_BALANCE" : null,
      balanceMetrics.negativeLifetimeEarnedBalances > 0 ? "NEGATIVE_LIFETIME_BALANCE" : null
    ].filter(Boolean) as string[],
    [],
    customerLimitReached || ledgerLimitReached
  );

  const orderEarnCounts = new Map<string, number>();
  const orderReversalCounts = new Map<string, number>();
  const orderPendingEntries = boundedLedger.filter((entry) => Boolean(entry.orderId) && statusOf(entry) === "pending" && entry.points > 0);
  for (const entry of boundedLedger) {
    if (!entry.orderId) continue;
    if (entry.points > 0 && entry.type === "earn") orderEarnCounts.set(entry.orderId, (orderEarnCounts.get(entry.orderId) ?? 0) + 1);
    if (entry.points < 0 || entry.type === "reverse") orderReversalCounts.set(entry.orderId, (orderReversalCounts.get(entry.orderId) ?? 0) + 1);
  }
  const onlineMetrics = {
    paidEligibleOrdersWithEarnEntry: countWhere(
      boundedLedger,
      (entry) => Boolean(entry.orderId) && entry.points > 0 && entry.type === "earn" && entry.order?.paymentStatus === "paid" && entry.order?.status !== "canceled"
    ),
    paidEligibleOrdersWithoutEarnEntry: countWhere(boundedPaidOrders, (order) => Boolean(order.customerAccountId)) -
      new Set(
        boundedLedger
          .filter((entry) => Boolean(entry.orderId) && entry.points > 0 && entry.type === "earn" && entry.order?.paymentStatus === "paid")
          .map((entry) => entry.orderId)
      ).size,
    unpaidOrdersWithEarnEntry: countWhere(
      boundedLedger,
      (entry) => Boolean(entry.orderId) && entry.points > 0 && entry.type === "earn" && entry.order?.paymentStatus !== "paid"
    ),
    canceledOrdersWithUnreversedRewardPoints: countWhere(
      boundedLedger,
      (entry) => Boolean(entry.orderId) && entry.points > 0 && entry.order?.status === "canceled" && !orderReversalCounts.has(entry.orderId!)
    ),
    fullyRefundedOrdersWithUnreversedRewardPoints: countWhere(
      boundedLedger,
      (entry) =>
        Boolean(entry.orderId) &&
        entry.points > 0 &&
        (entry.order?.paymentStatus === "refunded" || entry.order?.refundStatus === "refunded") &&
        !orderReversalCounts.has(entry.orderId!)
    ),
    partiallyRefundedOrdersWithNoReversal: countWhere(
      boundedLedger,
      (entry) => Boolean(entry.orderId) && entry.points > 0 && (entry.order?.refundedAmount ?? 0) > 0 && !orderReversalCounts.has(entry.orderId!)
    ),
    ordersWithDuplicateEarnEntries: [...orderEarnCounts.values()].filter((count) => count > 1).length,
    pendingOrdersWhoseAvailableAtElapsed: countWhere(orderPendingEntries, (entry) => Boolean(entry.availableAt && entry.availableAt <= generatedAt)),
    elapsedPendingOrdersNotFulfilled: countWhere(
      orderPendingEntries,
      (entry) => Boolean(entry.availableAt && entry.availableAt <= generatedAt && entry.order?.fulfillmentStatus === "unfulfilled")
    ),
    elapsedPendingOrdersFulfilledButNotReleased: countWhere(
      orderPendingEntries,
      (entry) =>
        Boolean(entry.availableAt && entry.availableAt <= generatedAt) &&
        Boolean(entry.order && ["shipped", "picked_up", "fulfilled"].includes(entry.order.fulfillmentStatus))
    )
  };
  onlineMetrics.paidEligibleOrdersWithoutEarnEntry = Math.max(0, onlineMetrics.paidEligibleOrdersWithoutEarnEntry);
  const onlineSection = section(
    onlineMetrics,
    [
      onlineMetrics.unpaidOrdersWithEarnEntry > 0 ? "UNPAID_ORDER_WITH_REWARD_EARN" : null,
      onlineMetrics.canceledOrdersWithUnreversedRewardPoints > 0 ? "CANCELED_ORDER_WITH_UNREVERSED_REWARDS" : null,
      onlineMetrics.fullyRefundedOrdersWithUnreversedRewardPoints > 0 ? "REFUNDED_ORDER_WITH_UNREVERSED_REWARDS" : null,
      onlineMetrics.ordersWithDuplicateEarnEntries > 0 ? "DUPLICATE_ONLINE_ORDER_EARN_ENTRIES" : null
    ].filter(Boolean) as string[],
    [
      onlineMetrics.paidEligibleOrdersWithoutEarnEntry > 0 ? "PAID_LINKED_ORDER_WITHOUT_EARN_ENTRY" : null,
      onlineMetrics.partiallyRefundedOrdersWithNoReversal > 0 ? "PARTIAL_REFUND_WITHOUT_REWARD_REVERSAL" : null,
      onlineMetrics.pendingOrdersWhoseAvailableAtElapsed > 0 ? "ELAPSED_PENDING_ONLINE_REWARDS" : null
    ].filter(Boolean) as string[],
    paidOrdersLimitReached || ledgerLimitReached
  );

  const posEarnEntries = boundedLedger.filter((entry) => entry.source === "pos" && entry.points > 0);
  const posEarnByReference = new Map<string, typeof posEarnEntries>();
  for (const entry of posEarnEntries) {
    const saleReference = entry.idempotencyKey?.replace(/^rewards:pos:earn:/, "") || null;
    if (!saleReference || saleReference === entry.idempotencyKey) continue;
    const list = posEarnByReference.get(saleReference) ?? [];
    list.push(entry);
    posEarnByReference.set(saleReference, list);
  }
  const posSaleReferences = new Map(posTransactions.filter((sale) => sale.linked).map((sale) => [sale.saleReference, sale] as const));
  const completedEligibleSalesWithoutEarnEntry = ledgerLimitReached
    ? null
    : countWhere(posTransactions, (sale) => sale.linked && sale.rewardsEligible && !posEarnByReference.has(sale.saleReference));
  const posEarnEntriesWithoutIdentifiableSale = posSalesLimitReached
    ? null
    : countWhere(posEarnEntries, (entry) => {
        const saleReference = entry.idempotencyKey?.replace(/^rewards:pos:earn:/, "") || null;
        return !saleReference || saleReference === entry.idempotencyKey || !posSaleReferences.has(saleReference);
      });
  const posMetrics = {
    posSaleLineRecordsEvaluated: boundedPosSales.length,
    posSaleTransactionsEvaluated: posTransactions.length,
    posSaleLineRecordsMissingSaleReference: posTransactionSummary.missingReferenceLineCount,
    posSaleMissingReferenceAffectedRecords: posTransactionSummary.missingReferenceAffectedRecords,
    posSaleTransactionsWithConflictingCustomerLinks: posTransactionSummary.conflictingCustomerLinkTransactions,
    posSaleTransactionsWithContradictoryIdentityRows: posTransactionSummary.contradictoryIdentityTransactions,
    posSaleTransactionsWithIncompatibleRefundState: posTransactionSummary.incompatibleRefundStateTransactions,
    boundedPosSaleLimit,
    boundedEntryLimit: boundedLedgerEntryLimit,
    boundedSamplePartial: posSalesLimitReached || ledgerLimitReached,
    completedEligibleSalesWithEarnEntry: [...posEarnByReference.keys()].filter((reference) => posSaleReferences.get(reference)?.rewardsEligible).length,
    completedEligibleSalesWithoutEarnEntry,
    refundedSalesWithUnreversedPoints: countWhere(
      posTransactions,
      (sale) =>
        Boolean(
          sale.linked &&
            sale.refunded &&
            posEarnByReference.has(sale.saleReference) &&
            !boundedLedger.some((entry) => entry.idempotencyKey?.startsWith(`rewards:pos:refund:${sale.saleReference}`))
        )
    ),
    partiallyRefundedSalesWithNoReversal: countWhere(
      posTransactions,
      (sale) =>
        Boolean(
          sale.linked &&
            sale.aggregateRefundedAmount > 0 &&
            !sale.refunded &&
            posEarnByReference.has(sale.saleReference) &&
            !boundedLedger.some((entry) => entry.idempotencyKey?.startsWith(`rewards:pos:refund:${sale.saleReference}`))
        )
    ),
    duplicatePosEarnEntries: [...posEarnByReference.values()].filter((entries) => entries.length > 1).length,
    posEarnEntriesWithoutIdentifiableSale,
    linkedSalesWhoseEarnEntryBelongsToDifferentAccount: [...posEarnByReference.entries()].filter(([reference, entries]) => {
      const sale = posSaleReferences.get(reference);
      return Boolean(sale?.customerAccountId && entries.some((entry) => entry.customerAccountId !== sale.customerAccountId));
    }).length
  };
  const posSection = section(
    posMetrics,
    [
      posMetrics.refundedSalesWithUnreversedPoints > 0 ? "REFUNDED_POS_SALE_WITH_UNREVERSED_REWARDS" : null,
      posMetrics.duplicatePosEarnEntries > 0 ? "DUPLICATE_POS_EARN_ENTRIES" : null,
      posMetrics.posEarnEntriesWithoutIdentifiableSale !== null && posMetrics.posEarnEntriesWithoutIdentifiableSale > 0
        ? "POS_EARN_ENTRY_WITHOUT_IDENTIFIABLE_SALE"
        : null,
      posMetrics.linkedSalesWhoseEarnEntryBelongsToDifferentAccount > 0 ? "POS_REWARD_ACCOUNT_MISMATCH" : null,
      posMetrics.posSaleTransactionsWithConflictingCustomerLinks > 0 ? "POS_TRANSACTION_CONFLICTING_CUSTOMER_LINKS" : null,
      posMetrics.posSaleTransactionsWithContradictoryIdentityRows > 0 ? "POS_TRANSACTION_CONTRADICTORY_CUSTOMER_IDENTITY" : null,
      posMetrics.posSaleTransactionsWithIncompatibleRefundState > 0 ? "POS_TRANSACTION_INCOMPATIBLE_REFUND_STATE" : null
    ].filter(Boolean) as string[],
    [
      posMetrics.completedEligibleSalesWithoutEarnEntry !== null && posMetrics.completedEligibleSalesWithoutEarnEntry > 0
        ? "LINKED_POS_SALE_WITHOUT_EARN_ENTRY"
        : null,
      posMetrics.partiallyRefundedSalesWithNoReversal > 0 ? "PARTIAL_POS_REFUND_WITHOUT_REWARD_REVERSAL" : null,
      posMetrics.posSaleLineRecordsMissingSaleReference > 0 ? "POS_SALE_REFERENCE_MISSING_FOR_TRANSACTION_GROUPING" : null
    ].filter(Boolean) as string[],
    [
      ...(posSalesLimitReached || ledgerLimitReached ? ["REPORT_LIMIT_REACHED"] : []),
      ...(posMetrics.posSaleLineRecordsMissingSaleReference > 0 ? ["POS_TRANSACTION_GROUPING_UNAVAILABLE_FOR_MISSING_REFERENCE"] : [])
    ]
  );

  const pendingEntries = boundedLedger.filter((entry) => statusOf(entry) === "pending" && entry.points > 0);
  const pendingMetrics = {
    configuredPendingDays,
    totalPendingEntries: pendingEntries.length,
    pendingEntriesWithFutureAvailableAt: countWhere(pendingEntries, (entry) => Boolean(entry.availableAt && entry.availableAt > generatedAt)),
    pendingEntriesWithElapsedAvailableAt: countWhere(pendingEntries, (entry) => Boolean(entry.availableAt && entry.availableAt <= generatedAt)),
    pendingEntriesWithNullAvailableAt: countWhere(pendingEntries, (entry) => !entry.availableAt),
    pendingEntriesForShippedOrders: countWhere(pendingEntries, (entry) => entry.order?.fulfillmentStatus === "shipped"),
    pendingEntriesForPickedUpOrders: countWhere(pendingEntries, (entry) => entry.order?.fulfillmentStatus === "picked_up"),
    pendingEntriesForFulfilledOrders: countWhere(pendingEntries, (entry) => entry.order?.fulfillmentStatus === "fulfilled"),
    pendingEntriesForCanceledRefundedOrders: countWhere(
      pendingEntries,
      (entry) => Boolean(entry.order && hasCanceledOrRefundedOrderState(entry.order))
    ),
    activeScheduledDelayElapsedReleaseExists: false,
    releaseCurrentlyFulfillmentTriggeredOnly: true
  };
  const pendingSection = section(
    pendingMetrics,
    [pendingMetrics.pendingEntriesForCanceledRefundedOrders > 0 ? "PENDING_REWARD_FOR_CANCELED_OR_REFUNDED_ORDER" : null].filter(Boolean) as string[],
    [
      pendingMetrics.pendingEntriesWithElapsedAvailableAt > 0 && !pendingMetrics.activeScheduledDelayElapsedReleaseExists
        ? "ELAPSED_PENDING_REWARDS_WITHOUT_AUTOMATIC_RELEASE_PATH"
        : null
    ].filter(Boolean) as string[],
    ledgerLimitReached
  );

  const sections = {
    runtimeConfiguration: section(runtimeMetrics, runtimeBlocked),
    customerAccountIntegrity: customerSection,
    customerLinking: linkingSection,
    rewardLedgerIntegrity: ledgerSection,
    rewardBalanceReconciliation: balanceSection,
    onlineOrderRewards: onlineSection,
    posRewards: posSection,
    pendingReleaseReadiness: pendingSection
  };
  const sectionValues = Object.values(sections);
  const summary = {
    sectionCount: sectionValues.length,
    blockedSections: sectionValues.filter((item) => item.classification === "BLOCKED").length,
    warningSections: sectionValues.filter((item) => item.classification === "WARNING").length,
    unavailableSections: sectionValues.filter((item) => item.classification === "UNAVAILABLE").length
  };
  const overallClassification: CustomerRewardIntegrityClassification = summary.blockedSections
    ? "BLOCKED"
    : summary.unavailableSections
      ? "UNAVAILABLE"
      : summary.warningSections
        ? "WARNING"
        : "PASS";

  return {
    generatedAt: generatedAt.toISOString(),
    environment: reportEnvironment(),
    deploymentTarget: deploymentTarget(),
    readOnly: true,
    overallClassification,
    summary,
    sections
  };
}
