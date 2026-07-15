import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  maximumRewardEligibleSubtotalCents,
  rewardEligibleSubtotalCents,
  rewardEligibleSubtotalCentsFromAmounts,
  rewardMoneyToCents,
  rewardPointsForEligibleSubtotalCents
} from "../src/lib/customer-rewards";
import { calculateExpectedRewardBalance, rewardBalanceAuditResult } from "../src/lib/reward-reconciliation";
import { isRetryableRewardTransactionError } from "../src/lib/reward-transaction";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Entry = Parameters<typeof calculateExpectedRewardBalance>[0][number];

function entry(input: Partial<Entry> & Pick<Entry, "id" | "points">): Entry {
  return {
    type: input.points < 0 ? "reverse" : "earn",
    status: input.points < 0 ? "reversed" : "available",
    source: "stripe_checkout",
    reversalOfEntryId: null,
    metadataJson: null,
    ...input
  };
}

test("reconciliation handles pending, available, legacy, reversal, and lifetime semantics", () => {
  const entries = [
    entry({ id: "pending", points: 20, status: "pending" }),
    entry({ id: "available", points: 30, status: "available" }),
    entry({ id: "legacy", points: 5, status: null }),
    entry({ id: "partial", points: -8, reversalOfEntryId: "pending", metadataJson: JSON.stringify({ pendingPointsReversed: 8, availablePointsReversed: 0 }) }),
    entry({ id: "admin-deduct", points: -3, type: "adjustment", status: "available", source: "admin_adjustment" })
  ];
  assert.deepEqual(calculateExpectedRewardBalance(entries).expected, {
    pendingPoints: 12,
    availablePoints: 32,
    lifetimeEarnedPoints: 55
  });
});

test("canceled earning plus its reversal is not double-subtracted", () => {
  const entries = [
    entry({ id: "earn", points: 25, status: "canceled" }),
    entry({ id: "reverse", points: -25, reversalOfEntryId: "earn", metadataJson: JSON.stringify({ availablePointsReversed: 25 }) })
  ];
  assert.deepEqual(calculateExpectedRewardBalance(entries).expected, {
    pendingPoints: 0,
    availablePoints: 0,
    lifetimeEarnedPoints: 25
  });
});

test("audit reports deltas without exposing the customer id", () => {
  const result = rewardBalanceAuditResult(
    "private-customer-id",
    { availablePoints: 9, pendingPoints: 0, lifetimeEarnedPoints: 10 },
    [entry({ id: "earn", points: 10 })]
  );
  assert.equal(result.isBalanced, false);
  assert.equal(result.deltas.availablePoints, -1);
  assert.match(result.accountRef, /^customer_[a-f0-9]{12}$/);
  assert.doesNotMatch(JSON.stringify(result), /private-customer-id/);
});

test("canonical reward calculator uses bounded integer cents and floors points", () => {
  assert.equal(rewardMoneyToCents(0), 0);
  assert.equal(rewardMoneyToCents(0.009), 1);
  assert.equal(rewardMoneyToCents(0.99), 99);
  assert.equal(rewardMoneyToCents(1), 100);
  assert.equal(rewardMoneyToCents(55), 5_500);
  assert.equal(rewardMoneyToCents(-5), 0);
  assert.equal(rewardMoneyToCents(Number.NaN), 0);
  assert.equal(rewardMoneyToCents(Number.POSITIVE_INFINITY), 0);
  assert.equal(rewardMoneyToCents(Number.MAX_VALUE), maximumRewardEligibleSubtotalCents);
  assert.equal(rewardPointsForEligibleSubtotalCents(0), 0);
  assert.equal(rewardPointsForEligibleSubtotalCents(99), 0);
  assert.equal(rewardPointsForEligibleSubtotalCents(100), 1);
  assert.equal(rewardPointsForEligibleSubtotalCents(5_500), 55);
  assert.equal(rewardPointsForEligibleSubtotalCents(maximumRewardEligibleSubtotalCents + 1), 1_000_000);
});

test("eligible subtotal uses discounted line totals and excludes tax and shipping", () => {
  assert.equal(
    rewardEligibleSubtotalCents({
      subtotal: 70,
      items: [{ lineTotal: 20.25 }, { lineTotal: 29.74 }]
    }),
    4_999
  );
  assert.equal(rewardEligibleSubtotalCentsFromAmounts([10, -20, null, undefined, 2.345]), 1_235);
});

test("serialization retry detection accepts Prisma-compatible P2034 errors only", () => {
  assert.equal(isRetryableRewardTransactionError({ code: "P2034" }), true);
  assert.equal(isRetryableRewardTransactionError({ code: "P2002" }), false);
  assert.equal(isRetryableRewardTransactionError(new Error("P2034")), false);
});

test("canonical ledger writes use atomic upsert and serializable transactions", () => {
  const rewards = readFileSync(path.join(root, "src/lib/customer-rewards.ts"), "utf8");
  const admin = readFileSync(path.join(root, "src/lib/rewards-admin.ts"), "utf8");
  const backfill = readFileSync(path.join(root, "src/lib/admin-customer-order-links.ts"), "utf8");
  assert.match(rewards, /rewardLedgerEntry\.upsert/);
  assert.match(rewards, /ledgerCreationNonce/);
  const transaction = readFileSync(path.join(root, "src/lib/reward-transaction.ts"), "utf8");
  const radar = readFileSync(path.join(root, "src/lib/radar-service.ts"), "utf8");
  const storefront = readFileSync(path.join(root, "src/lib/storefront.ts"), "utf8");
  assert.match(transaction, /TransactionIsolationLevel\.Serializable/);
  assert.match(transaction, /\.code === "P2034"/);
  assert.match(transaction, /defaultMaxAttempts = 3/);
  assert.match(rewards, /runRewardSerializableTransaction/);
  assert.match(rewards, /const persistedOrder = await loadRewardOrder\(tx, order\.id\)/);
  assert.match(rewards, /availablePoints: \{ gte: Math\.abs\(availableDelta\) \}/);
  assert.match(admin, /rewardLedgerEntry\.upsert/);
  assert.match(admin, /availablePoints: \{ gte: input\.points \}/);
  assert.match(admin, /rewards:admin:\$\{input\.customerAccountId\}/);
  assert.match(backfill, /rewardLedgerEntry\.upsert/g);
  assert.match(backfill, /ledgerCreationNonce/g);
  assert.match(backfill, /runRewardSerializableTransaction/);
  assert.match(radar, /const receipt = await runRewardSerializableTransaction/);
  assert.match(radar, /await runRewardSerializableTransaction\(async \(tx\) =>/);
  assert.match(storefront, /const transactionResult = await runTaxRefundTransaction\(async \(tx\) =>/);
  assert.match(storefront, /await reverseRewardsForOrder\([\s\S]*?updated,[\s\S]*?tx\s*\)/);
});

test("reconciliation helper is read-only", () => {
  const source = readFileSync(path.join(root, "src/lib/reward-reconciliation.ts"), "utf8");
  assert.match(source, /rewardBalance\.findUnique/);
  assert.match(source, /rewardLedgerEntry\.findMany/);
  assert.match(source, /take: rewardAuditEntryLimit/);
  assert.match(source, /rewardLedgerEntry\.count/);
  assert.doesNotMatch(source, /prisma\.(?:rewardBalance|rewardLedgerEntry)\.(?:create|update|updateMany|delete|upsert)\(|\$executeRaw|\$queryRawUnsafe/);
});

test("truncated reconciliation never reports a false balanced result", () => {
  const result = rewardBalanceAuditResult(
    "private-customer-id",
    { availablePoints: 10, pendingPoints: 0, lifetimeEarnedPoints: 10 },
    [entry({ id: "earn", points: 10 })],
    2
  );
  assert.equal(result.isComplete, false);
  assert.equal(result.isBalanced, false);
  assert.ok(result.warnings.includes("entry_limit_reached"));
});

test("reconciliation route is admin-only, private, and read-only", () => {
  const route = readFileSync(path.join(root, "src/app/api/radar/rewards/reconciliation/route.ts"), "utf8");
  assert.match(route, /await requireUser\(\)/);
  assert.match(route, /requireAdmin\(user\)/);
  assert.match(route, /privateOk/);
  assert.match(route, /calculateRewardBalanceAudit/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)|\.create\(|\.update\(|\.delete\(|\.upsert\(/);
});
