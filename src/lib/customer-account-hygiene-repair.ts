import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeCustomerAccountEmail } from "@/lib/customer-account-auth";
import { privateNoStoreHeaders } from "@/lib/http";
import { workspaceCustomerWhere } from "@/lib/customer-workspace";
import type { SessionUser } from "@/types/radar";

export const customerAccountHygieneRepairOperation = "NORMALIZE_SINGLE_ZERO_HISTORY_ACCOUNT_AND_CREATE_ZERO_BALANCE";
export const customerAccountHygieneRepairConfirmation = "EXECUTE_DETERMINISTIC_CUSTOMER_ACCOUNT_HYGIENE_REPAIR";

const zeroBalance = {
  availablePoints: 0,
  pendingPoints: 0,
  lifetimeEarnedPoints: 0
} as const;

const paidOrderWhere = {
  paymentStatus: "paid",
  isTestOrder: false
} as const;

const posPlatforms = ["pos", "POS"] as const;

export type CustomerAccountHygieneRepairClassification =
  | "NO_ELIGIBLE_CANDIDATE"
  | "READY_FOR_DETERMINISTIC_REPAIR"
  | "MULTIPLE_ELIGIBLE_CANDIDATES"
  | "BLOCKED"
  | "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE";

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
  | "STOREFRONT_CUSTOMER_LINK_EXISTS"
  | "PAID_ORDER_LINK_EXISTS"
  | "POS_TRANSACTION_LINK_EXISTS"
  | "DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"
  | "EXPECTED_BALANCE_NONZERO"
  | "NEGATIVE_REWARD_FIELDS"
  | "STALE_CUSTOMER_ACCOUNT"
  | "CONCURRENT_REWARD_BALANCE_CONFLICT"
  | "AUDIT_WRITE_FAILED";

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
  candidateWithoutPaidOrderLinkCount: number;
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
  paidOrderLinkCount: number;
  posLinkCount: number;
  ledgerCount: number;
  positiveLedgerCount: number;
  identityMatchCount: number;
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

async function normalizedIdentityMatches(client: HygieneClient, ownerUserId: string, normalizedEmail: string) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CustomerAccount"
    WHERE "userId" = ${ownerUserId}
      AND (
        "normalizedEmail" = ${normalizedEmail}
        OR lower(trim("email")) = ${normalizedEmail}
      )
    LIMIT 3
  `;
  return Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
}

async function evaluateCandidate(client: HygieneClient, ownerUserId: string, account: CandidateAccount): Promise<CandidateEvaluation> {
  const normalizedEmail = normalizeCustomerAccountEmail(account.email);
  const [balance, ledgerCount, positiveLedgerCount, storefrontLinkCount, paidOrderLinkCount, posLinkCount, identityMatches] =
    await Promise.all([
      client.rewardBalance.findUnique({ where: { customerAccountId: account.id }, select: { availablePoints: true, pendingPoints: true, lifetimeEarnedPoints: true } }),
      client.rewardLedgerEntry.count({ where: { customerAccountId: account.id } }),
      client.rewardLedgerEntry.count({ where: { customerAccountId: account.id, points: { gt: 0 } } }),
      client.storefrontCustomer.count({ where: { userId: ownerUserId, customerAccountId: account.id } }),
      client.storefrontOrder.count({ where: { userId: ownerUserId, customerAccountId: account.id, ...paidOrderWhere } }),
      client.inventorySale.count({ where: { userId: ownerUserId, customerAccountId: account.id, platform: { in: [...posPlatforms] } } }),
      normalizedEmail ? normalizedIdentityMatches(client, ownerUserId, normalizedEmail) : Promise.resolve([])
    ]);
  const expected = zeroBalance;
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
  addReason(reasons, paidOrderLinkCount > 0, "PAID_ORDER_LINK_EXISTS");
  addReason(reasons, posLinkCount > 0, "POS_TRANSACTION_LINK_EXISTS");
  addReason(reasons, identityMatches.length !== 1 || identityMatches[0] !== account.id, "DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY");
  addReason(
    reasons,
    expected.availablePoints !== 0 || expected.pendingPoints !== 0 || expected.lifetimeEarnedPoints !== 0,
    "EXPECTED_BALANCE_NONZERO"
  );
  addReason(reasons, account.highestAcknowledgedRewardTier < 0, "NEGATIVE_REWARD_FIELDS");
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
    paidOrderLinkCount,
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
    candidateWithoutPaidOrderLinkCount: evaluations.filter((candidate) => candidate.paidOrderLinkCount === 0).length,
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

function safeConflict(reasonCodes: CustomerAccountHygieneRepairReason[]): CustomerAccountHygieneRepairResult {
  return {
    repaired: false,
    classification: reasonCodes.includes("NO_ELIGIBLE_CANDIDATE") ? "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE" : "BLOCKED",
    reasonCodes
  };
}

function transactionOptions() {
  return process.env.DATABASE_URL?.startsWith("file:")
    ? undefined
    : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
}

export async function executeCustomerAccountHygieneRepair(user: SessionUser): Promise<CustomerAccountHygieneRepairResult> {
  return prisma.$transaction(async (tx) => {
    const evaluations = await candidateEvaluations(tx, user.id);
    const dryRun = dryRunFromEvaluations(evaluations, true);
    if (dryRun.candidateCount === 0) return safeConflict(["NO_ELIGIBLE_CANDIDATE"]);
    if (dryRun.classification !== "READY_FOR_DETERMINISTIC_REPAIR") return safeConflict(dryRun.reasonCodes);
    const candidate = evaluations.find((item) => item.reasons.length === 0);
    if (!candidate?.normalizedEmail) return safeConflict(["INVALID_NORMALIZED_EMAIL"]);

    const updated = await tx.customerAccount.updateMany({
      where: {
        id: candidate.account.id,
        userId: user.id,
        updatedAt: candidate.account.updatedAt,
        normalizedEmail: candidate.account.normalizedEmail
      },
      data: { normalizedEmail: candidate.normalizedEmail }
    });
    if (updated.count !== 1) return safeConflict(["STALE_CUSTOMER_ACCOUNT"]);

    try {
      await tx.rewardBalance.create({
        data: {
          customerAccountId: candidate.account.id,
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
      await tx.auditLog.create({
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
    } catch {
      throw new CustomerAccountHygieneRepairRollbackError(["AUDIT_WRITE_FAILED"]);
    }

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
