import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-customer-reward-integrity-"));
const testDbPath = path.join(testDbDir, "customer-reward-integrity.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.CUSTOMER_ACCOUNTS_ENABLED = "false";
process.env.CUSTOMER_REWARDS_ENABLED = "false";
process.env.CUSTOMER_POS_REWARDS_ENABLED = "false";
process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const integrityModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-reward-integrity.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { buildCustomerRewardIntegrityReport } = integrityModule as typeof import("../src/lib/customer-reward-integrity");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

function disabledRewardEnv() {
  process.env.CUSTOMER_ACCOUNTS_ENABLED = "false";
  process.env.CUSTOMER_REWARDS_ENABLED = "false";
  process.env.CUSTOMER_POS_REWARDS_ENABLED = "false";
  process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
  process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";
}

async function createOwner() {
  return prisma.user.create({
    data: {
      email: `${unique("owner")}@example.test`,
      name: "Test Admin",
      role: "ADMIN",
      passwordHash: "test-hash"
    }
  });
}

async function createCustomer(userId: string, overrides: Partial<{
  email: string;
  normalizedEmail: string | null;
  status: string;
  emailVerifiedAt: Date | null;
}> = {}) {
  const email = overrides.email ?? `${unique("collector")}@example.test`;
  return prisma.customerAccount.create({
    data: {
      userId,
      email,
      normalizedEmail: overrides.normalizedEmail === undefined ? email.toLowerCase() : overrides.normalizedEmail,
      status: overrides.status ?? "active",
      emailVerifiedAt: overrides.emailVerifiedAt === undefined ? new Date("2026-01-01T00:00:00.000Z") : overrides.emailVerifiedAt
    }
  });
}

async function setBalance(customerAccountId: string, availablePoints: number, pendingPoints: number, lifetimeEarnedPoints: number) {
  return prisma.rewardBalance.create({
    data: {
      customerAccountId,
      availablePoints,
      pendingPoints,
      lifetimeEarnedPoints
    }
  });
}

async function createInventoryItem(userId: string) {
  return prisma.inventoryItem.create({
    data: {
      userId,
      itemType: "product",
      itemName: unique("Integrity fixture item"),
      category: "sealed_packs",
      cost: 10,
      quantity: 4,
      source: "Integrity test",
      purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
      publicPrice: 25,
      targetSellPrice: 25
    }
  });
}

async function createPaidOrder(userId: string, customerAccountId: string | null, overrides: Partial<{
  customerEmail: string | null;
  customerName: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  refundStatus: string | null;
  refundedAmount: number;
}> = {}) {
  return prisma.storefrontOrder.create({
    data: {
      userId,
      customerAccountId,
      orderNumber: unique("ORDER"),
      customerEmail: overrides.customerEmail ?? null,
      customerName: overrides.customerName ?? null,
      status: overrides.status ?? "paid",
      paymentStatus: overrides.paymentStatus ?? "paid",
      fulfillmentStatus: overrides.fulfillmentStatus ?? "unfulfilled",
      refundStatus: overrides.refundStatus ?? null,
      refundedAmount: overrides.refundedAmount ?? 0,
      subtotal: 50,
      total: 50
    }
  });
}

async function createPosSale(userId: string, customerAccountId: string | null, overrides: Partial<{
  customerEmail: string | null;
  saleReference: string | null;
  refundStatus: string | null;
  refundedAmount: number;
}> = {}) {
  const item = await createInventoryItem(userId);
  return prisma.inventorySale.create({
    data: {
      userId,
      inventoryItemId: item.id,
      customerAccountId,
      customerEmail: overrides.customerEmail ?? null,
      saleReference: overrides.saleReference ?? unique("POS"),
      quantitySold: 1,
      soldPricePerItem: 20,
      grossSale: 20,
      platform: "POS",
      netSale: 20,
      costBasis: 10,
      profitLoss: 10,
      refundStatus: overrides.refundStatus ?? null,
      refundedAmount: overrides.refundedAmount ?? 0,
      soldAt: new Date("2026-01-02T00:00:00.000Z")
    }
  });
}

test("empty customer and reward report is aggregate, read-only, and passable with disabled flags", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.readOnly, true);
  assert.equal(report.overallClassification, "PASS");
  assert.equal(report.sections.runtimeConfiguration.classification, "PASS");
  assert.equal(report.sections.customerAccountIntegrity.metrics.totalCustomerAccounts, 0);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.allRewardLedgerEntries, 0);
});

test("balanced accounts reconcile using existing ledger math without exposing identifiers", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id, { email: "privacy.fixture@example.test" });
  const availableEarn = await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 100,
      type: "earn",
      reason: "Purchase",
      status: "available",
      idempotencyKey: `reward:${unique("earn")}`,
      source: "stripe_checkout",
      metadataJson: JSON.stringify({ email: customer.email, idempotencyKey: "should-not-leak" })
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 10,
      type: "earn",
      reason: "Purchase",
      status: "pending",
      idempotencyKey: `reward:${unique("pending")}`,
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: -5,
      type: "reverse",
      reason: "Refund",
      status: "reversed",
      idempotencyKey: `reward:${unique("reverse")}`,
      source: "stripe_checkout",
      reversalOfEntryId: availableEarn.id,
      metadataJson: JSON.stringify({ availablePointsReversed: 5 })
    }
  });
  await setBalance(customer.id, 95, 10, 110);

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const payload = JSON.stringify(report);

  assert.equal(report.sections.rewardBalanceReconciliation.classification, "PASS");
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.fullyReconciledAccounts, 1);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.totalAbsoluteAvailablePointVariance, 0);
  assert.ok(!payload.includes(customer.id));
  assert.ok(!payload.includes(customer.email));
  assert.ok(!payload.includes(availableEarn.id));
  assert.ok(!payload.includes("should-not-leak"));
});

test("clean three-account dataset reports active verified aggregate counts", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  for (let index = 0; index < 3; index += 1) {
    const customer = await createCustomer(owner.id);
    await prisma.rewardLedgerEntry.create({
      data: {
        customerAccountId: customer.id,
        points: 10,
        type: "earn",
        reason: "Purchase",
        status: "available",
        idempotencyKey: `reward:${unique("three-account")}`,
        source: "stripe_checkout"
      }
    });
    await setBalance(customer.id, 10, 0, 10);
  }

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerAccountIntegrity.metrics.totalCustomerAccounts, 3);
  assert.equal(report.sections.customerAccountIntegrity.metrics.activeAccounts, 3);
  assert.equal(report.sections.customerAccountIntegrity.metrics.verifiedAccounts, 3);
  assert.equal(report.sections.customerAccountIntegrity.metrics.accountsWithNormalizedEmail, 3);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.fullyReconciledAccounts, 3);
  assert.equal(report.sections.rewardBalanceReconciliation.classification, "PASS");
});

test("available pending and lifetime balance mismatches are independently blocked", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id, { normalizedEmail: null, emailVerifiedAt: null });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 10,
      type: "earn",
      reason: "Purchase",
      status: "available",
      idempotencyKey: `reward:${unique("available-mismatch")}`,
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 5,
      type: "earn",
      reason: "Purchase",
      status: "pending",
      idempotencyKey: `reward:${unique("pending-mismatch")}`,
      source: "stripe_checkout"
    }
  });
  await setBalance(customer.id, 8, 2, 11);

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerAccountIntegrity.metrics.accountsMissingNormalizedEmail, 1);
  assert.ok(report.sections.customerAccountIntegrity.reasons.includes("CUSTOMER_ACCOUNTS_MISSING_NORMALIZED_EMAIL"));
  assert.ok(report.sections.rewardBalanceReconciliation.reasons.includes("AVAILABLE_REWARD_BALANCE_MISMATCH"));
  assert.ok(report.sections.rewardBalanceReconciliation.reasons.includes("PENDING_REWARD_BALANCE_MISMATCH"));
  assert.ok(report.sections.rewardBalanceReconciliation.reasons.includes("LIFETIME_REWARD_BALANCE_MISMATCH"));
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.totalAbsoluteAvailablePointVariance, 2);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.totalAbsolutePendingPointVariance, 3);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.totalAbsoluteLifetimeEarnedVariance, 4);
});

test("identity, balance, ledger, order, and POS anomalies are classified without PII", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  const duplicateA = await createCustomer(owner.id, {
    email: `${unique("dupe-a")}@example.test`,
    normalizedEmail: "duplicate@example.test"
  });
  const duplicateB = await createCustomer(owner.id, {
    email: `${unique("dupe-b")}@example.test`,
    normalizedEmail: "duplicate@example.test"
  });
  await setBalance(duplicateA.id, -1, 0, 0);
  await setBalance(duplicateB.id, 0, 0, 0);
  const canceledOrder = await createPaidOrder(owner.id, duplicateB.id, {
    customerEmail: duplicateB.email,
    status: "canceled"
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: duplicateB.id,
      orderId: canceledOrder.id,
      points: 25,
      type: "earn",
      reason: "Purchase",
      status: "available",
      idempotencyKey: `reward:${unique("canceled")}`,
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: duplicateB.id,
      points: -5,
      type: "reverse",
      reason: "Missing original",
      status: "reversed",
      idempotencyKey: `reward:${unique("missing-original")}`,
      source: "admin_adjustment",
      reversalOfEntryId: "missing-original-entry"
    }
  });
  const refundedSale = await createPosSale(owner.id, duplicateB.id, {
    saleReference: "POS-PRIVATE-REFERENCE",
    refundStatus: "refunded",
    refundedAmount: 20
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: duplicateB.id,
      points: 20,
      type: "earn",
      reason: "POS purchase",
      status: "available",
      idempotencyKey: `rewards:pos:earn:${refundedSale.saleReference}`,
      source: "pos"
    }
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const payload = JSON.stringify(report);

  assert.equal(report.overallClassification, "BLOCKED");
  assert.equal(report.sections.customerAccountIntegrity.classification, "BLOCKED");
  assert.ok(report.sections.customerAccountIntegrity.reasons.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
  assert.ok(report.sections.customerAccountIntegrity.reasons.includes("NEGATIVE_REWARD_BALANCE_FIELD"));
  assert.ok(report.sections.rewardLedgerIntegrity.reasons.includes("REWARD_REVERSAL_MISSING_ORIGINAL_ENTRY"));
  assert.ok(report.sections.onlineOrderRewards.reasons.includes("CANCELED_ORDER_WITH_UNREVERSED_REWARDS"));
  assert.ok(report.sections.posRewards.reasons.includes("REFUNDED_POS_SALE_WITH_UNREVERSED_REWARDS"));
  assert.ok(!payload.includes("duplicate@example.test"));
  assert.ok(!payload.includes("POS-PRIVATE-REFERENCE"));
  assert.ok(!payload.includes(canceledOrder.orderNumber));
});

test("guest paid orders remain warnings rather than corruption", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  await createPaidOrder(owner.id, null, {
    customerEmail: "guest.checkout@example.test",
    customerName: "Guest Checkout"
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerLinking.classification, "WARNING");
  assert.ok(report.sections.customerLinking.reasons.includes("UNLINKED_HISTORICAL_PAID_ORDERS"));
  assert.notEqual(report.overallClassification, "BLOCKED");
});

test("elapsed pending rewards warn when no scheduled elapsed-release path exists", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  await setBalance(customer.id, 0, 10, 10);
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 10,
      type: "earn",
      reason: "Purchase",
      status: "pending",
      availableAt: new Date("2020-01-01T00:00:00.000Z"),
      idempotencyKey: `reward:${unique("elapsed")}`,
      source: "stripe_checkout"
    }
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.pendingReleaseReadiness.classification, "WARNING");
  assert.ok(report.sections.pendingReleaseReadiness.reasons.includes("ELAPSED_PENDING_REWARDS_WITHOUT_AUTOMATIC_RELEASE_PATH"));
  assert.equal(report.sections.pendingReleaseReadiness.metrics.activeScheduledDelayElapsedReleaseExists, false);
  assert.equal(report.sections.pendingReleaseReadiness.metrics.releaseCurrentlyFulfillmentTriggeredOnly, true);
});

test("enabled customer or reward runtime flags block production readiness", async () => {
  const owner = await createOwner();
  process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
  process.env.CUSTOMER_REWARDS_ENABLED = "true";
  process.env.CUSTOMER_POS_REWARDS_ENABLED = "true";
  process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "true";
  process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "true";

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.runtimeConfiguration.classification, "BLOCKED");
  assert.ok(report.sections.runtimeConfiguration.reasons.includes("CUSTOMER_ACCOUNTS_ENABLED_TRUE_DURING_DISABLED_AUDIT"));
  assert.ok(report.sections.runtimeConfiguration.reasons.includes("CUSTOMER_REWARD_REDEMPTION_ENABLED_TRUE_DURING_DISABLED_AUDIT"));
  disabledRewardEnv();
});

test("report applies bounded scans and returns unavailable instead of an unbounded result", async () => {
  disabledRewardEnv();
  const owner = await createOwner();
  await prisma.customerAccount.createMany({
    data: Array.from({ length: 1_001 }, (_, index) => ({
      userId: owner.id,
      email: `${unique("bounded")}-${index}@example.test`,
      normalizedEmail: `${unique("bounded-normalized")}-${index}@example.test`,
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }))
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerAccountIntegrity.classification, "UNAVAILABLE");
  assert.ok(report.sections.customerAccountIntegrity.reasons.includes("REPORT_LIMIT_REACHED"));
});

test("route and UI are admin-only, no-store, GET-only, and mutation-free", () => {
  const routeSource = readFileSync(path.join(projectRoot, "src/app/api/radar/customer-reward-integrity/route.ts"), "utf8");
  const serviceSource = readFileSync(path.join(projectRoot, "src/lib/customer-reward-integrity.ts"), "utf8");
  const uiSource = readFileSync(path.join(projectRoot, "src/components/RadarApp.tsx"), "utf8");

  assert.match(routeSource, /requireUser/);
  assert.match(routeSource, /requireAdmin/);
  assert.match(routeSource, /privateOk/);
  assert.match(routeSource, /safeApiError/);
  assert.match(routeSource, /export async function GET/);
  assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(serviceSource, /\bprisma\.[a-zA-Z]+?\.(create|update|upsert|delete|deleteMany|updateMany)\s*\(/);
  assert.match(serviceSource, /findMany\(\{[\s\S]*take: boundedAccountLimit \+ 1/);
  assert.match(uiSource, /Customer &amp; Reward Integrity/);
  assert.match(uiSource, /This report is read-only and does not modify customer accounts, rewards, orders, or balances\./);
  assert.doesNotMatch(uiSource, /Reconcile rewards|Fix rewards|Repair customer|Adjust points/);
});
