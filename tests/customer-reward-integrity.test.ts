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
process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
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

function approvedRuntimeEnv() {
  process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
  process.env.CUSTOMER_REWARDS_ENABLED = "false";
  process.env.CUSTOMER_POS_REWARDS_ENABLED = "false";
  process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
  process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";
}

function setTestEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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
  platform: string;
  rewardsEligible: boolean;
  grossSale: number;
  subtotalCents: number | null;
  soldAt: Date;
}> = {}) {
  const item = await createInventoryItem(userId);
  const saleReference = Object.prototype.hasOwnProperty.call(overrides, "saleReference") ? overrides.saleReference ?? null : unique("POS");
  return prisma.inventorySale.create({
    data: {
      userId,
      inventoryItemId: item.id,
      customerAccountId,
      customerEmail: overrides.customerEmail ?? null,
      saleReference,
      quantitySold: 1,
      soldPricePerItem: 20,
      grossSale: overrides.grossSale ?? 20,
      platform: overrides.platform ?? "pos",
      netSale: 20,
      costBasis: 10,
      profitLoss: 10,
      subtotalCents: overrides.subtotalCents,
      refundStatus: overrides.refundStatus ?? null,
      refundedAmount: overrides.refundedAmount ?? 0,
      rewardsEligible: overrides.rewardsEligible ?? true,
      soldAt: overrides.soldAt ?? new Date("2026-01-02T00:00:00.000Z")
    }
  });
}

test("empty customer and reward report is aggregate, read-only, and passable with approved runtime flags", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.readOnly, true);
  assert.equal(report.overallClassification, "PASS");
  assert.equal(report.sections.runtimeConfiguration.classification, "PASS");
  assert.equal(report.sections.runtimeConfiguration.metrics.customerAccountsEnabled, true);
  assert.equal(report.sections.runtimeConfiguration.metrics.customerAccountsExpectedEnabled, true);
  assert.equal(report.sections.runtimeConfiguration.metrics.rewardEarningExpectedEnabled, false);
  assert.equal(report.sections.customerAccountIntegrity.metrics.totalCustomerAccounts, 0);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.allRewardLedgerEntries, 0);
});

test("balanced accounts reconcile using existing ledger math without exposing identifiers", async () => {
  approvedRuntimeEnv();
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

test("authoritative reward lifecycle treats fully reversed canceled earns as valid", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 10,
      type: "earn",
      reason: "Pending purchase",
      status: "pending",
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 20,
      type: "earn",
      reason: "Available purchase",
      status: "available",
      source: "stripe_checkout"
    }
  });
  const canceledEarn = await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 30,
      type: "earn",
      reason: "Canceled purchase",
      status: "canceled",
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: -30,
      type: "reverse",
      reason: "Complete reversal",
      status: "reversed",
      source: "stripe_checkout",
      reversalOfEntryId: canceledEarn.id,
      metadataJson: JSON.stringify({ availablePointsReversed: 30 })
    }
  });
  await setBalance(customer.id, 20, 10, 60);

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.rewardLedgerIntegrity.classification, "PASS");
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.positiveEarnPending, 1);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.positiveEarnAvailable, 1);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.positiveEarnCanceledWithSupportedReversal, 1);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.positiveEarnCanceledWithoutReversal, 0);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.negativeReverseReversed, 1);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.ledgerEntriesWithInvalidStatusTypeCombinations, 0);
  assert.equal(report.sections.rewardBalanceReconciliation.classification, "PASS");
});

test("unsupported reward lifecycle combinations and invalid reversal relationships are blocked", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customerA = await createCustomer(owner.id);
  const customerB = await createCustomer(owner.id);
  const orderA = await createPaidOrder(owner.id, customerA.id, { customerEmail: customerA.email });
  const orderB = await createPaidOrder(owner.id, customerA.id, { customerEmail: customerA.email });
  const smallEarn = await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customerA.id,
      points: 5,
      type: "earn",
      reason: "Original",
      status: "available",
      source: "stripe_checkout"
    }
  });
  const accountMismatchEarn = await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customerA.id,
      points: 20,
      type: "earn",
      reason: "Original account",
      status: "available",
      source: "stripe_checkout"
    }
  });
  const transactionMismatchEarn = await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customerA.id,
      orderId: orderA.id,
      points: 20,
      type: "earn",
      reason: "Original order",
      status: "available",
      source: "stripe_checkout"
    }
  });

  await prisma.rewardLedgerEntry.createMany({
    data: [
      { customerAccountId: customerA.id, points: 5, type: "reverse", reason: "Bad positive reverse", status: "reversed", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: -5, type: "earn", reason: "Bad negative earn", status: "reversed", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: -5, type: "reverse", reason: "Bad pending reverse", status: "pending", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: -5, type: "reverse", reason: "Bad available reverse", status: "available", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: 5, type: "earn", reason: "Bad reversed earn", status: "reversed", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: 5, type: "earn", reason: "Unsupported cancel", status: "canceled", source: "stripe_checkout" },
      { customerAccountId: customerA.id, points: -6, type: "reverse", reason: "Excessive reversal", status: "reversed", source: "stripe_checkout", reversalOfEntryId: smallEarn.id },
      { customerAccountId: customerB.id, points: -5, type: "reverse", reason: "Wrong account", status: "reversed", source: "stripe_checkout", reversalOfEntryId: accountMismatchEarn.id },
      { customerAccountId: customerA.id, orderId: orderB.id, points: -5, type: "reverse", reason: "Wrong order", status: "reversed", source: "stripe_checkout", reversalOfEntryId: transactionMismatchEarn.id },
      { customerAccountId: customerA.id, points: -5, type: "reverse", reason: "Missing original", status: "reversed", source: "pos" }
    ]
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const ledger = report.sections.rewardLedgerIntegrity;

  assert.equal(ledger.classification, "BLOCKED");
  assert.ok(ledger.reasons.includes("INVALID_REWARD_LEDGER_STATUS_TYPE"));
  assert.ok(ledger.reasons.includes("CURRENT_REVERSAL_MISSING_ORIGINAL_REFERENCE"));
  assert.ok(ledger.reasons.includes("REVERSAL_EXCEEDS_EARNED_POINTS"));
  assert.ok(ledger.reasons.includes("REVERSAL_ACCOUNT_MISMATCH"));
  assert.ok(ledger.reasons.includes("REVERSAL_TRANSACTION_MISMATCH"));
  assert.equal(ledger.metrics.invalidPositiveReverse, 1);
  assert.equal(ledger.metrics.invalidNegativeEarn, 1);
  assert.equal(ledger.metrics.invalidNegativePending, 1);
  assert.equal(ledger.metrics.invalidNegativeAvailable, 1);
  assert.equal(ledger.metrics.positiveEarnReversed, 1);
  assert.equal(ledger.metrics.positiveEarnCanceledWithoutReversal, 1);
  assert.equal(ledger.metrics.currentSystemReversalMissingOriginalReference, 1);
  assert.equal(ledger.metrics.reversalExceedsOriginalPoints, 1);
  assert.equal(ledger.metrics.reversalAccountMismatch, 1);
  assert.equal(ledger.metrics.reversalTransactionMismatch, 1);
});

test("legacy administrative reversal without original reference is a warning when balances reconcile", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 100,
      type: "earn",
      reason: "Historical earn",
      status: "available",
      source: "stripe_checkout"
    }
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: -5,
      type: "reverse",
      reason: "Legacy reversal",
      status: "reversed",
      source: "admin_adjustment"
    }
  });
  await setBalance(customer.id, 95, 0, 100);

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.rewardLedgerIntegrity.classification, "WARNING");
  assert.ok(report.sections.rewardLedgerIntegrity.reasons.includes("LEGACY_REVERSAL_WITHOUT_ORIGINAL_REFERENCE"));
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.legacyAdministrativeReversal, 1);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.currentSystemReversalMissingOriginalReference, 0);
  assert.equal(report.sections.rewardBalanceReconciliation.classification, "PASS");
});

test("clean three-account dataset reports active verified aggregate counts", async () => {
  approvedRuntimeEnv();
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
  approvedRuntimeEnv();
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
  approvedRuntimeEnv();
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
  approvedRuntimeEnv();
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
  approvedRuntimeEnv();
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

test("runtime policy blocks disabled accounts and each enabled reward capability independently", async () => {
  const owner = await createOwner();

  const cases: Array<[string, string, string]> = [
    ["CUSTOMER_ACCOUNTS_ENABLED", "false", "CUSTOMER_ACCOUNTS_DISABLED_WHILE_ACCOUNT_ACCESS_EXPECTED"],
    ["CUSTOMER_REWARDS_ENABLED", "true", "CUSTOMER_REWARDS_ENABLED_BEFORE_CERTIFICATION"],
    ["CUSTOMER_POS_REWARDS_ENABLED", "true", "CUSTOMER_POS_REWARDS_ENABLED_BEFORE_CERTIFICATION"],
    ["CUSTOMER_REWARD_REDEMPTION_ENABLED", "true", "CUSTOMER_REWARD_REDEMPTION_ENABLED_WITHOUT_APPROVAL"],
    ["CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED", "true", "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED_WITHOUT_APPROVAL"]
  ];

  for (const [flag, value, reason] of cases) {
    approvedRuntimeEnv();
    process.env[flag] = value;
    const report = await buildCustomerRewardIntegrityReport(owner.id);
    assert.equal(report.sections.runtimeConfiguration.classification, "BLOCKED", flag);
    assert.ok(report.sections.runtimeConfiguration.reasons.includes(reason), flag);
  }

  approvedRuntimeEnv();
});

test("environment labeling uses Vercel target instead of NODE_ENV", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousNodeEnv = process.env.NODE_ENV;

  setTestEnv("VERCEL_ENV", "production");
  setTestEnv("NODE_ENV", "test");
  let report = await buildCustomerRewardIntegrityReport(owner.id);
  assert.equal(report.environment, "production");
  assert.equal(report.deploymentTarget, "production");
  assert.equal(report.sections.runtimeConfiguration.metrics.deploymentTarget, "production");

  setTestEnv("VERCEL_ENV", "preview");
  setTestEnv("NODE_ENV", "production");
  report = await buildCustomerRewardIntegrityReport(owner.id);
  assert.equal(report.environment, "non_production");
  assert.equal(report.deploymentTarget, "preview");

  setTestEnv("VERCEL_ENV", undefined);
  setTestEnv("NODE_ENV", "production");
  report = await buildCustomerRewardIntegrityReport(owner.id);
  assert.equal(report.environment, "non_production");
  assert.equal(report.deploymentTarget, "unknown");

  if (previousVercelEnv === undefined) {
    setTestEnv("VERCEL_ENV", undefined);
  } else {
    setTestEnv("VERCEL_ENV", previousVercelEnv);
  }
  if (previousNodeEnv === undefined) {
    setTestEnv("NODE_ENV", undefined);
  } else {
    setTestEnv("NODE_ENV", previousNodeEnv);
  }
});

test("POS diagnostics count distinct canonical POS transactions and exclude non-POS sales", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  await setBalance(customer.id, 0, 0, 0);

  await createPosSale(owner.id, customer.id, { saleReference: "POS-ONE", customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { saleReference: "POS-MULTI", customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { saleReference: "POS-MULTI", customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { saleReference: "POS-MULTI", customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { saleReference: "POS-TWO", customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { saleReference: "WEB-IGNORED", customerEmail: customer.email, platform: "website" });
  await createPosSale(owner.id, customer.id, { saleReference: "LOCAL-IGNORED", customerEmail: customer.email, platform: "local" });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerLinking.metrics.posSaleLineRecordsEvaluated, 5);
  assert.equal(report.sections.customerLinking.metrics.posSalesTotal, 3);
  assert.equal(report.sections.customerLinking.metrics.posSalesLinkedToCustomerAccount, 3);
  assert.equal(report.sections.customerLinking.metrics.posPlatformFilter, "pos");
  assert.equal(report.sections.posRewards.metrics.posSaleLineRecordsEvaluated, 5);
  assert.equal(report.sections.posRewards.metrics.posSaleTransactionsEvaluated, 3);
});

test("POS transaction anomalies are aggregated once per sale reference without exposing references", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customerA = await createCustomer(owner.id);
  const customerB = await createCustomer(owner.id);

  await createPosSale(owner.id, customerA.id, {
    saleReference: "POS-CONFLICT",
    customerEmail: customerA.email,
    refundStatus: "refunded",
    refundedAmount: 20
  });
  await createPosSale(owner.id, customerB.id, {
    saleReference: "POS-CONFLICT",
    customerEmail: customerB.email,
    refundStatus: null,
    refundedAmount: 0
  });
  await createPosSale(owner.id, null, { saleReference: null, customerEmail: null });

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const payload = JSON.stringify(report);

  assert.equal(report.sections.customerLinking.metrics.posSaleTransactionsWithConflictingCustomerLinks, 1);
  assert.equal(report.sections.customerLinking.metrics.posSaleTransactionsWithIncompatibleRefundState, 1);
  assert.equal(report.sections.customerLinking.metrics.posSaleLineRecordsMissingSaleReference, 1);
  assert.ok(report.sections.customerLinking.reasons.includes("POS_TRANSACTION_CONFLICTING_CUSTOMER_LINKS"));
  assert.ok(report.sections.posRewards.reasons.includes("POS_TRANSACTION_INCOMPATIBLE_REFUND_STATE"));
  assert.ok(report.sections.posRewards.reasons.includes("POS_TRANSACTION_GROUPING_UNAVAILABLE_FOR_MISSING_REFERENCE"));
  assert.ok(!payload.includes("POS-CONFLICT"));
});

test("refunded multi-line POS sale produces one unreversed reward finding", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  const saleReference = "POS-REFUNDED-MULTI";
  await createPosSale(owner.id, customer.id, { saleReference, customerEmail: customer.email, refundStatus: "refunded", refundedAmount: 20 });
  await createPosSale(owner.id, customer.id, { saleReference, customerEmail: customer.email, refundStatus: "refunded", refundedAmount: 20 });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: customer.id,
      points: 40,
      type: "earn",
      reason: "POS purchase",
      status: "available",
      idempotencyKey: `rewards:pos:earn:${saleReference}`,
      source: "pos"
    }
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.posRewards.metrics.refundedSalesWithUnreversedPoints, 1);
  assert.ok(report.sections.posRewards.reasons.includes("REFUNDED_POS_SALE_WITH_UNREVERSED_REWARDS"));
  assert.ok(!JSON.stringify(report).includes(saleReference));
});

test("identity comparisons use the authoritative account email normalizer", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id, {
    email: "collector.normalizer@example.test",
    normalizedEmail: "collector.normalizer@example.test"
  });
  await createPaidOrder(owner.id, customer.id, { customerEmail: " Collector.Normalizer@Example.TEST " });
  await createPosSale(owner.id, customer.id, { customerEmail: " Collector.Normalizer@Example.TEST " });
  await createPaidOrder(owner.id, customer.id, { customerEmail: "not-an-email" });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.customerLinking.metrics.paidOrdersWithEmailMismatch, 0);
  assert.equal(report.sections.customerLinking.metrics.posSalesWithEmailMismatch, 0);
});

test("account warning breakdown exposes aggregate context only", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id, { normalizedEmail: null });
  await prisma.storefrontCustomer.create({
    data: {
      userId: owner.id,
      customerAccountId: customer.id,
      email: `${unique("storefront-link")}@example.test`
    }
  });
  await createPaidOrder(owner.id, customer.id, { customerEmail: customer.email });
  await createPosSale(owner.id, customer.id, { customerEmail: customer.email });

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const metrics = report.sections.customerAccountIntegrity.metrics;
  const payload = JSON.stringify(report);

  assert.equal(report.sections.customerAccountIntegrity.classification, "WARNING");
  assert.equal(metrics.accountsMissingNormalizedEmail, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailVerified, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailActive, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailWithoutRewardBalance, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailWithoutLedgerEntries, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailLinkedStorefrontCustomer, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailLinkedPaidOrder, 1);
  assert.equal(metrics.accountsMissingNormalizedEmailLinkedPosTransaction, 1);
  assert.equal(metrics.accountsWithoutRewardBalance, 1);
  assert.equal(metrics.accountsWithoutRewardBalanceWithoutLedgerEntries, 1);
  assert.equal(metrics.accountsWithoutRewardBalanceWithOnlyZeroOrNoRewardHistory, 1);
  assert.equal(metrics.accountsWithoutRewardBalanceVerified, 1);
  assert.equal(metrics.accountsWithoutRewardBalanceActive, 1);
  assert.equal(metrics.accountsWithoutRewardBalanceNormalizedEmailMissing, 1);
  assert.ok(!payload.includes(customer.id));
  assert.ok(!payload.includes(customer.email));
});

test("POS missing-earn breakdown distinguishes ineligible historical unknown and actionable cases", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const verifiedCustomer = await createCustomer(owner.id);
  const unverifiedCustomer = await createCustomer(owner.id, { emailVerifiedAt: null });
  await setBalance(verifiedCustomer.id, 10, 0, 10);
  await setBalance(unverifiedCustomer.id, 0, 0, 0);
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: verifiedCustomer.id,
      points: 10,
      type: "earn",
      reason: "First POS earn",
      status: "available",
      source: "pos",
      idempotencyKey: "rewards:pos:earn:POS-FIRST",
      createdAt: new Date("2026-01-10T00:00:00.000Z")
    }
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-FIRST",
    customerEmail: verifiedCustomer.email,
    soldAt: new Date("2026-01-10T00:00:00.000Z")
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-HISTORICAL",
    customerEmail: verifiedCustomer.email,
    soldAt: new Date("2026-01-01T00:00:00.000Z")
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-INELIGIBLE",
    customerEmail: verifiedCustomer.email,
    rewardsEligible: false,
    soldAt: new Date("2026-01-20T00:00:00.000Z")
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-ZERO",
    customerEmail: verifiedCustomer.email,
    subtotalCents: 0,
    grossSale: 0,
    soldAt: new Date("2026-01-21T00:00:00.000Z")
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-REFUND",
    customerEmail: verifiedCustomer.email,
    refundStatus: "refunded",
    refundedAmount: 20,
    soldAt: new Date("2026-01-22T00:00:00.000Z")
  });
  await createPosSale(owner.id, unverifiedCustomer.id, {
    saleReference: "POS-UNVERIFIED",
    customerEmail: unverifiedCustomer.email,
    soldAt: new Date("2026-01-23T00:00:00.000Z")
  });
  await createPosSale(owner.id, verifiedCustomer.id, {
    saleReference: "POS-ACTIONABLE",
    customerEmail: verifiedCustomer.email,
    soldAt: new Date("2026-01-24T00:00:00.000Z")
  });

  const report = await buildCustomerRewardIntegrityReport(owner.id);
  const metrics = report.sections.posRewards.metrics;
  const payload = JSON.stringify(report);

  assert.equal(report.sections.posRewards.classification, "BLOCKED");
  assert.ok(report.sections.posRewards.reasons.includes("CURRENT_POS_REWARD_EARN_MISSING"));
  assert.ok(report.sections.posRewards.reasons.includes("LINKED_POS_SALE_WITHOUT_EARN_ENTRY"));
  assert.equal(metrics.completedEligibleSalesWithEarnEntry, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnEntry, 6);
  assert.equal(metrics.linkedPosSalesWithoutEarnRewardsEligibleTrue, 5);
  assert.equal(metrics.linkedPosSalesWithoutEarnRewardsEligibleFalse, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnBeforeFirstPersistedPosEarn, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnAfterFirstPersistedPosEarn, 5);
  assert.equal(metrics.linkedPosSalesWithoutEarnLinkedAccountVerified, 5);
  assert.equal(metrics.linkedPosSalesWithoutEarnLinkedAccountUnverified, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnZeroEligibleMerchandiseSubtotal, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnPositiveEligibleMerchandiseSubtotal, 5);
  assert.equal(metrics.linkedPosSalesWithoutEarnWithRefundState, 1);
  assert.equal(metrics.linkedPosSalesWithoutEarnWithoutRefundState, 5);
  assert.equal(metrics.linkedPosSalesWithoutEarnActionableCurrentSystem, 1);
  assert.equal(metrics.firstPersistedPosEarnEntryKnown, true);
  assert.ok(!payload.includes("POS-ACTIONABLE"));
  assert.ok(!payload.includes(verifiedCustomer.email));
});

test("schema-enforced integrity checks are not falsely reported as verified zeroes", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.rewardLedgerIntegrity.metrics.entriesWithMissingCustomerAccount, null);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.entriesWithMissingCustomerAccountSchemaEnforced, true);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.orderLinkedEntriesWithMissingStorefrontOrder, null);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.orderLinkedEntriesWithMissingStorefrontOrderSchemaEnforced, true);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.balancesWithoutAccounts, null);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.balancesWithoutAccountsSchemaEnforced, true);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.accountsWithMultipleBalanceRecords, null);
  assert.equal(report.sections.rewardBalanceReconciliation.metrics.accountsWithMultipleBalanceRecordsSchemaEnforced, true);
});

test("report applies bounded scans and returns unavailable instead of an unbounded result", async () => {
  approvedRuntimeEnv();
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
  assert.equal(report.sections.customerAccountIntegrity.metrics.boundedAccountLimit, 1_000);
  assert.equal(report.sections.customerAccountIntegrity.metrics.boundedSamplePartial, true);
});

test("bounded ledger relationship checks are unavailable rather than falsely blocked", async () => {
  approvedRuntimeEnv();
  const owner = await createOwner();
  const customer = await createCustomer(owner.id);
  const entries = [
    {
      customerAccountId: customer.id,
      points: -5,
      type: "reverse",
      reason: "Potential missing original",
      status: "reversed",
      source: "stripe_checkout",
      reversalOfEntryId: "outside-bounded-scan"
    },
    ...Array.from({ length: 10_000 }, () => ({
      customerAccountId: customer.id,
      points: 1,
      type: "earn",
      reason: "Bounded scan fixture",
      status: "available",
      source: "stripe_checkout"
    }))
  ];
  await prisma.rewardLedgerEntry.createMany({ data: entries });

  const report = await buildCustomerRewardIntegrityReport(owner.id);

  assert.equal(report.sections.rewardLedgerIntegrity.classification, "UNAVAILABLE");
  assert.ok(report.sections.rewardLedgerIntegrity.reasons.includes("REPORT_LIMIT_REACHED"));
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.boundedSamplePartial, true);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.reversalEntriesWithMissingOriginalEntry, null);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.reversalRelationshipVerificationAvailable, false);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.reversalExceedsOriginalPoints, null);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.reversalAccountMismatch, null);
  assert.equal(report.sections.rewardLedgerIntegrity.metrics.reversalTransactionMismatch, null);
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
  assert.match(serviceSource, /import \{ normalizeCustomerAccountEmail \} from "@\/lib\/customer-account-auth"/);
  assert.doesNotMatch(serviceSource, /function normalizedEmail/);
  assert.match(serviceSource, /findMany\(\{[\s\S]*take: boundedAccountLimit \+ 1/);
  assert.match(serviceSource, /env\.VERCEL_ENV === "production" \? "production" : "non_production"/);
  assert.match(uiSource, /Customer &amp; Reward Integrity/);
  assert.match(
    uiSource,
    /Customer accounts are expected to be available\. Reward earning, POS rewards, redemption, and administrative adjustments are[\s\S]*expected to remain disabled until separately certified\./
  );
  assert.match(uiSource, /This report is read-only and does not modify customer accounts, rewards, orders, or balances\./);
  assert.doesNotMatch(uiSource, /Reconcile rewards|Fix rewards|Repair customer|Adjust points/);
});
