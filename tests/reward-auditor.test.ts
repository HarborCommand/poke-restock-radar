import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditRewardMutation, runRewardReconciliation } from "../src/lib/reward-auditor";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeClient(overrides: {
  customer?: { id: string; status: string } | null;
  existingLedger?: { id: string; points: number; customerAccountId: string } | null;
  balance?: { availablePoints: number; pendingPoints?: number; lifetimeEarnedPoints?: number } | null;
  order?: {
    id?: string;
    userId: string;
    customerAccountId: string | null;
    paymentStatus: string;
    status: string;
    refundedAmount: number;
    isTestOrder: boolean;
  } | null;
  recentLedger?: Array<Record<string, unknown>>;
  customerLedger?: Array<{ id?: string; points: number; type: string; status: string | null; source?: string | null; reversalOfEntryId?: string | null; metadataJson?: string | null }>;
} = {}) {
  const findings: unknown[] = [];
  return {
    findings,
    customerAccount: {
      findUnique: async () => overrides.customer ?? { id: "customer-1", status: "active" }
    },
    rewardLedgerEntry: {
      findUnique: async () => overrides.existingLedger ?? null,
      findMany: async (query: { where?: { customerAccountId?: string; createdAt?: unknown } }) => {
        if (query.where?.createdAt) return overrides.recentLedger ?? [];
        if (query.where?.customerAccountId) return overrides.customerLedger ?? [];
        return [];
      }
    },
    rewardBalance: {
      findUnique: async () => overrides.balance ?? { availablePoints: 100, pendingPoints: 0, lifetimeEarnedPoints: 100 }
    },
    storefrontOrder: {
      findUnique: async () => overrides.order ?? null
    },
    rewardAuditFinding: {
      upsert: async (input: unknown) => {
        findings.push(input);
        return { id: `finding-${findings.length}` };
      }
    }
  } as never;
}

test("synchronous reward auditor approves valid deterministic mutation", async () => {
  const result = await auditRewardMutation(fakeClient(), {
    operation: "pos.reward.earn",
    sourceType: "pos_sale",
    sourceReference: "POS-PRIVATE-REFERENCE",
    customerAccountId: "customer-1",
    idempotencyKey: "rewards:pos:earn:private",
    points: 25,
    featureEnabled: true,
    requireLinkedCustomer: true
  });
  assert.equal(result.decision, "approved");
  assert.equal(result.reasonCode, "APPROVED");
  assert.notEqual(result.sourceReferenceHash, "POS-PRIVATE-REFERENCE");
});

test("synchronous reward auditor blocks duplicate and unsafe mutations before writes", async () => {
  const duplicate = await auditRewardMutation(fakeClient({ existingLedger: { id: "ledger-1", points: 25, customerAccountId: "customer-1" } }), {
    operation: "pos.reward.earn",
    sourceType: "pos_sale",
    sourceReference: "POS-DUPLICATE",
    customerAccountId: "customer-1",
    idempotencyKey: "rewards:pos:earn:duplicate",
    points: 25,
    featureEnabled: true
  });
  assert.equal(duplicate.decision, "blocked");
  assert.equal(duplicate.reasonCode, "DUPLICATE_REWARD");
  assert.equal(duplicate.duplicate, true);

  const deduction = await auditRewardMutation(fakeClient({ balance: { availablePoints: 3 } }), {
    operation: "admin.reward.adjustment",
    sourceType: "admin_adjustment",
    sourceReference: "admin-adjustment-private",
    customerAccountId: "customer-1",
    idempotencyKey: "rewards:admin:customer-1:deduct:private",
    points: -10,
    featureEnabled: true,
    allowNegativePoints: true,
    checkAvailableBalance: true
  });
  assert.equal(deduction.decision, "blocked");
  assert.equal(deduction.reasonCode, "NEGATIVE_AVAILABLE_BALANCE");
});

test("review-required legacy conditions create one idempotent finding through the canonical service", async () => {
  const client = fakeClient();
  const result = await auditRewardMutation(client, {
    operation: "admin.reward.legacy_backfill",
    sourceType: "admin_backfill",
    sourceReference: "legacy-private-source",
    customerAccountId: "customer-1",
    idempotencyKey: "rewards:backfill:legacy-private",
    points: 12,
    featureEnabled: true,
    legacyOwnershipEvidence: "missing"
  });
  assert.equal(result.decision, "review_required");
  assert.equal(result.reasonCode, "MISSING_LEGACY_OWNERSHIP_EVIDENCE");
  assert.equal((client as unknown as { findings: unknown[] }).findings.length, 1);
});

test("background reconciliation is bounded and records findings without correcting balances", async () => {
  const client = fakeClient({
    recentLedger: [
      {
        id: "ledger-1",
        customerAccountId: "customer-1",
        orderId: null,
        points: 20,
        type: "earn",
        status: "available",
        source: "pos",
        idempotencyKey: "rewards:pos:earn:one",
        eligibleSubtotalCents: 2_000,
        reversalOfEntryId: null,
        metadataJson: JSON.stringify({ saleReference: "POS-ONE" }),
        order: null
      },
      {
        id: "ledger-2",
        customerAccountId: "customer-1",
        orderId: null,
        points: 20,
        type: "earn",
        status: "available",
        source: "pos",
        idempotencyKey: "rewards:pos:earn:two",
        eligibleSubtotalCents: 2_000,
        reversalOfEntryId: null,
        metadataJson: JSON.stringify({ saleReference: "POS-ONE" }),
        order: null
      }
    ],
    customerLedger: [
      { id: "ledger-1", points: 20, type: "earn", status: "available", source: "pos", reversalOfEntryId: null, metadataJson: null },
      { id: "ledger-2", points: 20, type: "earn", status: "available", source: "pos", reversalOfEntryId: null, metadataJson: null }
    ],
    balance: { availablePoints: 20, pendingPoints: 0, lifetimeEarnedPoints: 40 }
  });
  const result = await runRewardReconciliation({ pageSize: 10, maxPages: 1 }, client);
  assert.equal(result.status, "findings");
  assert.ok(result.findings >= 2);
  assert.equal((client as unknown as { findings: unknown[] }).findings.length >= 2, true);
});

test("reward auditor has no customer-facing UI and cron is protected", () => {
  const route = readFileSync(path.join(root, "src/app/api/radar/rewards/audit/cron/route.ts"), "utf8");
  const vercel = readFileSync(path.join(root, "vercel.json"), "utf8");
  const app = readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  assert.match(route, /cronAuthorized/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /privateNoStoreHeaders/);
  assert.ok(
    !JSON.parse(vercel).crons?.length,
    "Reward audit cron must not be scheduled automatically by Vercel."
  );
  assert.doesNotMatch(app, /RewardAuditFinding|reward_audit|reconciliation_finding/);
});
