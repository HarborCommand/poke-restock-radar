import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

type RewardAuditLedgerEntry = {
  id: string;
  points: number;
  type: string;
  status: string | null;
  source: string | null;
  reversalOfEntryId: string | null;
  metadataJson: string | null;
};

type RewardAuditBalance = {
  availablePoints: number;
  pendingPoints: number;
  lifetimeEarnedPoints: number;
} | null;

export type RewardBalanceAudit = {
  accountRef: string;
  isComplete: boolean;
  stored: { availablePoints: number; pendingPoints: number; lifetimeEarnedPoints: number };
  expected: { availablePoints: number; pendingPoints: number; lifetimeEarnedPoints: number };
  deltas: { availablePoints: number; pendingPoints: number; lifetimeEarnedPoints: number };
  ledgerCounts: {
    total: number;
    scanned: number;
    pending: number;
    available: number;
    reversed: number;
    canceled: number;
    legacyNullStatus: number;
  };
  warnings: string[];
  isBalanced: boolean;
};

const rewardAuditEntryLimit = 1_000;

function normalizedStatus(entry: RewardAuditLedgerEntry) {
  if (entry.status === "pending" || entry.status === "available" || entry.status === "reversed" || entry.status === "canceled") {
    return entry.status;
  }
  if (entry.points < 0 || entry.type === "reverse") return "reversed" as const;
  if (entry.points > 0) return "available" as const;
  return "canceled" as const;
}

function safeMetadata(entry: RewardAuditLedgerEntry, warnings: string[]) {
  if (!entry.metadataJson) return null;
  try {
    const value = JSON.parse(entry.metadataJson);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    warnings.push("malformed_metadata");
    return null;
  }
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function calculateExpectedRewardBalance(entries: RewardAuditLedgerEntry[]) {
  const warnings: string[] = [];
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  let pendingPoints = 0;
  let availablePoints = 0;
  let lifetimeEarnedPoints = 0;

  for (const entry of entries) {
    const status = normalizedStatus(entry);
    if (entry.points > 0) {
      lifetimeEarnedPoints += entry.points;
      if (status === "pending") pendingPoints += entry.points;
      if (status === "available") availablePoints += entry.points;
      continue;
    }
    if (entry.points >= 0) continue;

    const reversedEntry = entry.reversalOfEntryId ? entryById.get(entry.reversalOfEntryId) : null;
    if (reversedEntry && normalizedStatus(reversedEntry) === "canceled") continue;

    const metadata = safeMetadata(entry, warnings);
    const pendingReversed = nonNegativeInteger(metadata?.pendingPointsReversed);
    const availableReversed = nonNegativeInteger(metadata?.availablePointsReversed);
    if (pendingReversed !== null || availableReversed !== null) {
      pendingPoints -= pendingReversed ?? 0;
      availablePoints -= availableReversed ?? 0;
      continue;
    }

    // Legacy reversals, POS reversals, and admin deductions all operated on available points.
    availablePoints += entry.points;
  }

  if (pendingPoints < 0) warnings.push("negative_expected_pending");
  if (availablePoints < 0) warnings.push("negative_expected_available");
  return {
    expected: {
      pendingPoints: Math.max(0, pendingPoints),
      availablePoints: Math.max(0, availablePoints),
      lifetimeEarnedPoints: Math.max(0, lifetimeEarnedPoints)
    },
    warnings: [...new Set(warnings)]
  };
}

function maskedAccountRef(customerAccountId: string) {
  return `customer_${createHash("sha256").update(customerAccountId).digest("hex").slice(0, 12)}`;
}

export async function calculateRewardBalanceAudit(customerAccountId: string): Promise<RewardBalanceAudit> {
  const [balance, entries, totalEntries] = await Promise.all([
    prisma.rewardBalance.findUnique({
      where: { customerAccountId },
      select: { availablePoints: true, pendingPoints: true, lifetimeEarnedPoints: true }
    }),
    prisma.rewardLedgerEntry.findMany({
      where: { customerAccountId },
      select: {
        id: true,
        points: true,
        type: true,
        status: true,
        source: true,
        reversalOfEntryId: true,
        metadataJson: true
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: rewardAuditEntryLimit
    }),
    prisma.rewardLedgerEntry.count({ where: { customerAccountId } })
  ]);
  return rewardBalanceAuditResult(customerAccountId, balance, entries, totalEntries);
}

export function rewardBalanceAuditResult(
  customerAccountId: string,
  balance: RewardAuditBalance,
  entries: RewardAuditLedgerEntry[],
  totalEntries = entries.length
): RewardBalanceAudit {
  const truncated = totalEntries > entries.length;
  const stored = balance ?? { availablePoints: 0, pendingPoints: 0, lifetimeEarnedPoints: 0 };
  const calculated = calculateExpectedRewardBalance(entries);
  const expected = calculated.expected;
  const deltas = {
    availablePoints: stored.availablePoints - expected.availablePoints,
    pendingPoints: stored.pendingPoints - expected.pendingPoints,
    lifetimeEarnedPoints: stored.lifetimeEarnedPoints - expected.lifetimeEarnedPoints
  };
  const statuses = entries.map(normalizedStatus);
  return {
    accountRef: maskedAccountRef(customerAccountId),
    isComplete: !truncated,
    stored,
    expected,
    deltas,
    ledgerCounts: {
      total: totalEntries,
      scanned: entries.length,
      pending: statuses.filter((status) => status === "pending").length,
      available: statuses.filter((status) => status === "available").length,
      reversed: statuses.filter((status) => status === "reversed").length,
      canceled: statuses.filter((status) => status === "canceled").length,
      legacyNullStatus: entries.filter((entry) => entry.status === null).length
    },
    warnings: truncated ? [...calculated.warnings, "entry_limit_reached"] : calculated.warnings,
    isBalanced: !truncated && Object.values(deltas).every((delta) => delta === 0)
  };
}
