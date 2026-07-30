import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeCustomerAccountEmail } from "@/lib/customer-account-auth";
import { privateNoStoreHeaders } from "@/lib/http";
import { canonicalPosPlatformWhere } from "@/lib/pos-platform";
import { workspaceCustomerWhere } from "@/lib/customer-workspace";
import type { SessionUser } from "@/types/radar";

export const customerAccountHygieneRepairOperation = "NORMALIZE_SINGLE_ZERO_HISTORY_ACCOUNT_AND_CREATE_ZERO_BALANCE";
export const customerAccountHygieneRepairConfirmation = "EXECUTE_DETERMINISTIC_CUSTOMER_ACCOUNT_HYGIENE_REPAIR";

const zeroBalance = {
  availablePoints: 0,
  pendingPoints: 0,
  lifetimeEarnedPoints: 0
} as const;

export type CustomerAccountHygieneRepairClassification =
  | "NO_ELIGIBLE_CANDIDATE"
  | "READY_FOR_DETERMINISTIC_REPAIR"
  | "MULTIPLE_ELIGIBLE_CANDIDATES"
  | "BLOCKED"
  | "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE"
  | "EXECUTION_DISABLED";

export type CustomerAccountHygieneRepairReason =
  | "NO_ELIGIBLE_CANDIDATE"
  | "MULTIPLE_ELIGIBLE_CANDIDATES"
  | "INACTIVE_ACCOUNT"
  | "UNVERIFIED_ACCOUNT"
  | "MISSING_STORED_EMAIL"
  | "INVALID_NORMALIZED_EMAIL"
  | "NORMALIZED_EMAIL_ALREADY_PRESENT"
  | "REWARD_BALANCE_EXISTS"
  | "REWARD_LEDGER_HISTORY_EXISTS"
  | "POSITIVE_REWARD_HISTORY_EXISTS"
  | "REWARD_TIER_HISTORY_EXISTS"
  | "STOREFRONT_CUSTOMER_LINK_EXISTS"
  | "STOREFRONT_ORDER_LINK_EXISTS"
  | "POS_TRANSACTION_LINK_EXISTS"
  | "DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"
  | "NEGATIVE_REWARD_FIELDS"
  | "STALE_CUSTOMER_ACCOUNT"
  | "CONCURRENT_REWARD_BALANCE_CONFLICT"
  | "AUDIT_WRITE_FAILED"
  | "EXECUTION_DISABLED"
  | "POST_REPAIR_VERIFICATION_FAILED";

export type CustomerAccountHygieneRepairDryRun = {
  readOnly: true;
  executionEnabled: boolean;
  candidateCount: number;
  classification: CustomerAccountHygieneRepairClassification;
  reasonCodes: CustomerAccountHygieneRepairReason[];
  activeCandidateCount: number;
  verifiedCandidateCount: number;
  candidateWithoutBalanceCount: number;
  candidateWithoutLedgerCount: number;
  candidateWithoutPositiveHistoryCount: number;
  candidateWithoutStorefrontLinkCount: number;
  candidateWithoutOrderLinkCount: number;
  candidateWithoutPosLinkCount: number;
  validNormalizedEmailCount: number;
  uniqueNormalizedIdentityCount: number;
  expectedAvailablePoints: 0;
  expectedPendingPoints: 0;
  expectedLifetimeEarnedPoints: 0;
};

export type CustomerAccountHygieneRepairResult =
  | {
      repaired: true;
      normalizedEmailUpdated: true;
      rewardBalanceCreated: true;
      auditRecorded: true;
      availablePoints: 0;
      pendingPoints: 0;
      lifetimeEarnedPoints: 0;
      remainingEligibleCandidateCount: 0;
    }
  | {
      repaired: false;
      classification: CustomerAccountHygieneRepairClassification;
      reasonCodes: CustomerAccountHygieneRepairReason[];
    };

type HygieneClient = Pick<
  typeof prisma,
  "customerAccount" | "rewardBalance" | "rewardLedgerEntry" | "storefrontCustomer" | "storefrontOrder" | "inventorySale" | "auditLog" | "$queryRaw"
>;

type CandidateAccount = {
  id: string;
  email: string;
  normalizedEmail: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  updatedAt: Date;
  highestAcknowledgedRewardTier: number;
};

type CandidateEvaluation = {
  account: CandidateAccount;
  normalizedEmail: string | null;
  reasons: CustomerAccountHygieneRepairReason[];
  storefrontLinkCount: number;
  orderLinkCount: number;
  posLinkCount: number;
  ledgerCount: number;
  positiveLedgerCount: number;
  identityMatchCount: number;
};

export type CustomerAccountHygieneRepairExecutionOptions = {
  client?: typeof prisma;
  beforeConditionalUpdate?: (context: CustomerAccountHygieneRepairExecutionHookContext) => Promise<void> | void;
  afterWriteRevalidation?: (context: CustomerAccountHygieneRepairExecutionHookContext) => Promise<void> | void;
  beforeRewardBalanceCreate?: (context: CustomerAccountHygieneRepairExecutionHookContext) => Promise<void> | void;
  beforeAuditCreate?: (context: CustomerAccountHygieneRepairExecutionHookContext) => Promise<void> | void;
};

export type CustomerAccountHygieneRepairExecutionHookContext = {
  tx: Prisma.TransactionClient;
  ownerUserId: string;
  customerAccountId: string;
  normalizedEmail: string;
};

function isLiteralTrue(value: string | undefined) {
  return value === "true";
}

export function customerAccountHygieneRepairEnabled(env: Record<string, string | undefined> = process.env) {
  return isLiteralTrue(env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED);
}

function addReason(reasons: CustomerAccountHygieneRepairReason[], condition: boolean, reason: CustomerAccountHygieneRepairReason) {
  if (condition) reasons.push(reason);
}

function missingNormalizedEmail(value: string | null) {
  return !value?.trim();
}

async function normalizedIdentityMatches(client: HygieneClient, normalizedEmail: string) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CustomerAccount"
    WHERE "normalizedEmail" = ${normalizedEmail}
      OR lower(trim("email")) = ${normalizedEmail}
    LIMIT 3
  `;
  return Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
}

async function evaluateCandidate(client: HygieneClient, ownerUserId: string, account: CandidateAccount): Promise<CandidateEvaluation> {
  const normalizedEmail = normalizeCustomerAccountEmail(account.email);
  const [balance, ledgerCount, positiveLedgerCount, storefrontLinkCount, orderLinkCount, posLinkCount, identityMatches] =
    await Promise.all([
      client.rewardBalance.findUnique({ where: { customerAccountId: account.id }, select: { availablePoints: true, pendingPoints: true, lifetimeEarnedPoints: true } }),
      client.rewardLedgerEntry.count({ where: { customerAccountId: account.id } }),
      client.rewardLedgerEntry.count({ where: { customerAccountId: account.id, points: { gt: 0 } } }),
      client.storefrontCustomer.count({ where: { customerAccountId: account.id } }),
      client.storefrontOrder.count({ where: { customerAccountId: account.id } }),
      client.inventorySale.count({ where: { customerAccountId: account.id, platform: canonicalPosPlatformWhere() } }),
      normalizedEmail ? normalizedIdentityMatches(client, normalizedEmail) : Promise.resolve([])
    ]);
  const reasons: CustomerAccountHygieneRepairReason[] = [];
  addReason(reasons, account.status !== "active", "INACTIVE_ACCOUNT");
  addReason(reasons, !account.emailVerifiedAt, "UNVERIFIED_ACCOUNT");
  addReason(reasons, !account.email.trim(), "MISSING_STORED_EMAIL");
  addReason(reasons, !normalizedEmail, "INVALID_NORMALIZED_EMAIL");
  addReason(reasons, !missingNormalizedEmail(account.normalizedEmail), "NORMALIZED_EMAIL_ALREADY_PRESENT");
  addReason(reasons, Boolean(balance), "REWARD_BALANCE_EXISTS");
  addReason(reasons, ledgerCount > 0, "REWARD_LEDGER_HISTORY_EXISTS");
  addReason(reasons, positiveLedgerCount > 0, "POSITIVE_REWARD_HISTORY_EXISTS");
  addReason(reasons, storefrontLinkCount > 0, "STOREFRONT_CUSTOMER_LINK_EXISTS");
  addReason(reasons, orderLinkCount > 0, "STOREFRONT_ORDER_LINK_EXISTS");
  addReason(reasons, posLinkCount > 0, "POS_TRANSACTION_LINK_EXISTS");
  addReason(reasons, identityMatches.length !== 1 || identityMatches[0] !== account.id, "DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY");
  addReason(reasons, account.highestAcknowledgedRewardTier < 0, "NEGATIVE_REWARD_FIELDS");
  addReason(reasons, account.highestAcknowledgedRewardTier > 0, "REWARD_TIER_HISTORY_EXISTS");
  if (balance) {
    addReason(
      reasons,
      balance.availablePoints < 0 || balance.pendingPoints < 0 || balance.lifetimeEarnedPoints < 0,
      "NEGATIVE_REWARD_FIELDS"
    );
  }
  return {
    account,
    normalizedEmail,
    reasons,
    storefrontLinkCount,
    orderLinkCount,
    posLinkCount,
    ledgerCount,
    positiveLedgerCount,
    identityMatchCount: identityMatches.length
  };
}

async function candidateEvaluations(client: HygieneClient, ownerUserId: string) {
  const accounts = await client.customerAccount.findMany({
    where: {
      ...workspaceCustomerWhere(ownerUserId),
      status: "active",
      emailVerifiedAt: { not: null }
    },
    select: {
      id: true,
      email: true,
      normalizedEmail: true,
      status: true,
      emailVerifiedAt: true,
      updatedAt: true,
      highestAcknowledgedRewardTier: true
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const missing = accounts.filter((account) => account.email.trim() && missingNormalizedEmail(account.normalizedEmail));
  return Promise.all(missing.map((account) => evaluateCandidate(client, ownerUserId, account)));
}

function dryRunFromEvaluations(
  evaluations: CandidateEvaluation[],
  executionEnabled = customerAccountHygieneRepairEnabled()
): CustomerAccountHygieneRepairDryRun {
  const eligible = evaluations.filter((candidate) => candidate.reasons.length === 0);
  const uniqueReasons = Array.from(new Set(evaluations.flatMap((candidate) => candidate.reasons)));
  let classification: CustomerAccountHygieneRepairClassification = "NO_ELIGIBLE_CANDIDATE";
  const reasonCodes: CustomerAccountHygieneRepairReason[] = [];
  if (eligible.length === 1 && uniqueReasons.length === 0) {
    classification = "READY_FOR_DETERMINISTIC_REPAIR";
  } else if (eligible.length > 1) {
    classification = "MULTIPLE_ELIGIBLE_CANDIDATES";
    reasonCodes.push("MULTIPLE_ELIGIBLE_CANDIDATES");
  } else if (uniqueReasons.length > 0) {
    classification = "BLOCKED";
    reasonCodes.push(...uniqueReasons);
  } else {
    reasonCodes.push("NO_ELIGIBLE_CANDIDATE");
  }
  return {
    readOnly: true,
    executionEnabled,
    candidateCount: eligible.length,
    classification,
    reasonCodes,
    activeCandidateCount: evaluations.filter((candidate) => candidate.account.status === "active").length,
    verifiedCandidateCount: evaluations.filter((candidate) => Boolean(candidate.account.emailVerifiedAt)).length,
    candidateWithoutBalanceCount: evaluations.filter((candidate) => !candidate.reasons.includes("REWARD_BALANCE_EXISTS")).length,
    candidateWithoutLedgerCount: evaluations.filter((candidate) => candidate.ledgerCount === 0).length,
    candidateWithoutPositiveHistoryCount: evaluations.filter((candidate) => candidate.positiveLedgerCount === 0).length,
    candidateWithoutStorefrontLinkCount: evaluations.filter((candidate) => candidate.storefrontLinkCount === 0).length,
    candidateWithoutOrderLinkCount: evaluations.filter((candidate) => candidate.orderLinkCount === 0).length,
    candidateWithoutPosLinkCount: evaluations.filter((candidate) => candidate.posLinkCount === 0).length,
    validNormalizedEmailCount: evaluations.filter((candidate) => Boolean(candidate.normalizedEmail)).length,
    uniqueNormalizedIdentityCount: evaluations.filter((candidate) => candidate.identityMatchCount === 1).length,
    expectedAvailablePoints: 0,
    expectedPendingPoints: 0,
    expectedLifetimeEarnedPoints: 0
  };
}

export async function dryRunCustomerAccountHygieneRepair(ownerUserId: string, client: HygieneClient = prisma) {
  return dryRunFromEvaluations(await candidateEvaluations(client, ownerUserId));
}

function alreadyClean(): CustomerAccountHygieneRepairResult {
  return {
    repaired: false,
    classification: "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE",
    reasonCodes: ["NO_ELIGIBLE_CANDIDATE"]
  };
}

function disabledResult(): CustomerAccountHygieneRepairResult {
  return {
    repaired: false,
    classification: "EXECUTION_DISABLED",
    reasonCodes: ["EXECUTION_DISABLED"]
  };
}

function transactionOptions() {
  return process.env.DATABASE_URL?.startsWith("file:")
    ? undefined
    : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
}

async function revalidateCandidateOrThrow(tx: Prisma.TransactionClient, ownerUserId: string, account: CandidateAccount) {
  const fresh = await tx.customerAccount.findFirst({
    where: { id: account.id, ...workspaceCustomerWhere(ownerUserId) },
    select: {
      id: true,
      email: true,
      normalizedEmail: true,
      status: true,
      emailVerifiedAt: true,
      updatedAt: true,
      highestAcknowledgedRewardTier: true
    }
  });
  if (!fresh) throw new CustomerAccountHygieneRepairRollbackError(["STALE_CUSTOMER_ACCOUNT"]);
  const reevaluated = await evaluateCandidate(tx, ownerUserId, fresh);
  if (reevaluated.reasons.length > 0) throw new CustomerAccountHygieneRepairRollbackError(reevaluated.reasons);
  if (!reevaluated.normalizedEmail) throw new CustomerAccountHygieneRepairRollbackError(["INVALID_NORMALIZED_EMAIL"]);
  return reevaluated;
}

async function verifyRepairedStateOrThrow(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  customerAccountId: string,
  normalizedEmail: string,
  auditLogId: string
) {
  const [account, balance, ledgerCount, storefrontLinkCount, orderLinkCount, posLinkCount, identityMatches, auditCount] = await Promise.all([
    tx.customerAccount.findFirst({
      where: { id: customerAccountId, ...workspaceCustomerWhere(ownerUserId) },
      select: { normalizedEmail: true }
    }),
    tx.rewardBalance.findUnique({ where: { customerAccountId }, select: { availablePoints: true, pendingPoints: true, lifetimeEarnedPoints: true } }),
    tx.rewardLedgerEntry.count({ where: { customerAccountId } }),
    tx.storefrontCustomer.count({ where: { customerAccountId } }),
    tx.storefrontOrder.count({ where: { customerAccountId } }),
    tx.inventorySale.count({ where: { customerAccountId, platform: canonicalPosPlatformWhere() } }),
    normalizedIdentityMatches(tx, normalizedEmail),
    tx.auditLog.count({
      where: {
        id: auditLogId,
        userId: ownerUserId,
        actorEmail: null,
        action: "customer_account.hygiene_repair",
        entityType: "CustomerAccount",
        entityId: null
      }
    })
  ]);
  if (
    account?.normalizedEmail !== normalizedEmail ||
    !balance ||
    balance.availablePoints !== 0 ||
    balance.pendingPoints !== 0 ||
    balance.lifetimeEarnedPoints !== 0 ||
    ledgerCount !== 0 ||
    storefrontLinkCount !== 0 ||
    orderLinkCount !== 0 ||
    posLinkCount !== 0 ||
    identityMatches.length !== 1 ||
    identityMatches[0] !== customerAccountId ||
    auditCount !== 1
  ) {
    throw new CustomerAccountHygieneRepairRollbackError(["POST_REPAIR_VERIFICATION_FAILED"]);
  }
}

export async function executeCustomerAccountHygieneRepair(
  user: SessionUser,
  options: CustomerAccountHygieneRepairExecutionOptions = {}
): Promise<CustomerAccountHygieneRepairResult> {
  if (!customerAccountHygieneRepairEnabled()) return disabledResult();
  const rootClient = options.client ?? prisma;
  return rootClient.$transaction(async (tx) => {
    const evaluations = await candidateEvaluations(tx, user.id);
    const dryRun = dryRunFromEvaluations(evaluations, true);
    if (dryRun.classification === "NO_ELIGIBLE_CANDIDATE") return alreadyClean();
    if (dryRun.classification !== "READY_FOR_DETERMINISTIC_REPAIR" || dryRun.candidateCount !== 1) {
      throw new CustomerAccountHygieneRepairRollbackError(dryRun.reasonCodes.length ? dryRun.reasonCodes : ["MULTIPLE_ELIGIBLE_CANDIDATES"]);
    }
    const candidate = evaluations.find((item) => item.reasons.length === 0);
    if (!candidate?.normalizedEmail) throw new CustomerAccountHygieneRepairRollbackError(["INVALID_NORMALIZED_EMAIL"]);
    const revalidatedCandidate = await revalidateCandidateOrThrow(tx, user.id, candidate.account);
    const revalidatedNormalizedEmail = revalidatedCandidate.normalizedEmail;
    if (!revalidatedNormalizedEmail) throw new CustomerAccountHygieneRepairRollbackError(["INVALID_NORMALIZED_EMAIL"]);
    await options.beforeConditionalUpdate?.({
      tx,
      ownerUserId: user.id,
      customerAccountId: revalidatedCandidate.account.id,
      normalizedEmail: revalidatedNormalizedEmail
    });
    const writeReadyCandidate = await revalidateCandidateOrThrow(tx, user.id, revalidatedCandidate.account);
    const writeReadyNormalizedEmail = writeReadyCandidate.normalizedEmail;
    if (!writeReadyNormalizedEmail) throw new CustomerAccountHygieneRepairRollbackError(["INVALID_NORMALIZED_EMAIL"]);
    await options.afterWriteRevalidation?.({
      tx,
      ownerUserId: user.id,
      customerAccountId: writeReadyCandidate.account.id,
      normalizedEmail: writeReadyNormalizedEmail
    });

    const updated = await tx.customerAccount.updateMany({
      where: {
        id: writeReadyCandidate.account.id,
        userId: user.id,
        updatedAt: writeReadyCandidate.account.updatedAt,
        normalizedEmail: writeReadyCandidate.account.normalizedEmail,
        status: "active",
        emailVerifiedAt: { not: null },
        highestAcknowledgedRewardTier: 0
      },
      data: { normalizedEmail: writeReadyNormalizedEmail }
    });
    if (updated.count !== 1) throw new CustomerAccountHygieneRepairRollbackError(["STALE_CUSTOMER_ACCOUNT"]);

    let auditLogId: string;
    try {
      await options.beforeRewardBalanceCreate?.({
        tx,
        ownerUserId: user.id,
        customerAccountId: writeReadyCandidate.account.id,
        normalizedEmail: writeReadyNormalizedEmail
      });
      await tx.rewardBalance.create({
        data: {
          customerAccountId: writeReadyCandidate.account.id,
          ...zeroBalance
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new CustomerAccountHygieneRepairRollbackError(["CONCURRENT_REWARD_BALANCE_CONFLICT"]);
      }
      throw error;
    }

    try {
      await options.beforeAuditCreate?.({
        tx,
        ownerUserId: user.id,
        customerAccountId: writeReadyCandidate.account.id,
        normalizedEmail: writeReadyNormalizedEmail
      });
      const auditLog = await tx.auditLog.create({
        data: {
          userId: user.id,
          actorEmail: null,
          action: "customer_account.hygiene_repair",
          entityType: "CustomerAccount",
          entityId: null,
          summary: "Normalized one eligible zero-history customer account and created a zero reward balance.",
          metadata: JSON.stringify({
            operation: customerAccountHygieneRepairOperation,
            success: true,
            availablePoints: 0,
            pendingPoints: 0,
            lifetimeEarnedPoints: 0
          })
        }
      });
      auditLogId = auditLog.id;
    } catch {
      throw new CustomerAccountHygieneRepairRollbackError(["AUDIT_WRITE_FAILED"]);
    }

    await verifyRepairedStateOrThrow(tx, user.id, writeReadyCandidate.account.id, writeReadyNormalizedEmail, auditLogId);
    const remaining = dryRunFromEvaluations(await candidateEvaluations(tx, user.id), true);
    if (remaining.candidateCount !== 0) throw new CustomerAccountHygieneRepairRollbackError(["MULTIPLE_ELIGIBLE_CANDIDATES"]);
    return {
      repaired: true,
      normalizedEmailUpdated: true,
      rewardBalanceCreated: true,
      auditRecorded: true,
      ...zeroBalance,
      remainingEligibleCandidateCount: 0
    };
  }, transactionOptions());
}

export class CustomerAccountHygieneRepairRollbackError extends Error {
  readonly reasonCodes: CustomerAccountHygieneRepairReason[];
  constructor(reasonCodes: CustomerAccountHygieneRepairReason[]) {
    super("Customer account hygiene repair could not be completed.");
    this.name = "CustomerAccountHygieneRepairRollbackError";
    this.reasonCodes = reasonCodes;
  }
}

export function customerAccountHygieneRepairSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(privateNoStoreHeaders)) response.headers.set(name, value);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
