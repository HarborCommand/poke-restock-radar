import { createHash, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentRequestId, logServerEvent, safeEntityRef } from "@/lib/observability";
import { calculateExpectedRewardBalance } from "@/lib/reward-reconciliation";

export type RewardAuditDecision = "approved" | "blocked" | "review_required";
export type RewardAuditSeverity = "info" | "warning" | "critical";

export type RewardAuditReasonCode =
  | "APPROVED"
  | "FEATURE_DISABLED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_NOT_PAID"
  | "SOURCE_CANCELED"
  | "SOURCE_REFUNDED"
  | "TEST_OR_SMOKE_SOURCE"
  | "INVALID_CUSTOMER"
  | "CUSTOMER_INACTIVE"
  | "CUSTOMER_OWNERSHIP_MISMATCH"
  | "CUSTOMER_LINK_REQUIRED"
  | "INVALID_POINTS"
  | "NEGATIVE_AVAILABLE_BALANCE"
  | "REVERSAL_EXCEEDS_ORIGINAL_EARN"
  | "DUPLICATE_REWARD"
  | "CONFLICTING_REWARD_SOURCE"
  | "MISSING_IDEMPOTENCY_KEY"
  | "MISSING_LEGACY_OWNERSHIP_EVIDENCE"
  | "INCOMPLETE_LEGACY_METADATA"
  | "AUDIT_FAILED";

export type RewardAuditSourceType =
  | "online_order"
  | "pos_sale"
  | "admin_backfill"
  | "admin_adjustment"
  | "fulfillment_release"
  | "refund_reversal"
  | "redemption";

type RewardAuditClient = Prisma.TransactionClient | typeof prisma;

export class RewardAuditBlockedError extends Error {
  readonly audit: RewardAuditResult;

  constructor(audit: RewardAuditResult) {
    super(`Reward audit blocked: ${audit.reasonCode}`);
    this.name = "RewardAuditBlockedError";
    this.audit = audit;
  }
}

export type RewardAuditResult = {
  decision: RewardAuditDecision;
  reasonCode: RewardAuditReasonCode;
  sourceType: RewardAuditSourceType;
  sourceReferenceHash: string | null;
  points: number;
  durationMs: number;
  duplicate: boolean;
  reviewFindingId?: string | null;
};

export type RewardAuditInput = {
  operation: string;
  sourceType: RewardAuditSourceType;
  sourceReference?: string | null;
  customerAccountId?: string | null;
  orderId?: string | null;
  ownerUserId?: string | null;
  idempotencyKey?: string | null;
  points: number;
  featureEnabled: boolean;
  requireLinkedCustomer?: boolean;
  allowNegativePoints?: boolean;
  checkAvailableBalance?: boolean;
  reversalOfEntryId?: string | null;
  legacyOwnershipEvidence?: "verified" | "missing" | "incomplete";
  metadataComplete?: boolean;
};

function auditHashSecret() {
  return process.env.OBSERVABILITY_HASH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "local-reward-audit-reference";
}

function safeSourceReference(value: string | null | undefined) {
  if (!value) return null;
  return createHmac("sha256", auditHashSecret()).update(value).digest("hex").slice(0, 16);
}

function findingFingerprint(input: {
  code: RewardAuditReasonCode;
  sourceType: RewardAuditSourceType;
  sourceReferenceHash: string | null;
  customerAccountId?: string | null;
}) {
  return createHash("sha256")
    .update([
      input.code,
      input.sourceType,
      input.sourceReferenceHash ?? "none",
      input.customerAccountId ? safeEntityRef(input.customerAccountId) : "none"
    ].join(":"))
    .digest("hex");
}

function safeMetadata(input: RewardAuditInput, reasonCode: RewardAuditReasonCode) {
  return JSON.stringify({
    operation: input.operation,
    reasonCode,
    sourceType: input.sourceType,
    points: input.points,
    hasOrderId: Boolean(input.orderId),
    hasCustomerAccountId: Boolean(input.customerAccountId),
    hasIdempotencyKey: Boolean(input.idempotencyKey),
    ownerScoped: Boolean(input.ownerUserId)
  });
}

async function upsertFinding(
  client: RewardAuditClient,
  input: RewardAuditInput,
  reasonCode: RewardAuditReasonCode,
  severity: RewardAuditSeverity,
  sourceReferenceHash: string | null
) {
  const fingerprint = findingFingerprint({
    code: reasonCode,
    sourceType: input.sourceType,
    sourceReferenceHash,
    customerAccountId: input.customerAccountId
  });
  const finding = await client.rewardAuditFinding.upsert({
    where: { findingFingerprint: fingerprint },
    create: {
      findingFingerprint: fingerprint,
      findingCode: reasonCode,
      severity,
      customerAccountId: input.customerAccountId ?? null,
      sourceType: input.sourceType,
      sourceReferenceHash,
      rewardLedgerEntryId: input.reversalOfEntryId ?? null,
      metadataJson: safeMetadata(input, reasonCode)
    },
    update: {
      occurrenceCount: { increment: 1 },
      status: "open",
      severity,
      metadataJson: safeMetadata(input, reasonCode)
    }
  });
  return finding.id;
}

function logAuditResult(input: RewardAuditInput, result: RewardAuditResult) {
  const event =
    result.decision === "approved"
      ? "reward_audit_approved"
      : result.decision === "review_required"
        ? "reward_audit_review_required"
        : "reward_audit_blocked";
  logServerEvent({
    requestId: currentRequestId(),
    route: "reward-auditor",
    operation: event,
    status: result.decision === "approved" ? 200 : result.decision === "review_required" ? 202 : 409,
    durationMs: result.durationMs,
    entityType: "CUSTOMER_ACCOUNT",
    entityRef: input.customerAccountId ? safeEntityRef(input.customerAccountId) : null,
    metadata: {
      reasonCode: result.reasonCode,
      sourceType: result.sourceType,
      sourceReferenceHash: result.sourceReferenceHash,
      points: result.points,
      duplicate: result.duplicate,
      performanceWarning: result.durationMs > 100
    }
  });
}

function buildResult(
  input: RewardAuditInput,
  decision: RewardAuditDecision,
  reasonCode: RewardAuditReasonCode,
  startedAt: number,
  sourceReferenceHash: string | null,
  duplicate = false,
  reviewFindingId: string | null = null
): RewardAuditResult {
  const result: RewardAuditResult = {
    decision,
    reasonCode,
    sourceType: input.sourceType,
    sourceReferenceHash,
    points: input.points,
    durationMs: Date.now() - startedAt,
    duplicate,
    reviewFindingId
  };
  logAuditResult(input, result);
  return result;
}

export async function auditRewardMutation(client: RewardAuditClient, input: RewardAuditInput): Promise<RewardAuditResult> {
  const startedAt = Date.now();
  const sourceReferenceHash = safeSourceReference(input.sourceReference ?? input.orderId ?? input.idempotencyKey);
  try {
    if (!input.featureEnabled) return buildResult(input, "blocked", "FEATURE_DISABLED", startedAt, sourceReferenceHash);
    if (!input.idempotencyKey?.trim()) return buildResult(input, "blocked", "MISSING_IDEMPOTENCY_KEY", startedAt, sourceReferenceHash);
    if (!Number.isSafeInteger(input.points) || (!input.allowNegativePoints && input.points < 0)) {
      return buildResult(input, "blocked", "INVALID_POINTS", startedAt, sourceReferenceHash);
    }
    if (input.requireLinkedCustomer && !input.customerAccountId) {
      return buildResult(input, "blocked", "CUSTOMER_LINK_REQUIRED", startedAt, sourceReferenceHash);
    }
    if (!input.customerAccountId) return buildResult(input, "blocked", "INVALID_CUSTOMER", startedAt, sourceReferenceHash);

    const customer = await client.customerAccount.findUnique({
      where: { id: input.customerAccountId },
      select: { id: true, status: true }
    });
    if (!customer) return buildResult(input, "blocked", "INVALID_CUSTOMER", startedAt, sourceReferenceHash);
    if (customer.status !== "active") return buildResult(input, "blocked", "CUSTOMER_INACTIVE", startedAt, sourceReferenceHash);

    const existing = await client.rewardLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, points: true, customerAccountId: true }
    });
    if (existing) return buildResult(input, "blocked", "DUPLICATE_REWARD", startedAt, sourceReferenceHash, true);
    if (input.reversalOfEntryId && input.allowNegativePoints) {
      const original = await client.rewardLedgerEntry.findUnique({
        where: { id: input.reversalOfEntryId },
        select: { points: true }
      });
      if (!original || original.points <= 0 || Math.abs(input.points) > original.points) {
        return buildResult(input, "blocked", "REVERSAL_EXCEEDS_ORIGINAL_EARN", startedAt, sourceReferenceHash);
      }
    }
    if (input.checkAvailableBalance && input.points < 0) {
      const balance = await client.rewardBalance.findUnique({
        where: { customerAccountId: input.customerAccountId },
        select: { availablePoints: true }
      });
      if (!balance || balance.availablePoints < Math.abs(input.points)) {
        return buildResult(input, "blocked", "NEGATIVE_AVAILABLE_BALANCE", startedAt, sourceReferenceHash);
      }
    }

    if (input.orderId) {
      const order = await client.storefrontOrder.findUnique({
        where: { id: input.orderId },
        select: {
          userId: true,
          customerAccountId: true,
          paymentStatus: true,
          status: true,
          refundedAmount: true,
          isTestOrder: true
        }
      });
      if (!order) return buildResult(input, "blocked", "SOURCE_NOT_FOUND", startedAt, sourceReferenceHash);
      if (input.ownerUserId && order.userId !== input.ownerUserId) {
        return buildResult(input, "blocked", "CUSTOMER_OWNERSHIP_MISMATCH", startedAt, sourceReferenceHash);
      }
      if (order.customerAccountId && order.customerAccountId !== input.customerAccountId) {
        return buildResult(input, "blocked", "CUSTOMER_OWNERSHIP_MISMATCH", startedAt, sourceReferenceHash);
      }
      if (order.isTestOrder && input.sourceType !== "refund_reversal") {
        return buildResult(input, "blocked", "TEST_OR_SMOKE_SOURCE", startedAt, sourceReferenceHash);
      }
      if (order.paymentStatus !== "paid" && input.sourceType !== "refund_reversal") {
        return buildResult(input, "blocked", "SOURCE_NOT_PAID", startedAt, sourceReferenceHash);
      }
      if (order.status === "canceled" && input.sourceType !== "refund_reversal") {
        return buildResult(input, "blocked", "SOURCE_CANCELED", startedAt, sourceReferenceHash);
      }
      if ((order.status === "refunded" || order.refundedAmount > 0) && input.sourceType !== "refund_reversal") {
        return buildResult(input, "blocked", "SOURCE_REFUNDED", startedAt, sourceReferenceHash);
      }
    }

    if (input.legacyOwnershipEvidence === "missing") {
      const findingId = await upsertFinding(client, input, "MISSING_LEGACY_OWNERSHIP_EVIDENCE", "warning", sourceReferenceHash);
      return buildResult(input, "review_required", "MISSING_LEGACY_OWNERSHIP_EVIDENCE", startedAt, sourceReferenceHash, false, findingId);
    }
    if (input.metadataComplete === false || input.legacyOwnershipEvidence === "incomplete") {
      const findingId = await upsertFinding(client, input, "INCOMPLETE_LEGACY_METADATA", "warning", sourceReferenceHash);
      return buildResult(input, "review_required", "INCOMPLETE_LEGACY_METADATA", startedAt, sourceReferenceHash, false, findingId);
    }

    return buildResult(input, "approved", "APPROVED", startedAt, sourceReferenceHash);
  } catch (error) {
    logServerEvent({
      requestId: currentRequestId(),
      route: "reward-auditor",
      operation: "reward_audit_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      entityType: "CUSTOMER_ACCOUNT",
      entityRef: input.customerAccountId ? safeEntityRef(input.customerAccountId) : null,
      error,
      metadata: {
        sourceType: input.sourceType,
        sourceReferenceHash
      }
    });
    return buildResult(input, "blocked", "AUDIT_FAILED", startedAt, sourceReferenceHash);
  }
}

export function assertRewardAuditApproved(result: RewardAuditResult) {
  if (result.decision !== "approved") throw new RewardAuditBlockedError(result);
}

export type RewardReconciliationOptions = {
  since?: Date;
  pageSize?: number;
  maxPages?: number;
};

type FindingInput = {
  code: RewardAuditReasonCode | "BALANCE_MISMATCH" | "ORPHAN_LEDGER_REFERENCE" | "DUPLICATE_EFFECTIVE_EARN";
  severity: RewardAuditSeverity;
  customerAccountId?: string | null;
  sourceType?: string | null;
  sourceReference?: string | null;
  rewardLedgerEntryId?: string | null;
  metadata?: Record<string, unknown>;
};

async function recordFinding(client: RewardAuditClient, input: FindingInput) {
  const sourceReferenceHash = safeSourceReference(input.sourceReference);
  const fingerprint = createHash("sha256")
    .update([
      input.code,
      input.customerAccountId ? safeEntityRef(input.customerAccountId) : "none",
      input.sourceType ?? "none",
      sourceReferenceHash ?? "none",
      input.rewardLedgerEntryId ? safeEntityRef(input.rewardLedgerEntryId) : "none"
    ].join(":"))
    .digest("hex");
  const finding = await client.rewardAuditFinding.upsert({
    where: { findingFingerprint: fingerprint },
    create: {
      findingFingerprint: fingerprint,
      findingCode: input.code,
      severity: input.severity,
      customerAccountId: input.customerAccountId ?? null,
      sourceType: input.sourceType ?? null,
      sourceReferenceHash,
      rewardLedgerEntryId: input.rewardLedgerEntryId ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {})
    },
    update: {
      occurrenceCount: { increment: 1 },
      status: "open",
      severity: input.severity,
      metadataJson: JSON.stringify(input.metadata ?? {})
    }
  });
  logServerEvent({
    requestId: currentRequestId(),
    route: "reward-reconciliation",
    operation: "reward_reconciliation_finding",
    status: 202,
    entityType: "CUSTOMER_ACCOUNT",
    entityRef: input.customerAccountId ? safeEntityRef(input.customerAccountId) : null,
    metadata: {
      findingCode: input.code,
      severity: input.severity,
      sourceType: input.sourceType,
      sourceReferenceHash
    }
  });
  return finding.id;
}

function normalizedStatus(entry: { points: number; type: string; status: string | null }) {
  if (entry.status) return entry.status;
  if (entry.points < 0 || entry.type === "reverse") return "reversed";
  if (entry.points > 0) return "available";
  return "canceled";
}

function parseMetadata(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function runRewardReconciliation(options: RewardReconciliationOptions = {}, client: RewardAuditClient = prisma) {
  const startedAt = Date.now();
  const since = options.since ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const pageSize = Math.max(1, Math.min(250, Math.floor(options.pageSize ?? 100)));
  const maxPages = Math.max(1, Math.min(20, Math.floor(options.maxPages ?? 5)));
  let checked = 0;
  let findings = 0;
  const customerIds = new Set<string>();
  const sourceEarns = new Map<string, number>();

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const ledger = await client.rewardLedgerEntry.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
        select: {
          id: true,
          customerAccountId: true,
          orderId: true,
          points: true,
          type: true,
          status: true,
          source: true,
          idempotencyKey: true,
          eligibleSubtotalCents: true,
          reversalOfEntryId: true,
          metadataJson: true,
          order: { select: { id: true, status: true, paymentStatus: true, refundedAmount: true, isTestOrder: true, userId: true } }
        }
      });
      if (!ledger.length) break;
      checked += ledger.length;
      for (const entry of ledger) {
        customerIds.add(entry.customerAccountId);
        const status = normalizedStatus(entry);
        const metadata = parseMetadata(entry.metadataJson);
        const saleReference = typeof metadata.saleReference === "string" ? metadata.saleReference : null;
        const effectiveSource = entry.orderId ? `order:${entry.orderId}` : saleReference ? `pos:${saleReference}` : null;
        if (entry.points > 0 && entry.type === "earn" && effectiveSource) {
          const nextCount = (sourceEarns.get(effectiveSource) ?? 0) + 1;
          sourceEarns.set(effectiveSource, nextCount);
          if (nextCount > 1) {
            findings += 1;
            await recordFinding(client, {
              code: "DUPLICATE_EFFECTIVE_EARN",
              severity: "critical",
              customerAccountId: entry.customerAccountId,
              sourceType: entry.source,
              sourceReference: effectiveSource,
              rewardLedgerEntryId: entry.id
            });
          }
        }
        if (entry.orderId && !entry.order) {
          findings += 1;
          await recordFinding(client, {
            code: "ORPHAN_LEDGER_REFERENCE",
            severity: "critical",
            customerAccountId: entry.customerAccountId,
            sourceType: entry.source,
            sourceReference: entry.orderId,
            rewardLedgerEntryId: entry.id
          });
        }
        if (entry.order?.isTestOrder || entry.order?.status === "canceled" || entry.order?.status === "refunded") {
          findings += 1;
          await recordFinding(client, {
            code: entry.order.isTestOrder ? "TEST_OR_SMOKE_SOURCE" : entry.order.status === "canceled" ? "SOURCE_CANCELED" : "SOURCE_REFUNDED",
            severity: "critical",
            customerAccountId: entry.customerAccountId,
            sourceType: entry.source,
            sourceReference: entry.orderId,
            rewardLedgerEntryId: entry.id
          });
        }
        if (entry.points > 0 && entry.eligibleSubtotalCents != null && entry.points > Math.floor(entry.eligibleSubtotalCents / 100)) {
          findings += 1;
          await recordFinding(client, {
            code: "INVALID_POINTS",
            severity: "critical",
            customerAccountId: entry.customerAccountId,
            sourceType: entry.source,
            sourceReference: effectiveSource,
            rewardLedgerEntryId: entry.id,
            metadata: { status }
          });
        }
      }
      if (ledger.length < pageSize) break;
    }

    for (const customerAccountId of customerIds) {
      const [balance, ledger] = await Promise.all([
        client.rewardBalance.findUnique({
          where: { customerAccountId },
          select: { availablePoints: true, pendingPoints: true, lifetimeEarnedPoints: true }
        }),
        client.rewardLedgerEntry.findMany({
          where: { customerAccountId },
          select: {
            id: true,
            points: true,
            type: true,
            status: true,
            source: true,
            reversalOfEntryId: true,
            metadataJson: true
          }
        })
      ]);
      const { expected } = calculateExpectedRewardBalance(ledger);
      const { availablePoints: available, pendingPoints: pending, lifetimeEarnedPoints: lifetime } = expected;
      if (!balance || balance.availablePoints !== available || balance.pendingPoints !== pending || balance.lifetimeEarnedPoints !== lifetime) {
        findings += 1;
        await recordFinding(client, {
          code: "BALANCE_MISMATCH",
          severity: "critical",
          customerAccountId,
          sourceType: "reward_balance",
          metadata: {
            hasBalance: Boolean(balance),
            availableDelta: (balance?.availablePoints ?? 0) - available,
            pendingDelta: (balance?.pendingPoints ?? 0) - pending,
            lifetimeDelta: (balance?.lifetimeEarnedPoints ?? 0) - lifetime
          }
        });
      }
    }

    logServerEvent({
      requestId: currentRequestId(),
      route: "reward-reconciliation",
      operation: findings > 0 ? "reward_reconciliation_finding" : "reward_reconciliation_clean",
      status: 200,
      durationMs: Date.now() - startedAt,
      metadata: { checked, findings, pageSize, maxPages }
    });
    return { status: findings > 0 ? "findings" as const : "clean" as const, checked, findings };
  } catch (error) {
    logServerEvent({
      requestId: currentRequestId(),
      route: "reward-reconciliation",
      operation: "reward_reconciliation_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      error,
      metadata: { checked, findings }
    });
    throw error;
  }
}
