import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/types/radar";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-customer-account-hygiene-"));
const testDbPath = path.join(testDbDir, "customer-account-hygiene.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
process.env.CUSTOMER_REWARDS_ENABLED = "false";
process.env.CUSTOMER_POS_REWARDS_ENABLED = "false";
process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";
delete process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED;

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const hygieneModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-account-hygiene-repair.ts")).href);
const authModuleSource = readFileSync(path.join(projectRoot, "src/lib/customer-account-auth.ts"), "utf8");
const serviceSource = readFileSync(path.join(projectRoot, "src/lib/customer-account-hygiene-repair.ts"), "utf8");
const routeSource = readFileSync(path.join(projectRoot, "src/app/api/radar/customer-account-hygiene-repair/route.ts"), "utf8");
const { prisma } = dbModule as { prisma: PrismaClient };
const {
  customerAccountHygieneRepairConfirmation,
  customerAccountHygieneRepairEnabled,
  customerAccountHygieneRepairOperation,
  dryRunCustomerAccountHygieneRepair,
  executeCustomerAccountHygieneRepair
} = hygieneModule as typeof import("../src/lib/customer-account-hygiene-repair");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;
function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

async function createOwner() {
  return prisma.user.create({
    data: {
      email: `${unique("owner")}@example.test`,
      name: "Repair Admin",
      role: "ADMIN",
      passwordHash: "hash"
    }
  });
}

function sessionUser(owner: { id: string; email: string; name: string | null }): SessionUser {
  return {
    id: owner.id,
    email: owner.email,
    name: owner.name ?? "Repair Admin",
    role: "ADMIN",
    sessionVersion: 1,
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
}

async function createCandidate(userId: string, overrides: Partial<{
  email: string;
  normalizedEmail: string | null;
  status: string;
  emailVerifiedAt: Date | null;
}> = {}) {
  const email = overrides.email ?? `${unique("collector")}+Alias@Example.TEST`;
  return prisma.customerAccount.create({
    data: {
      userId,
      email,
      normalizedEmail: Object.prototype.hasOwnProperty.call(overrides, "normalizedEmail") ? overrides.normalizedEmail ?? null : null,
      status: overrides.status ?? "active",
      emailVerifiedAt: Object.prototype.hasOwnProperty.call(overrides, "emailVerifiedAt")
        ? overrides.emailVerifiedAt ?? null
        : new Date("2026-01-01T00:00:00.000Z")
    }
  });
}

async function createInventoryItem(userId: string) {
  return prisma.inventoryItem.create({
    data: {
      userId,
      itemType: "product",
      itemName: unique("Repair fixture item"),
      category: "sealed_packs",
      cost: 10,
      quantity: 1,
      source: "Repair test",
      purchasedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
}

async function createPaidOrder(userId: string, customerAccountId: string) {
  return prisma.storefrontOrder.create({
    data: {
      userId,
      customerAccountId,
      orderNumber: unique("REPAIR-ORDER"),
      status: "paid",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      subtotal: 10,
      total: 10
    }
  });
}

async function createPosSale(userId: string, customerAccountId: string) {
  const item = await createInventoryItem(userId);
  return prisma.inventorySale.create({
    data: {
      userId,
      inventoryItemId: item.id,
      customerAccountId,
      quantitySold: 1,
      soldPricePerItem: 20,
      grossSale: 20,
      platform: "pos",
      netSale: 20,
      costBasis: 10,
      profitLoss: 10,
      saleReference: unique("POS-REPAIR"),
      soldAt: new Date("2026-01-02T00:00:00.000Z")
    }
  });
}

function serialized(value: unknown) {
  return JSON.stringify(value);
}

test("repair guard defaults disabled and accepts only literal true", () => {
  for (const value of [undefined, "", "TRUE", " true ", "1", "false"]) {
    const env = value === undefined ? {} : { CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED: value };
    assert.equal(customerAccountHygieneRepairEnabled(env), false);
  }
  assert.equal(customerAccountHygieneRepairEnabled({ CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED: "true" }), true);
});

test("route is administrator-only, private, noindex, and keeps POST behind the dedicated guard", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.match(routeSource, /requireUser\(\)/);
  assert.match(routeSource, /requireAdmin\(user\)/);
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.match(routeSource, /authorizeAdminMutation\(request, user\)/);
  assert.match(routeSource, /customerAccountHygieneRepairEnabled\(\)/);
  assert.doesNotMatch(routeSource, /CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED/);
  assert.match(routeSource, /customerAccountHygieneRepairSecurityHeaders/);
  assert.match(serviceSource, /X-Robots-Tag/);
  assert.match(serviceSource, /noindex, nofollow/);
  assert.match(serviceSource, /X-Content-Type-Options/);
  assert.match(serviceSource, /nosniff/);
});

test("dry run with no candidate is aggregate-only and performs no repair", async () => {
  const owner = await createOwner();
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.readOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.classification, "NO_ELIGIBLE_CANDIDATE");
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.reasonCodes, ["NO_ELIGIBLE_CANDIDATE"]);
});

test("exactly one active verified zero-history account is ready for deterministic repair", async () => {
  const owner = await createOwner();
  const customer = await createCandidate(owner.id, { email: `${unique("Ready.User")}@Example.TEST` });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "READY_FOR_DETERMINISTIC_REPAIR");
  assert.equal(result.candidateCount, 1);
  assert.equal(result.activeCandidateCount, 1);
  assert.equal(result.verifiedCandidateCount, 1);
  assert.equal(result.candidateWithoutBalanceCount, 1);
  assert.equal(result.candidateWithoutLedgerCount, 1);
  assert.equal(result.candidateWithoutPositiveHistoryCount, 1);
  assert.equal(result.candidateWithoutStorefrontLinkCount, 1);
  assert.equal(result.candidateWithoutPaidOrderLinkCount, 1);
  assert.equal(result.candidateWithoutPosLinkCount, 1);
  assert.equal(result.validNormalizedEmailCount, 1);
  assert.equal(result.uniqueNormalizedIdentityCount, 1);
  assert.equal(result.expectedAvailablePoints, 0);
  assert.equal(result.expectedPendingPoints, 0);
  assert.equal(result.expectedLifetimeEarnedPoints, 0);
  assert.doesNotMatch(serialized(result), new RegExp(customer.id));
  assert.doesNotMatch(serialized(result), /Ready\.User|example\.test/i);
});

test("multiple eligible accounts are blocked", async () => {
  const owner = await createOwner();
  await createCandidate(owner.id);
  await createCandidate(owner.id);
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "MULTIPLE_ELIGIBLE_CANDIDATES");
  assert.equal(result.candidateCount, 2);
  assert.deepEqual(result.reasonCodes, ["MULTIPLE_ELIGIBLE_CANDIDATES"]);
});

test("inactive and unverified accounts are rejected before eligibility", async () => {
  const inactiveOwner = await createOwner();
  await createCandidate(inactiveOwner.id, { status: "disabled" });
  assert.equal((await dryRunCustomerAccountHygieneRepair(inactiveOwner.id)).classification, "NO_ELIGIBLE_CANDIDATE");

  const unverifiedOwner = await createOwner();
  await createCandidate(unverifiedOwner.id, { emailVerifiedAt: null });
  assert.equal((await dryRunCustomerAccountHygieneRepair(unverifiedOwner.id)).classification, "NO_ELIGIBLE_CANDIDATE");
});

test("invalid email and already normalized accounts are rejected", async () => {
  const invalidOwner = await createOwner();
  await createCandidate(invalidOwner.id, { email: "not-an-email" });
  const invalid = await dryRunCustomerAccountHygieneRepair(invalidOwner.id);
  assert.equal(invalid.classification, "BLOCKED");
  assert.ok(invalid.reasonCodes.includes("INVALID_NORMALIZED_EMAIL"));

  const normalizedOwner = await createOwner();
  await createCandidate(normalizedOwner.id, { normalizedEmail: "already@example.test" });
  assert.equal((await dryRunCustomerAccountHygieneRepair(normalizedOwner.id)).classification, "NO_ELIGIBLE_CANDIDATE");
});

test("reward balance, ledger history, and positive reward history block eligibility", async () => {
  const balanceOwner = await createOwner();
  const balanceCustomer = await createCandidate(balanceOwner.id);
  await prisma.rewardBalance.create({ data: { customerAccountId: balanceCustomer.id, availablePoints: 0, pendingPoints: 0, lifetimeEarnedPoints: 0 } });
  const balance = await dryRunCustomerAccountHygieneRepair(balanceOwner.id);
  assert.equal(balance.classification, "BLOCKED");
  assert.ok(balance.reasonCodes.includes("REWARD_BALANCE_EXISTS"));

  const ledgerOwner = await createOwner();
  const ledgerCustomer = await createCandidate(ledgerOwner.id);
  await prisma.rewardLedgerEntry.create({ data: { customerAccountId: ledgerCustomer.id, points: 0, type: "adjustment", reason: "fixture" } });
  const ledger = await dryRunCustomerAccountHygieneRepair(ledgerOwner.id);
  assert.equal(ledger.classification, "BLOCKED");
  assert.ok(ledger.reasonCodes.includes("REWARD_LEDGER_HISTORY_EXISTS"));

  const positiveOwner = await createOwner();
  const positiveCustomer = await createCandidate(positiveOwner.id);
  await prisma.rewardLedgerEntry.create({ data: { customerAccountId: positiveCustomer.id, points: 5, type: "earn", reason: "fixture" } });
  const positive = await dryRunCustomerAccountHygieneRepair(positiveOwner.id);
  assert.equal(positive.classification, "BLOCKED");
  assert.ok(positive.reasonCodes.includes("POSITIVE_REWARD_HISTORY_EXISTS"));
});

test("storefront, paid order, and POS links block eligibility without being repaired", async () => {
  const storefrontOwner = await createOwner();
  const storefrontCustomer = await createCandidate(storefrontOwner.id);
  await prisma.storefrontCustomer.create({
    data: { userId: storefrontOwner.id, customerAccountId: storefrontCustomer.id, email: `${unique("storefront")}@example.test` }
  });
  assert.ok((await dryRunCustomerAccountHygieneRepair(storefrontOwner.id)).reasonCodes.includes("STOREFRONT_CUSTOMER_LINK_EXISTS"));

  const orderOwner = await createOwner();
  const orderCustomer = await createCandidate(orderOwner.id);
  await createPaidOrder(orderOwner.id, orderCustomer.id);
  assert.ok((await dryRunCustomerAccountHygieneRepair(orderOwner.id)).reasonCodes.includes("PAID_ORDER_LINK_EXISTS"));

  const posOwner = await createOwner();
  const posCustomer = await createCandidate(posOwner.id);
  await createPosSale(posOwner.id, posCustomer.id);
  assert.ok((await dryRunCustomerAccountHygieneRepair(posOwner.id)).reasonCodes.includes("POS_TRANSACTION_LINK_EXISTS"));
});

test("duplicate normalized identity blocks eligibility using normalizedEmail or lower trimmed email", async () => {
  const owner = await createOwner();
  await createCandidate(owner.id, { email: "Duplicate.Identity@example.test" });
  await prisma.customerAccount.create({
    data: {
      userId: owner.id,
      email: "other-duplicate@example.test",
      normalizedEmail: "duplicate.identity@example.test",
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "BLOCKED");
  assert.ok(result.reasonCodes.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
});

test("candidate selection is workspace scoped", async () => {
  const owner = await createOwner();
  const otherOwner = await createOwner();
  await createCandidate(otherOwner.id);
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "NO_ELIGIBLE_CANDIDATE");
  assert.equal(result.candidateCount, 0);
});

test("successful repair normalizes email, creates zero balance, records non-PII audit, and creates no ledger", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id, { email: "Repair.Target+Alias@Example.TEST" });
  const result = await executeCustomerAccountHygieneRepair(sessionUser(owner));
  assert.deepEqual(result, {
    repaired: true,
    normalizedEmailUpdated: true,
    rewardBalanceCreated: true,
    auditRecorded: true,
    availablePoints: 0,
    pendingPoints: 0,
    lifetimeEarnedPoints: 0,
    remainingEligibleCandidateCount: 0
  });
  const account = await prisma.customerAccount.findUnique({ where: { id: customer.id } });
  assert.equal(account?.normalizedEmail, "repair.target+alias@example.test");
  const balance = await prisma.rewardBalance.findUnique({ where: { customerAccountId: customer.id } });
  assert.equal(balance?.availablePoints, 0);
  assert.equal(balance?.pendingPoints, 0);
  assert.equal(balance?.lifetimeEarnedPoints, 0);
  assert.equal(await prisma.rewardLedgerEntry.count({ where: { customerAccountId: customer.id } }), 0);
  assert.equal(await prisma.storefrontCustomer.count({ where: { customerAccountId: customer.id } }), 0);
  assert.equal(await prisma.storefrontOrder.count({ where: { customerAccountId: customer.id } }), 0);
  assert.equal(await prisma.inventorySale.count({ where: { customerAccountId: customer.id } }), 0);
  const audit = await prisma.auditLog.findFirst({ where: { action: "customer_account.hygiene_repair" }, orderBy: { createdAt: "desc" } });
  assert.ok(audit);
  assert.equal(audit?.entityType, "CustomerAccount");
  assert.equal(audit?.entityId, null);
  assert.equal(audit?.actorEmail, null);
  assert.match(audit?.summary ?? "", /zero-history customer account/);
  assert.doesNotMatch(`${audit?.metadata ?? ""}${audit?.summary ?? ""}`, /Repair\.Target|repair\.target|example\.test|@|customerAccountId/i);
  assert.doesNotMatch(serialized(result), /Repair\.Target|repair\.target|example\.test|@|c[a-z0-9]{20,}/i);
});

test("repeated POST after repair is a no-op and records no second audit", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  await createCandidate(owner.id);
  const user = sessionUser(owner);
  await executeCustomerAccountHygieneRepair(user);
  const auditsBefore = await prisma.auditLog.count({ where: { action: "customer_account.hygiene_repair", userId: owner.id } });
  const second = await executeCustomerAccountHygieneRepair(user);
  const auditsAfter = await prisma.auditLog.count({ where: { action: "customer_account.hygiene_repair", userId: owner.id } });
  assert.equal(second.repaired, false);
  assert.equal(second.classification, "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE");
  assert.equal(auditsAfter, auditsBefore);
});

test("confirmation contract is exact and rejects client-provided identity", () => {
  assert.match(routeSource, /z\.literal\(customerAccountHygieneRepairOperation\)/);
  assert.match(routeSource, /z\.literal\(1\)/);
  assert.match(routeSource, /z\.literal\(customerAccountHygieneRepairConfirmation\)/);
  assert.match(routeSource, /\.strict\(\)/);
  assert.doesNotMatch(routeSource, /accountId|customerAccountId|email|normalizedEmail/);
  assert.equal(customerAccountHygieneRepairOperation, "NORMALIZE_SINGLE_ZERO_HISTORY_ACCOUNT_AND_CREATE_ZERO_BALANCE");
  assert.equal(customerAccountHygieneRepairConfirmation, "EXECUTE_DETERMINISTIC_CUSTOMER_ACCOUNT_HYGIENE_REPAIR");
});

test("source safety keeps GET dry run read-only and avoids mutating lookup helpers", () => {
  const dryRunStart = serviceSource.indexOf("export async function dryRunCustomerAccountHygieneRepair");
  const dryRunEnd = serviceSource.indexOf("function safeConflict", dryRunStart);
  assert.ok(dryRunStart > 0 && dryRunEnd > dryRunStart);
  const dryRunSource = serviceSource.slice(dryRunStart, dryRunEnd);
  assert.doesNotMatch(dryRunSource, /\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\s*\(/);
  assert.doesNotMatch(dryRunSource, /\$executeRaw/);
  assert.doesNotMatch(dryRunSource, /findCustomerAccountByNormalizedEmail/);
  assert.match(serviceSource, /normalizeCustomerAccountEmail\(account\.email\)/);
  assert.match(authModuleSource, /findCustomerAccountByNormalizedEmail[\s\S]*touchCustomerAccountNormalizedEmail/);
});

test("POST mutation surface is limited and leaves legacy/POS reward history untouched", () => {
  const executeStart = serviceSource.indexOf("export async function executeCustomerAccountHygieneRepair");
  const executeEnd = serviceSource.indexOf("export class CustomerAccountHygieneRepairRollbackError", executeStart);
  assert.ok(executeStart > 0 && executeEnd > executeStart);
  const executeSource = serviceSource.slice(executeStart, executeEnd);
  assert.match(executeSource, /tx\.customerAccount\.updateMany/);
  assert.match(executeSource, /tx\.rewardBalance\.create/);
  assert.match(executeSource, /tx\.auditLog\.create/);
  assert.doesNotMatch(executeSource, /rewardLedgerEntry\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /storefrontCustomer\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /storefrontOrder\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /inventorySale\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /send|emailProvider|resend|smtp/i);
  assert.match(serviceSource, /TransactionIsolationLevel\.Serializable/);
});
