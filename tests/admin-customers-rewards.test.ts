import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/types/radar";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-admin-rewards-"));
const testDbPath = path.join(testDbDir, "admin-rewards.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
process.env.CUSTOMER_REWARDS_ENABLED = "true";
process.env.CUSTOMER_POS_REWARDS_ENABLED = "true";
process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";
process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "false";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const rewardsAdminModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/rewards-admin.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const {
  createAdminRewardAdjustment,
  getAdminCustomerRewardDetail,
  listAdminCustomerRewards,
  listAdminRewardLedger
} = rewardsAdminModule as typeof import("../src/lib/rewards-admin");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

function adminUser(id: string): SessionUser {
  return {
    id,
    email: "admin@example.test",
    name: "Admin",
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
}

async function createCustomerWithRewards() {
  const user = await prisma.user.create({
    data: {
      email: `${unique("admin")}@example.test`,
      name: "Admin",
      role: "ADMIN",
      passwordHash: "test-hash"
    }
  });
  const customer = await prisma.customerAccount.create({
    data: {
      email: `${unique("collector")}@example.test`,
      normalizedEmail: `${unique("collector-normalized")}@example.test`,
      displayName: "Collector Customer",
      phone: "+13055551234",
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
  await prisma.rewardBalance.create({
    data: {
      customerAccountId: customer.id,
      availablePoints: 10,
      pendingPoints: 5,
      lifetimeEarnedPoints: 15
    }
  });
  await prisma.storefrontOrder.create({
    data: {
      orderNumber: unique("ORD"),
      customerAccountId: customer.id,
      customerEmail: customer.email,
      customerName: customer.displayName,
      status: "paid",
      paymentStatus: "paid",
      fulfillmentStatus: "shipped",
      subtotal: 50,
      total: 55,
      refundedAmount: 0
    }
  });
  return { user, customer };
}

test("admin customers rewards list returns masked customer fields and summary", async () => {
  const { customer } = await createCustomerWithRewards();
  const result = await listAdminCustomerRewards({ search: "Collector", status: "active", sort: "points" });
  const row = result.customers.find((candidate) => candidate.id === customer.id);

  assert.ok(row);
  assert.equal(row.displayName, "Collector Customer");
  assert.notEqual(row.maskedEmail, customer.email);
  assert.equal(row.maskedPhone, "***-***-1234");
  assert.equal(row.availablePoints, 10);
  assert.equal(row.pendingPoints, 5);
  assert.equal(result.summary.redemptionEnabled, false);
  assert.equal(result.summary.adjustmentsEnabled, false);
});

test("admin reward adjustments are feature-flagged, idempotent, and never deduct below zero", async () => {
  const { user, customer } = await createCustomerWithRewards();
  await assert.rejects(
    createAdminRewardAdjustment(adminUser(user.id), {
      customerAccountId: customer.id,
      action: "add",
      points: 20,
      reason: "Customer support adjustment",
      idempotencyKey: "disabled-adjustment"
    }),
    /Admin reward adjustments are disabled/
  );

  process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "true";
  const first = await createAdminRewardAdjustment(adminUser(user.id), {
    customerAccountId: customer.id,
    action: "add",
    points: 20,
    reason: "Customer support adjustment",
    note: "Internal QA note",
    idempotencyKey: "admin-add-1"
  });
  const duplicate = await createAdminRewardAdjustment(adminUser(user.id), {
    customerAccountId: customer.id,
    action: "add",
    points: 20,
    reason: "Customer support adjustment",
    note: "Internal QA note",
    idempotencyKey: "admin-add-1"
  });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.adjustment.points, 20);
  assert.equal(first.adjustment.hasAdminNote, true);
  assert.equal(first.adjustment.createdBy, "Admin");

  let balance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: customer.id } });
  assert.equal(balance.availablePoints, 30);
  assert.equal(balance.lifetimeEarnedPoints, 35);

  const deduct = await createAdminRewardAdjustment(adminUser(user.id), {
    customerAccountId: customer.id,
    action: "deduct",
    points: 12,
    reason: "Goodwill correction",
    idempotencyKey: "admin-deduct-1"
  });
  assert.equal(deduct.adjustment.points, -12);
  balance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: customer.id } });
  assert.equal(balance.availablePoints, 18);
  assert.equal(balance.lifetimeEarnedPoints, 35);

  await assert.rejects(
    createAdminRewardAdjustment(adminUser(user.id), {
      customerAccountId: customer.id,
      action: "deduct",
      points: 999,
      reason: "Too much",
      idempotencyKey: "admin-deduct-too-much"
    }),
    /Cannot deduct more than the customer's available points/
  );

  const ledger = await listAdminRewardLedger({ source: "admin_adjustment" });
  assert.equal(ledger.ledger.filter((entry) => entry.customerAccountId === customer.id).length, 2);
});

test("admin customer detail includes safe summaries without private note contents", async () => {
  const { customer, user } = await createCustomerWithRewards();
  process.env.CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED = "true";
  await createAdminRewardAdjustment(adminUser(user.id), {
    customerAccountId: customer.id,
    action: "add",
    points: 5,
    reason: "Customer support adjustment",
    note: "Do not expose this private note",
    idempotencyKey: "admin-private-note"
  });

  const detail = await getAdminCustomerRewardDetail(customer.id);
  assert.ok(detail);
  assert.equal(detail.maskedPhone, "***-***-1234");
  assert.ok(detail.recentLedgerEntries.some((entry) => entry.hasAdminNote));
  assert.doesNotMatch(JSON.stringify(detail), /Do not expose this private note/);
});

test("admin customer rewards routes require private admin access", () => {
  const routePaths = [
    "src/app/api/radar/customers/route.ts",
    "src/app/api/radar/customers/[customerAccountId]/route.ts",
    "src/app/api/radar/rewards/ledger/route.ts",
    "src/app/api/radar/rewards/adjustments/route.ts"
  ];

  for (const routePath of routePaths) {
    const source = readFileSync(path.join(projectRoot, routePath), "utf8");
    assert.match(source, /requireUser\(/, `${routePath} must require a signed-in user`);
    assert.match(source, /requireAdmin\(user\)/, `${routePath} must require admin access`);
    assert.match(source, /privateOk|privateJson/, `${routePath} must use private no-store responses`);
  }
});

test("customers UI stays admin-only and public rewards surfaces do not expose admin notes", () => {
  const app = readFileSync(path.join(projectRoot, "src/components/RadarApp.tsx"), "utf8");
  const storefront = readFileSync(path.join(projectRoot, "src/lib/storefront.ts"), "utf8");
  const customerRewards = readFileSync(path.join(projectRoot, "src/lib/customer-rewards.ts"), "utf8");
  const storefrontOrderInclude = storefront.slice(
    storefront.indexOf("const storefrontOrderInclude"),
    storefront.indexOf("type StorefrontInventoryItem")
  );
  const customerRewardActivity = customerRewards.slice(
    customerRewards.indexOf("export async function listCustomerRewardActivity")
  );

  assert.match(app, /id: "customers"/);
  assert.match(app, /adminOnlyTabs = new Set<Tab>\(\["admin", "pos", "customers"\]\)/);
  assert.match(app, /Admin adjustments disabled/);
  assert.match(app, /CustomerRewardDetailPanel/);
  assert.doesNotMatch(storefrontOrderInclude, /metadataJson|adminNote/i);
  assert.doesNotMatch(customerRewardActivity, /metadataJson|adminNote/i);
});
