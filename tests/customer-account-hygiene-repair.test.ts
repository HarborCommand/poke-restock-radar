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
const routeModule = await import(pathToFileURL(path.join(projectRoot, "src/app/api/radar/customer-account-hygiene-repair/route.ts")).href);
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
const {
  handleCustomerAccountHygieneRepairGET,
  handleCustomerAccountHygieneRepairPOST
} = routeModule as typeof import("../src/app/api/radar/customer-account-hygiene-repair/route");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  delete process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED;
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
  highestAcknowledgedRewardTier: number;
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
        : new Date("2026-01-01T00:00:00.000Z"),
      highestAcknowledgedRewardTier: overrides.highestAcknowledgedRewardTier ?? 0
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

async function createStorefrontOrder(userId: string, customerAccountId: string, status = "paid", paymentStatus = "paid") {
  return prisma.storefrontOrder.create({
    data: {
      userId,
      customerAccountId,
      orderNumber: unique("REPAIR-ORDER"),
      status,
      paymentStatus,
      fulfillmentStatus: "unfulfilled",
      subtotal: 10,
      total: 10
    }
  });
}

async function createPosSale(userId: string, customerAccountId: string, platform = "pos") {
  const item = await createInventoryItem(userId);
  return prisma.inventorySale.create({
    data: {
      userId,
      inventoryItemId: item.id,
      customerAccountId,
      quantitySold: 1,
      soldPricePerItem: 20,
      grossSale: 20,
      platform,
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function confirmedRequest(body: unknown = {
  operation: customerAccountHygieneRepairOperation,
  expectedCandidateCount: 1,
  confirmation: customerAccountHygieneRepairConfirmation
}) {
  return new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://admin.example.test", "x-request-id": `req-${unique("route")}` },
    body: JSON.stringify(body)
  });
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function routeDeps(overrides: Record<string, unknown> = {}) {
  const owner = {
    id: unique("route-admin"),
    email: "route-admin@example.test",
    name: "Route Admin",
    role: "ADMIN",
    sessionVersion: 1,
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  } as SessionUser;
  return {
    requireUser: async () => ({ user: owner }),
    requireAdmin: (user: SessionUser) => (user.role === "ADMIN" ? null : jsonResponse({ error: "Admin access required" }, 403)),
    authorizeAdminMutation: (_request: Request, user: SessionUser) => (user.role === "ADMIN" ? null : jsonResponse({ error: "Admin access required" }, 403)),
    dryRunCustomerAccountHygieneRepair: async () => ({
      readOnly: true,
      executionEnabled: false,
      candidateCount: 0,
      classification: "NO_ELIGIBLE_CANDIDATE",
      reasonCodes: ["NO_ELIGIBLE_CANDIDATE"],
      activeCandidateCount: 0,
      verifiedCandidateCount: 0,
      candidateWithoutBalanceCount: 0,
      candidateWithoutLedgerCount: 0,
      candidateWithoutPositiveHistoryCount: 0,
      candidateWithoutStorefrontLinkCount: 0,
      candidateWithoutOrderLinkCount: 0,
      candidateWithoutPosLinkCount: 0,
      validNormalizedEmailCount: 0,
      uniqueNormalizedIdentityCount: 0,
      expectedAvailablePoints: 0,
      expectedPendingPoints: 0,
      expectedLifetimeEarnedPoints: 0
    }),
    executeCustomerAccountHygieneRepair: async () => ({
      repaired: false,
      classification: "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE",
      reasonCodes: ["NO_ELIGIBLE_CANDIDATE"]
    }),
    customerAccountHygieneRepairEnabled: () => true,
    readJson: async (request: Request) => request.json(),
    ...overrides
  } as NonNullable<Parameters<typeof handleCustomerAccountHygieneRepairGET>[1]>;
}

async function assertNoRepairMutation(ownerId: string, customerAccountId: string, beforeUpdatedAt: Date) {
  const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customerAccountId }, select: { normalizedEmail: true, updatedAt: true } });
  assert.equal(account.normalizedEmail, null);
  assert.equal(account.updatedAt.getTime(), beforeUpdatedAt.getTime());
  assert.equal(await prisma.rewardBalance.count({ where: { customerAccountId } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { userId: ownerId, action: "customer_account.hygiene_repair" } }), 0);
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
  assert.equal(result.candidateWithoutOrderLinkCount, 1);
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

test("storefront, storefront order, and POS links block eligibility without being repaired", async () => {
  const storefrontOwner = await createOwner();
  const storefrontCustomer = await createCandidate(storefrontOwner.id);
  await prisma.storefrontCustomer.create({
    data: { userId: storefrontOwner.id, customerAccountId: storefrontCustomer.id, email: `${unique("storefront")}@example.test` }
  });
  assert.ok((await dryRunCustomerAccountHygieneRepair(storefrontOwner.id)).reasonCodes.includes("STOREFRONT_CUSTOMER_LINK_EXISTS"));

  const orderOwner = await createOwner();
  const orderCustomer = await createCandidate(orderOwner.id);
  await createStorefrontOrder(orderOwner.id, orderCustomer.id);
  assert.ok((await dryRunCustomerAccountHygieneRepair(orderOwner.id)).reasonCodes.includes("STOREFRONT_ORDER_LINK_EXISTS"));

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

test("duplicate identity blocks globally across workspaces and never exposes the matching identity", async () => {
  const owner = await createOwner();
  const otherOwner = await createOwner();
  const candidate = await createCandidate(owner.id, { email: "Global.Identity@example.test" });
  const duplicate = await prisma.customerAccount.create({
    data: {
      userId: otherOwner.id,
      email: "global.identity@example.test",
      normalizedEmail: null,
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "BLOCKED");
  assert.equal(result.candidateCount, 0);
  assert.ok(result.reasonCodes.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
  assert.doesNotMatch(serialized(result), new RegExp(candidate.id));
  assert.doesNotMatch(serialized(result), new RegExp(duplicate.id));
  assert.doesNotMatch(serialized(result), /global\.identity|example\.test|@/i);
});

test("duplicate normalizedEmail blocks globally even when raw emails differ", async () => {
  const owner = await createOwner();
  const otherOwner = await createOwner();
  await createCandidate(owner.id, { email: "Normalized.Duplicate@example.test" });
  await prisma.customerAccount.create({
    data: {
      userId: otherOwner.id,
      email: `${unique("different")}@example.test`,
      normalizedEmail: "normalized.duplicate@example.test",
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "BLOCKED");
  assert.ok(result.reasonCodes.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
});

test("candidate alone is the only global identity match and remains eligible", async () => {
  const owner = await createOwner();
  await createCandidate(owner.id, { email: "  Alone.Identity@example.test  " });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "READY_FOR_DETERMINISTIC_REPAIR");
  assert.equal(result.uniqueNormalizedIdentityCount, 1);
});

test("global relation history blocks even when owner scope is inconsistent", async () => {
  const owner = await createOwner();
  const otherOwner = await createOwner();
  const customer = await createCandidate(owner.id);
  await prisma.storefrontCustomer.create({
    data: { userId: otherOwner.id, customerAccountId: customer.id, email: `${unique("cross-workspace")}@example.test` }
  });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "BLOCKED");
  assert.ok(result.reasonCodes.includes("STOREFRONT_CUSTOMER_LINK_EXISTS"));
});

test("any linked storefront order status blocks zero-history repair", async () => {
  for (const [status, paymentStatus] of [
    ["paid", "paid"],
    ["refunded", "refunded"],
    ["canceled", "paid"]
  ] as const) {
    const owner = await createOwner();
    const customer = await createCandidate(owner.id, { email: `${unique(`order-${status}`)}@example.test` });
    await createStorefrontOrder(owner.id, customer.id, status, paymentStatus);
    const result = await dryRunCustomerAccountHygieneRepair(owner.id);
    assert.equal(result.classification, "BLOCKED");
    assert.ok(result.reasonCodes.includes("STOREFRONT_ORDER_LINK_EXISTS"));
  }
});

test("canonical and historical POS platform variants block but non-POS marketplace sales do not", async () => {
  for (const platform of ["pos", "POS", "manual_pos"] as const) {
    const owner = await createOwner();
    const customer = await createCandidate(owner.id, { email: `${unique(`pos-${platform}`)}@example.test` });
    await createPosSale(owner.id, customer.id, platform);
    const result = await dryRunCustomerAccountHygieneRepair(owner.id);
    assert.equal(result.classification, "BLOCKED");
    assert.ok(result.reasonCodes.includes("POS_TRANSACTION_LINK_EXISTS"));
  }

  const nonPosOwner = await createOwner();
  const nonPosCustomer = await createCandidate(nonPosOwner.id, { email: `${unique("ebay-sale")}@example.test` });
  await createPosSale(nonPosOwner.id, nonPosCustomer.id, "ebay");
  const nonPosResult = await dryRunCustomerAccountHygieneRepair(nonPosOwner.id);
  assert.equal(nonPosResult.classification, "READY_FOR_DETERMINISTIC_REPAIR");
});

test("reward tier zero passes, positive tier history blocks, and negative tier remains invalid", async () => {
  const zeroOwner = await createOwner();
  await createCandidate(zeroOwner.id, { highestAcknowledgedRewardTier: 0 });
  assert.equal((await dryRunCustomerAccountHygieneRepair(zeroOwner.id)).classification, "READY_FOR_DETERMINISTIC_REPAIR");

  const positiveOwner = await createOwner();
  const positive = await createCandidate(positiveOwner.id, { highestAcknowledgedRewardTier: 2 });
  const positiveResult = await dryRunCustomerAccountHygieneRepair(positiveOwner.id);
  assert.equal(positiveResult.classification, "BLOCKED");
  assert.ok(positiveResult.reasonCodes.includes("REWARD_TIER_HISTORY_EXISTS"));
  assert.doesNotMatch(serialized(positiveResult), new RegExp(positive.id));

  const negativeOwner = await createOwner();
  await createCandidate(negativeOwner.id, { highestAcknowledgedRewardTier: -1 });
  const negativeResult = await dryRunCustomerAccountHygieneRepair(negativeOwner.id);
  assert.equal(negativeResult.classification, "BLOCKED");
  assert.ok(negativeResult.reasonCodes.includes("NEGATIVE_REWARD_FIELDS"));
});

test("candidate selection is workspace scoped", async () => {
  const owner = await createOwner();
  const otherOwner = await createOwner();
  await createCandidate(otherOwner.id);
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "NO_ELIGIBLE_CANDIDATE");
  assert.equal(result.candidateCount, 0);
});

test("unowned legacy account without owner-proving relationship is not adopted as a repair candidate", async () => {
  const owner = await createOwner();
  await prisma.customerAccount.create({
    data: {
      userId: null,
      email: `${unique("legacy-orphan")}@example.test`,
      normalizedEmail: null,
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      highestAcknowledgedRewardTier: 0
    }
  });
  const result = await dryRunCustomerAccountHygieneRepair(owner.id);
  assert.equal(result.classification, "NO_ELIGIBLE_CANDIDATE");
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.reasonCodes, ["NO_ELIGIBLE_CANDIDATE"]);
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

test("direct executor is disabled by default and performs no transaction mutation", async () => {
  const owner = await createOwner();
  const customer = await createCandidate(owner.id);
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { normalizedEmail: true, updatedAt: true } });
  const result = await executeCustomerAccountHygieneRepair(sessionUser(owner));
  const after = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { normalizedEmail: true, updatedAt: true } });
  assert.deepEqual(result, {
    repaired: false,
    classification: "EXECUTION_DISABLED",
    reasonCodes: ["EXECUTION_DISABLED"]
  });
  assert.equal(after.normalizedEmail, before.normalizedEmail);
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  assert.equal(await prisma.rewardBalance.count({ where: { customerAccountId: customer.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { userId: owner.id, action: "customer_account.hygiene_repair" } }), 0);
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

test("stale updatedAt causes rollback with no mutation", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id);
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(owner), {
      afterWriteRevalidation: async ({ tx, customerAccountId }) => {
        await tx.customerAccount.update({ where: { id: customerAccountId }, data: { adminNote: "stale local fixture" } });
      }
    }),
    (error) => {
      assert.equal((error as Error).name, "CustomerAccountHygieneRepairRollbackError");
      assert.deepEqual((error as { reasonCodes?: string[] }).reasonCodes, ["STALE_CUSTOMER_ACCOUNT"]);
      return true;
    }
  );
  await assertNoRepairMutation(owner.id, customer.id, before.updatedAt);
});

test("normalizedEmail concurrently populated causes rollback with no mutation", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id);
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(owner), {
      beforeConditionalUpdate: async ({ tx, customerAccountId, normalizedEmail }) => {
        await tx.customerAccount.update({ where: { id: customerAccountId }, data: { normalizedEmail } });
      }
    }),
    (error) => {
      assert.equal((error as Error).name, "CustomerAccountHygieneRepairRollbackError");
      assert.ok((error as { reasonCodes?: string[] }).reasonCodes?.includes("NORMALIZED_EMAIL_ALREADY_PRESENT"));
      return true;
    }
  );
  await assertNoRepairMutation(owner.id, customer.id, before.updatedAt);
});

test("global identity conflict introduced before write rolls back with no mutation", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id, { email: `${unique("conflict-introduced")}@example.test` });
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(owner), {
      beforeConditionalUpdate: async ({ tx, normalizedEmail }) => {
        await tx.customerAccount.create({
          data: {
            userId: owner.id,
            email: `${unique("conflicting-raw")}@example.test`,
            normalizedEmail,
            status: "active",
            emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
          }
        });
      }
    }),
    (error) => {
      assert.equal((error as Error).name, "CustomerAccountHygieneRepairRollbackError");
      assert.ok((error as { reasonCodes?: string[] }).reasonCodes?.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
      return true;
    }
  );
  await assertNoRepairMutation(owner.id, customer.id, before.updatedAt);
});

test("RewardBalance conflict rolls back normalizedEmail and audit", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id);
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(owner), {
      beforeRewardBalanceCreate: async ({ tx, customerAccountId }) => {
        await tx.rewardBalance.create({ data: { customerAccountId, availablePoints: 0, pendingPoints: 0, lifetimeEarnedPoints: 0 } });
      }
    }),
    (error) => {
      assert.equal((error as Error).name, "CustomerAccountHygieneRepairRollbackError");
      assert.deepEqual((error as { reasonCodes?: string[] }).reasonCodes, ["CONCURRENT_REWARD_BALANCE_CONFLICT"]);
      return true;
    }
  );
  await assertNoRepairMutation(owner.id, customer.id, before.updatedAt);
});

test("audit insertion failure rolls back normalizedEmail and RewardBalance", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const owner = await createOwner();
  const customer = await createCandidate(owner.id);
  const before = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(owner), {
      beforeAuditCreate: () => {
        throw new Error("fixture audit write failure");
      }
    }),
    (error) => {
      assert.equal((error as Error).name, "CustomerAccountHygieneRepairRollbackError");
      assert.deepEqual((error as { reasonCodes?: string[] }).reasonCodes, ["AUDIT_WRITE_FAILED"]);
      return true;
    }
  );
  await assertNoRepairMutation(owner.id, customer.id, before.updatedAt);
});

test("multiple eligible candidates and blocked candidates throw BLOCKED semantics without mutation", async () => {
  process.env.CUSTOMER_ACCOUNT_HYGIENE_REPAIR_ENABLED = "true";
  const multipleOwner = await createOwner();
  const first = await createCandidate(multipleOwner.id);
  const second = await createCandidate(multipleOwner.id);
  const firstBefore = await prisma.customerAccount.findUniqueOrThrow({ where: { id: first.id }, select: { updatedAt: true } });
  const secondBefore = await prisma.customerAccount.findUniqueOrThrow({ where: { id: second.id }, select: { updatedAt: true } });
  await assert.rejects(executeCustomerAccountHygieneRepair(sessionUser(multipleOwner)), /Customer account hygiene repair could not be completed/);
  await assertNoRepairMutation(multipleOwner.id, first.id, firstBefore.updatedAt);
  await assertNoRepairMutation(multipleOwner.id, second.id, secondBefore.updatedAt);

  const ledgerOwner = await createOwner();
  const ledgerCustomer = await createCandidate(ledgerOwner.id);
  const ledgerBefore = await prisma.customerAccount.findUniqueOrThrow({ where: { id: ledgerCustomer.id }, select: { updatedAt: true } });
  await prisma.rewardLedgerEntry.create({ data: { customerAccountId: ledgerCustomer.id, points: 0, type: "adjustment", reason: "fixture" } });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(ledgerOwner)),
    (error) => {
      assert.ok((error as { reasonCodes?: string[] }).reasonCodes?.includes("REWARD_LEDGER_HISTORY_EXISTS"));
      return true;
    }
  );
  assert.equal((await dryRunCustomerAccountHygieneRepair(ledgerOwner.id)).classification, "BLOCKED");
  const ledgerAfter = await prisma.customerAccount.findUniqueOrThrow({ where: { id: ledgerCustomer.id }, select: { normalizedEmail: true, updatedAt: true } });
  assert.equal(ledgerAfter.normalizedEmail, null);
  assert.equal(ledgerAfter.updatedAt.getTime(), ledgerBefore.updatedAt.getTime());
  assert.equal(await prisma.rewardBalance.count({ where: { customerAccountId: ledgerCustomer.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { userId: ledgerOwner.id, action: "customer_account.hygiene_repair" } }), 0);

  const duplicateOwner = await createOwner();
  const duplicateCustomer = await createCandidate(duplicateOwner.id, { email: "Throw.Duplicate@example.test" });
  const duplicateBefore = await prisma.customerAccount.findUniqueOrThrow({ where: { id: duplicateCustomer.id }, select: { updatedAt: true } });
  await prisma.customerAccount.create({
    data: {
      userId: duplicateOwner.id,
      email: `${unique("throw-duplicate")}@example.test`,
      normalizedEmail: "throw.duplicate@example.test",
      status: "active",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  await assert.rejects(
    executeCustomerAccountHygieneRepair(sessionUser(duplicateOwner)),
    (error) => {
      assert.ok((error as { reasonCodes?: string[] }).reasonCodes?.includes("DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"));
      return true;
    }
  );
  await assertNoRepairMutation(duplicateOwner.id, duplicateCustomer.id, duplicateBefore.updatedAt);
});

test("GET route enforces authentication, admin authorization, private headers, and aggregate-only response", async () => {
  const unauthenticated = await handleCustomerAccountHygieneRepairGET(
    new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", { headers: { "x-request-id": "route-get-unauth" } }),
    routeDeps({
      requireUser: async () => ({ response: jsonResponse({ error: "Authentication required" }, 401) })
    })
  );
  assert.equal(unauthenticated.status, 401);

  const customerSession = await handleCustomerAccountHygieneRepairGET(
    new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", { headers: { "x-request-id": "route-get-customer" } }),
    routeDeps({
      requireUser: async () => ({ response: jsonResponse({ error: "Authentication required" }, 401) })
    })
  );
  assert.equal(customerSession.status, 401);

  const nonAdmin = await handleCustomerAccountHygieneRepairGET(
    new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", { headers: { "x-request-id": "route-get-friend" } }),
    routeDeps({
      requireUser: async () => ({ user: { ...sessionUser({ id: "friend", email: "friend@example.test", name: "Friend" }), role: "FRIEND" } }),
      requireAdmin: () => jsonResponse({ error: "Admin access required" }, 403)
    })
  );
  assert.equal(nonAdmin.status, 403);

  const admin = await handleCustomerAccountHygieneRepairGET(
    new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", { headers: { "x-request-id": "route-get-admin" } }),
    routeDeps({
      dryRunCustomerAccountHygieneRepair: async () => ({
        readOnly: true,
        executionEnabled: true,
        candidateCount: 1,
        classification: "READY_FOR_DETERMINISTIC_REPAIR",
        reasonCodes: [],
        activeCandidateCount: 1,
        verifiedCandidateCount: 1,
        candidateWithoutBalanceCount: 1,
        candidateWithoutLedgerCount: 1,
        candidateWithoutPositiveHistoryCount: 1,
        candidateWithoutStorefrontLinkCount: 1,
        candidateWithoutOrderLinkCount: 1,
        candidateWithoutPosLinkCount: 1,
        validNormalizedEmailCount: 1,
        uniqueNormalizedIdentityCount: 1,
        expectedAvailablePoints: 0,
        expectedPendingPoints: 0,
        expectedLifetimeEarnedPoints: 0
      })
    })
  );
  assert.equal(admin.status, 200);
  assert.match(admin.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(admin.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(admin.headers.get("x-content-type-options"), "nosniff");
  const body = await responseBody(admin);
  assert.equal(body.classification, "READY_FOR_DETERMINISTIC_REPAIR");
  assert.doesNotMatch(serialized(body), /"id"|"email"|customerAccountId|accountId|@|example\.test/i);
});

test("POST route rejects unauthenticated, non-admin, cross-origin, disabled, malformed, and extra-field requests", async () => {
  assert.equal(
    (
      await handleCustomerAccountHygieneRepairPOST(
        confirmedRequest(),
        routeDeps({ requireUser: async () => ({ response: jsonResponse({ error: "Authentication required" }, 401) }) })
      )
    ).status,
    401
  );

  assert.equal(
    (
      await handleCustomerAccountHygieneRepairPOST(
        confirmedRequest(),
        routeDeps({
          requireUser: async () => ({ user: { ...sessionUser({ id: "friend-post", email: "friend-post@example.test", name: "Friend" }), role: "FRIEND" } }),
          authorizeAdminMutation: () => jsonResponse({ error: "Admin access required" }, 403)
        })
      )
    ).status,
    403
  );

  assert.equal(
    (
      await handleCustomerAccountHygieneRepairPOST(
        confirmedRequest(),
        routeDeps({ authorizeAdminMutation: () => jsonResponse({ error: "Invalid origin" }, 403) })
      )
    ).status,
    403
  );

  const disabled = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest(),
    routeDeps({ customerAccountHygieneRepairEnabled: () => false })
  );
  assert.equal(disabled.status, 403);
  assert.equal((await responseBody(disabled)).code, "CUSTOMER_ACCOUNT_HYGIENE_REPAIR_DISABLED");

  const malformed = await handleCustomerAccountHygieneRepairPOST(
    new Request("https://admin.example.test/api/radar/customer-account-hygiene-repair", { method: "POST", body: "not-json" }),
    routeDeps({ readJson: async () => ({}) })
  );
  assert.equal(malformed.status, 400);

  const extraField = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest({
      operation: customerAccountHygieneRepairOperation,
      expectedCandidateCount: 1,
      confirmation: customerAccountHygieneRepairConfirmation,
      email: "do-not-accept@example.test"
    }),
    routeDeps()
  );
  assert.equal(extraField.status, 400);
});

test("POST route returns 409 for blocked and multiple candidates, then 200 for success and idempotent no-op", async () => {
  const blocked = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest(),
    routeDeps({
      executeCustomerAccountHygieneRepair: async () => {
        throw new hygieneModule.CustomerAccountHygieneRepairRollbackError(["DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"]);
      }
    })
  );
  assert.equal(blocked.status, 409);
  const blockedBody = await responseBody(blocked);
  assert.equal(blockedBody.code, "CUSTOMER_ACCOUNT_HYGIENE_REPAIR_BLOCKED");
  assert.deepEqual(blockedBody.reasonCodes, ["DUPLICATE_NORMALIZED_ACCOUNT_IDENTITY"]);
  assert.doesNotMatch(serialized(blockedBody), /@|example\.test|customerAccountId|accountId/i);

  const multiple = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest(),
    routeDeps({
      executeCustomerAccountHygieneRepair: async () => {
        throw new hygieneModule.CustomerAccountHygieneRepairRollbackError(["MULTIPLE_ELIGIBLE_CANDIDATES"]);
      }
    })
  );
  assert.equal(multiple.status, 409);
  assert.deepEqual((await responseBody(multiple)).reasonCodes, ["MULTIPLE_ELIGIBLE_CANDIDATES"]);

  const success = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest(),
    routeDeps({
      executeCustomerAccountHygieneRepair: async () => ({
        repaired: true,
        normalizedEmailUpdated: true,
        rewardBalanceCreated: true,
        auditRecorded: true,
        availablePoints: 0,
        pendingPoints: 0,
        lifetimeEarnedPoints: 0,
        remainingEligibleCandidateCount: 0
      })
    })
  );
  assert.equal(success.status, 200);
  assert.equal((await responseBody(success)).repaired, true);

  const idempotent = await handleCustomerAccountHygieneRepairPOST(
    confirmedRequest(),
    routeDeps({
      executeCustomerAccountHygieneRepair: async () => ({
        repaired: false,
        classification: "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE",
        reasonCodes: ["NO_ELIGIBLE_CANDIDATE"]
      })
    })
  );
  assert.equal(idempotent.status, 200);
  assert.equal((await responseBody(idempotent)).classification, "ALREADY_CLEAN_OR_NO_ELIGIBLE_CANDIDATE");
});

test("confirmation contract is exact and rejects client-provided identity", () => {
  const schemaStart = routeSource.indexOf("const confirmationSchema");
  const schemaEnd = routeSource.indexOf("type AuthResult", schemaStart);
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart);
  const schemaSource = routeSource.slice(schemaStart, schemaEnd);
  assert.match(schemaSource, /z\.literal\(customerAccountHygieneRepairOperation\)/);
  assert.match(schemaSource, /z\.literal\(1\)/);
  assert.match(schemaSource, /z\.literal\(customerAccountHygieneRepairConfirmation\)/);
  assert.match(schemaSource, /\.strict\(\)/);
  assert.doesNotMatch(schemaSource, /accountId|customerAccountId|email|normalizedEmail/);
  assert.equal(customerAccountHygieneRepairOperation, "NORMALIZE_SINGLE_ZERO_HISTORY_ACCOUNT_AND_CREATE_ZERO_BALANCE");
  assert.equal(customerAccountHygieneRepairConfirmation, "EXECUTE_DETERMINISTIC_CUSTOMER_ACCOUNT_HYGIENE_REPAIR");
});

test("source safety keeps GET dry run read-only and avoids mutating lookup helpers", () => {
  const dryRunStart = serviceSource.indexOf("export async function dryRunCustomerAccountHygieneRepair");
  const dryRunEnd = serviceSource.indexOf("function alreadyClean", dryRunStart);
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
  assert.match(executeSource, /status: "active"/);
  assert.match(executeSource, /emailVerifiedAt: \{ not: null \}/);
  assert.match(executeSource, /highestAcknowledgedRewardTier: 0/);
  assert.match(executeSource, /tx\.rewardBalance\.create/);
  assert.match(executeSource, /tx\.auditLog\.create/);
  assert.doesNotMatch(executeSource, /rewardLedgerEntry\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /storefrontCustomer\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /storefrontOrder\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /inventorySale\.(create|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(executeSource, /send|emailProvider|resend|smtp/i);
  assert.match(serviceSource, /TransactionIsolationLevel\.Serializable/);
});
