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
const adminCustomerOrderLinksModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/admin-customer-order-links.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const {
  createAdminRewardAdjustment,
  getAdminCustomerRewardDetail,
  listAdminCustomerRewards,
  listAdminRewardLedger,
  updateAdminCustomerProfile
} = rewardsAdminModule as typeof import("../src/lib/rewards-admin");
const {
  attachAdminCustomerOrder,
  searchAdminCustomerAttachCandidates
} = adminCustomerOrderLinksModule as typeof import("../src/lib/admin-customer-order-links");
const validationModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/validation.ts")).href);
const {
  adminCustomerAttachOrderSchema,
  adminCustomerAttachOrderSearchSchema,
  adminCustomerProfileUpdateSchema,
  rewardAdminAdjustmentSchema
} = validationModule as typeof import("../src/lib/validation");

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

async function createAttachInventoryItem() {
  return prisma.inventoryItem.create({
    data: {
      itemType: "sealed_product",
      itemName: unique("Attach Test Product"),
      category: "sealed_packs",
      cost: 20,
      quantity: 5,
      source: "Local QA",
      purchasedAt: new Date(),
      publicTitle: "Attach Test Product",
      publicSlug: unique("attach-test-product"),
      publicPrice: 60
    }
  });
}

async function createAttachableOrder(customerEmail: string, overrides: Partial<Parameters<typeof prisma.storefrontOrder.create>[0]["data"]> = {}) {
  const item = await createAttachInventoryItem();
  return prisma.storefrontOrder.create({
    data: {
      orderNumber: unique("ATTACH-ORD"),
      customerEmail,
      customerName: "Attach Customer",
      customerPhone: "+13055559876",
      status: "paid",
      paymentStatus: "paid",
      fulfillmentStatus: "shipped",
      subtotal: 60,
      shippingCharged: 5,
      tax: 4,
      total: 69,
      paidAt: new Date(),
      items: {
        create: [
          {
            inventoryItemId: item.id,
            publicTitle: "Attach Test Product",
            publicSlug: item.publicSlug,
            quantity: 1,
            unitPrice: 60,
            lineTotal: 60
          }
        ]
      },
      ...overrides
    }
  });
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

test("admin customer search matches first name last name partial name email and phone", async () => {
  const adrianRivera = await prisma.customerAccount.create({
    data: {
      email: `${unique("adrian.rivera")}@gmail.com`,
      normalizedEmail: `${unique("adrian-rivera-normalized")}@gmail.com`,
      displayName: "Adrian Rivera",
      phone: "+13055551234",
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
  const adrianRodriguez = await prisma.customerAccount.create({
    data: {
      email: `${unique("adrian.rodriguez")}@hotmail.com`,
      normalizedEmail: `${unique("adrian-rodriguez-normalized")}@hotmail.com`,
      displayName: "Adrian Rodriguez",
      phone: "+13055559834",
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
  const mayaRivera = await prisma.customerAccount.create({
    data: {
      email: `${unique("maya.rivera")}@example.test`,
      normalizedEmail: `${unique("maya-rivera-normalized")}@example.test`,
      displayName: "Maya Rivera",
      phone: "+13055550000",
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
  await prisma.rewardBalance.createMany({
    data: [
      { customerAccountId: adrianRivera.id, availablePoints: 25, pendingPoints: 0, lifetimeEarnedPoints: 25 },
      { customerAccountId: adrianRodriguez.id, availablePoints: 102, pendingPoints: 3, lifetimeEarnedPoints: 105 },
      { customerAccountId: mayaRivera.id, availablePoints: 14, pendingPoints: 0, lifetimeEarnedPoints: 14 }
    ]
  });

  const firstName = await listAdminCustomerRewards({ search: "Adrian", status: "active", sort: "name" });
  assert.deepEqual(firstName.customers.map((customer) => customer.displayName).filter((name) => name.startsWith("Adrian")), [
    "Adrian Rivera",
    "Adrian Rodriguez"
  ]);

  const lastName = await listAdminCustomerRewards({ search: "Rivera", status: "active", sort: "name" });
  assert.ok(lastName.customers.some((customer) => customer.id === adrianRivera.id));
  assert.ok(lastName.customers.some((customer) => customer.id === mayaRivera.id));

  const partialName = await listAdminCustomerRewards({ search: "drian Riv", status: "active", sort: "name" });
  assert.equal(partialName.customers.some((customer) => customer.id === adrianRivera.id), true);
  assert.equal(partialName.customers.some((customer) => customer.id === adrianRodriguez.id), false);

  const email = await listAdminCustomerRewards({ search: "hotmail", status: "active" });
  assert.equal(email.customers.some((customer) => customer.id === adrianRodriguez.id), true);

  const phone = await listAdminCustomerRewards({ search: "9834", status: "active" });
  assert.equal(phone.customers.length, 1);
  assert.equal(phone.customers[0]?.id, adrianRodriguez.id);
  assert.equal(phone.customers[0]?.availablePoints, 102);
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
  assert.equal(detail.profile.displayName, "Collector Customer");
  assert.equal(detail.profile.phone, "+13055551234");
  assert.ok(detail.recentLedgerEntries.some((entry) => entry.hasAdminNote));
  assert.doesNotMatch(JSON.stringify(detail), /Do not expose this private note/);
});

test("admin can update allowed customer profile fields without touching identity or rewards", async () => {
  const { customer } = await createCustomerWithRewards();
  const beforeBalance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: customer.id } });
  const result = await updateAdminCustomerProfile(customer.id, {
    displayName: "Updated Collector",
    phone: "+13055550000",
    status: "disabled",
    adminNote: "Private admin-only profile note"
  });

  assert.equal(result.customer.displayName, "Updated Collector");
  assert.equal(result.customer.status, "disabled");
  assert.equal(result.customer.profile.phone, "+13055550000");
  assert.equal(result.customer.profile.adminNote, "Private admin-only profile note");
  assert.equal(result.customer.maskedPhone, "***-***-0000");
  assert.notEqual(result.customer.maskedEmail, customer.email);

  const updated = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id } });
  assert.equal(updated.email, customer.email);
  assert.equal(updated.emailVerifiedAt?.toISOString(), customer.emailVerifiedAt?.toISOString());
  assert.equal(updated.passwordHash, null);
  const afterBalance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: customer.id } });
  assert.equal(afterBalance.availablePoints, beforeBalance.availablePoints);
  assert.equal(afterBalance.pendingPoints, beforeBalance.pendingPoints);
  assert.equal(afterBalance.lifetimeEarnedPoints, beforeBalance.lifetimeEarnedPoints);
});

test("admin can attach matching past online order and backfill rewards once", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const order = await createAttachableOrder(customer.email);

  const search = await searchAdminCustomerAttachCandidates(customer.id, order.orderNumber);
  const candidate = search.candidates.find((item) => item.id === order.id);
  assert.ok(candidate);
  assert.equal(candidate.type, "storefront_order");
  assert.equal(candidate.emailMatchesCustomer, true);
  assert.equal(candidate.rewards.defaultApply, true);
  assert.notEqual(candidate.maskedCustomerEmail, customer.email);

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "storefront_order",
    orderId: order.id,
    reason: "Email ownership confirmed",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, true);
  assert.equal(result.rewardStatus, "applied");
  assert.equal(result.rewardPoints, 60);
  assert.equal(result.rewardPointsAwarded, 60);
  assert.match(result.rewardMessage, /60 reward points awarded/i);

  const linked = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(linked.customerAccountId, customer.id);
  assert.equal(linked.customerLinkSource, "email_match");
  assert.equal(linked.customerLinkReason, "Email ownership confirmed");
  assert.equal(linked.customerLinkNote, null);

  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: { idempotencyKey: `rewards:backfill:order:${order.id}` }
  });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.points, 60);
  assert.equal(ledger[0]?.status, "available");
  assert.equal(ledger[0]?.source, "admin_order_link_backfill");

  const duplicate = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "storefront_order",
    orderId: order.id,
    reason: "Email ownership confirmed",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.rewardsApplied, false);
  assert.equal(duplicate.rewardStatus, "already_awarded");
  assert.equal(duplicate.rewardPointsAwarded, 0);

  const ledgerAfterDuplicate = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:order:${order.id}` }
  });
  assert.equal(ledgerAfterDuplicate, 1);
});

test("admin attach links matching order and reports when rewards checkbox is not selected", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const order = await createAttachableOrder(customer.email);

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "storefront_order",
    orderId: order.id,
    reason: "Email ownership confirmed",
    confirmEmailMismatch: false,
    applyRewards: false
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, false);
  assert.equal(result.rewardStatus, "checkbox_not_selected");
  assert.equal(result.rewardPointsAwarded, 0);
  assert.match(result.rewardMessage, /Apply Rewards was not selected/i);

  const linked = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(linked.customerAccountId, customer.id);
  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:order:${order.id}` }
  });
  assert.equal(ledgerCount, 0);
});

test("admin attach excludes partially refunded online orders from rewards backfill", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const order = await createAttachableOrder(customer.email, {
    paymentStatus: "partially_refunded",
    refundedAmount: 10
  });

  const search = await searchAdminCustomerAttachCandidates(customer.id, order.orderNumber);
  const candidate = search.candidates.find((item) => item.id === order.id);
  assert.ok(candidate);
  assert.equal(candidate.rewards.eligible, false);
  assert.match(candidate.rewards.disabledReason ?? "", /refunded/i);

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "storefront_order",
    orderId: order.id,
    reason: "Email ownership confirmed",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.rewardsApplied, false);
  assert.equal(result.rewardStatus, "canceled_or_refunded");
  assert.match(result.rewardMessage, /refunded/i);

  const linked = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(linked.customerAccountId, customer.id);
  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:order:${order.id}` }
  });
  assert.equal(ledgerCount, 0);
});

test("admin attach requires explicit mismatch confirmation and does not reward email mismatches", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const order = await createAttachableOrder(`${unique("other")}@example.test`);

  await assert.rejects(
    attachAdminCustomerOrder(adminUser(user.id), customer.id, {
      type: "storefront_order",
      orderId: order.id,
      reason: "Receipt/order lookup",
      confirmEmailMismatch: false,
      applyRewards: true
    }, getAdminCustomerRewardDetail),
    /email does not match this customer/i
  );

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "storefront_order",
    orderId: order.id,
    reason: "Receipt/order lookup",
    note: "Owner reviewed private proof outside the app.",
    confirmEmailMismatch: true,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.rewardsApplied, false);
  assert.equal(result.rewardStatus, "blocked_email_mismatch");
  assert.equal(result.rewardPoints, 0);
  assert.match(result.rewardMessage, /different email address/i);

  const linked = await prisma.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(linked.customerAccountId, customer.id);
  assert.equal(linked.customerLinkSource, "admin_manual");
  assert.equal(linked.customerLinkNote, "Owner reviewed private proof outside the app.");

  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:order:${order.id}` }
  });
  assert.equal(ledgerCount, 0);
});

test("admin attach refuses orders already linked to another customer", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const otherCustomer = await prisma.customerAccount.create({
    data: {
      email: `${unique("linked")}@example.test`,
      normalizedEmail: `${unique("linked-normalized")}@example.test`,
      displayName: "Already Linked",
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
  const order = await createAttachableOrder(otherCustomer.email, { customerAccountId: otherCustomer.id });

  await assert.rejects(
    attachAdminCustomerOrder(adminUser(user.id), customer.id, {
      type: "storefront_order",
      orderId: order.id,
      reason: "Support correction",
      note: "Trying to attach to a different customer.",
      confirmEmailMismatch: true,
      applyRewards: false
    }, getAdminCustomerRewardDetail),
    /already linked to another customer/i
  );
});

test("admin can attach matching POS sale without trusting browser reward identity", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const saleReference = unique("POS-ATTACH");
  await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      quantitySold: 1,
      soldPricePerItem: 45,
      grossSale: 45,
      platform: "manual_pos",
      netSale: 45,
      costBasis: 20,
      profitLoss: 25,
      saleReference,
      paymentMethod: "cash",
      customerEmail: customer.email,
      customerMatchMethod: "email",
      soldAt: new Date()
    }
  });

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleReference,
    reason: "POS sale follow-up",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.rewardsApplied, true);
  assert.equal(result.rewardStatus, "applied");
  assert.equal(result.rewardPoints, 45);
  assert.equal(result.rewardPointsAwarded, 45);
  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference } });
  assert.equal(sale.customerAccountId, customer.id);
  assert.equal(sale.customerLinkSource, "pos_match");
  assert.equal(sale.rewardsEligible, true);

  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:pos:${saleReference}` }
  });
  assert.equal(ledgerCount, 1);
});

test("admin can apply rewards once to an already-linked eligible POS sale", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const saleReference = unique("POS-LINKED");
  await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      quantitySold: 1,
      soldPricePerItem: 42,
      grossSale: 42,
      platform: "manual_pos",
      netSale: 42,
      costBasis: 20,
      profitLoss: 22,
      saleReference,
      paymentMethod: "cash",
      customerAccountId: customer.id,
      customerEmail: customer.email,
      customerMatchMethod: "email",
      rewardsEligible: false,
      soldAt: new Date()
    }
  });

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleReference,
    reason: "Apply rewards after earlier customer link",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, true);
  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, true);
  assert.equal(result.rewardStatus, "applied");
  assert.equal(result.rewardPointsAwarded, 42);
  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference } });
  assert.equal(sale.customerAccountId, customer.id);
  assert.equal(sale.rewardsEligible, true);

  const duplicate = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleReference,
    reason: "Repeat reward apply",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.rewardsApplied, false);
  assert.equal(duplicate.rewardStatus, "already_awarded");
  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:pos:${saleReference}` }
  });
  assert.equal(ledgerCount, 1);
});

test("admin can attach legacy local sale by inventory sale ID when no sale reference exists", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const legacySale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      quantitySold: 1,
      soldPricePerItem: 38,
      grossSale: 38,
      platform: "local",
      netSale: 38,
      costBasis: 18,
      profitLoss: 20,
      saleReference: null,
      paymentMethod: "cash",
      customerEmail: customer.email,
      customerMatchMethod: "email",
      soldAt: new Date()
    }
  });

  const search = await searchAdminCustomerAttachCandidates(customer.id, legacySale.id);
  const candidate = search.candidates.find((item) => item.saleId === legacySale.id);
  assert.ok(candidate);
  assert.equal(candidate.type, "pos_sale");
  assert.equal(candidate.source, "manual");
  assert.equal(candidate.saleReference, null);
  assert.equal(candidate.saleId, legacySale.id);
  assert.equal(candidate.rewards.status, "eligible");

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleId: legacySale.id,
    reason: "Legacy local sale follow-up",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.duplicate, false);
  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, true);
  assert.equal(result.rewardStatus, "applied");
  assert.equal(result.rewardPointsAwarded, 38);
  const sale = await prisma.inventorySale.findUniqueOrThrow({ where: { id: legacySale.id } });
  assert.equal(sale.customerAccountId, customer.id);
  assert.equal(sale.customerLinkSource, "pos_match");
  assert.equal(sale.rewardsEligible, true);

  const ledgerCount = await prisma.rewardLedgerEntry.count({
    where: { idempotencyKey: `rewards:backfill:pos:${legacySale.id}` }
  });
  assert.equal(ledgerCount, 1);
});

test("admin ownership comparison keeps matching mismatched and missing emails distinct", async () => {
  const { customer } = await createCustomerWithRewards();
  const matching = await createAttachableOrder(customer.email);
  const mismatched = await createAttachableOrder(`${unique("different-owner")}@example.test`);
  const missing = await createAttachableOrder("placeholder@example.test", { customerEmail: null });
  const blank = await createAttachableOrder("placeholder@example.test", { customerEmail: "   " });

  for (const [order, expected] of [
    [matching, "email_match"],
    [mismatched, "email_mismatch"],
    [missing, "no_email_recorded"],
    [blank, "no_email_recorded"]
  ] as const) {
    const search = await searchAdminCustomerAttachCandidates(customer.id, order.orderNumber);
    const candidate = search.candidates.find((item) => item.id === order.id);
    assert.ok(candidate);
    assert.equal(candidate.matchStatus, expected);
    assert.equal(candidate.emailMatchesCustomer, expected === "email_match");
    if (expected === "no_email_recorded") {
      assert.doesNotMatch(candidate.matchMessage, /mismatch/i);
      assert.match(candidate.matchMessage, /No customer email was saved/i);
      assert.equal(candidate.requiresManualConfirmation, true);
      assert.equal(candidate.requiresInternalNote, true);
      assert.equal(candidate.rewardsEligible, true);
      assert.equal(candidate.rewards.defaultApply, false);
      assert.equal(candidate.rewardsBlockedReason, null);
    }
  }
});

test("admin can review a no-email legacy sale and award rewards exactly once", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const legacySale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      quantitySold: 1,
      soldPricePerItem: 49,
      grossSale: 49,
      platform: "local",
      netSale: 49,
      costBasis: 20,
      profitLoss: 29,
      paymentMethod: "cash",
      customerEmail: null,
      soldAt: new Date()
    }
  });

  const search = await searchAdminCustomerAttachCandidates(customer.id, legacySale.id);
  const candidate = search.candidates.find((item) => item.saleId === legacySale.id);
  assert.ok(candidate);
  assert.equal(candidate.matchStatus, "no_email_recorded");
  assert.equal(candidate.rewards.status, "eligible");
  assert.equal(candidate.rewards.defaultApply, false);
  assert.match(candidate.itemSummary, /Attach Test Product/);

  await assert.rejects(
    attachAdminCustomerOrder(adminUser(user.id), customer.id, {
      type: "pos_sale",
      saleId: legacySale.id,
      reason: "Legacy receipt review",
      confirmEmailMismatch: false,
      applyRewards: true
    }, getAdminCustomerRewardDetail),
    /no historical customer email.*Confirm the ownership review/i
  );
  await assert.rejects(
    attachAdminCustomerOrder(adminUser(user.id), customer.id, {
      type: "pos_sale",
      saleId: legacySale.id,
      reason: "Legacy receipt review",
      confirmEmailMismatch: true,
      applyRewards: true
    }, getAdminCustomerRewardDetail),
    /Legacy ownership reviews require an internal note/i
  );

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleId: legacySale.id,
    reason: "Legacy receipt review",
    note: "Receipt date and product were reviewed privately.",
    confirmEmailMismatch: true,
    applyRewards: true
  }, getAdminCustomerRewardDetail);

  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, true);
  assert.equal(result.rewardStatus, "applied");
  assert.equal(result.rewardPointsAwarded, 49);
  assert.match(result.rewardMessage, /49 reward points awarded after admin ownership review/i);
  assert.equal(result.candidate.matchStatus, "no_email_recorded");
  assert.equal(result.candidate.ownershipReviewCompleted, true);
  assert.equal(result.candidate.requiresManualConfirmation, false);

  const savedSale = await prisma.inventorySale.findUniqueOrThrow({ where: { id: legacySale.id } });
  assert.equal(savedSale.customerAccountId, customer.id);
  assert.equal(savedSale.customerEmail, null);
  assert.equal(savedSale.customerMatchMethod, "admin_manual");
  assert.equal(savedSale.customerLinkSource, "admin_manual");
  assert.equal(savedSale.customerLinkReason, "Legacy receipt review");
  assert.equal(savedSale.customerLinkNote, "Receipt date and product were reviewed privately.");
  assert.equal(savedSale.rewardsEligible, true);

  const ledger = await prisma.rewardLedgerEntry.findMany({ where: { idempotencyKey: `rewards:backfill:pos:${legacySale.id}` } });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.source, "admin_legacy_sale_backfill");
  assert.match(ledger[0]?.metadataJson ?? "", /no_email_manual_review/);

  const audit = await prisma.auditLog.findFirst({
    where: { entityType: "INVENTORY_SALE", entityId: legacySale.id },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(audit);
  assert.match(audit.metadata ?? "", /no_email_manual_review/);

  const duplicate = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleId: legacySale.id,
    reason: "Repeat legacy reward check",
    confirmEmailMismatch: false,
    applyRewards: true
  }, getAdminCustomerRewardDetail);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.rewardStatus, "already_awarded");
  assert.equal(await prisma.rewardLedgerEntry.count({ where: { idempotencyKey: `rewards:backfill:pos:${legacySale.id}` } }), 1);
});

test("already-linked no-email sale requires ownership review before Apply Rewards Now", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const legacySale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      customerAccountId: customer.id,
      quantitySold: 1,
      soldPricePerItem: 37,
      grossSale: 37,
      platform: "local",
      netSale: 37,
      costBasis: 17,
      profitLoss: 20,
      customerEmail: null,
      customerMatchMethod: "admin_manual",
      soldAt: new Date()
    }
  });

  const before = await searchAdminCustomerAttachCandidates(customer.id, legacySale.id);
  const beforeCandidate = before.candidates.find((item) => item.saleId === legacySale.id);
  assert.ok(beforeCandidate);
  assert.equal(beforeCandidate.matchStatus, "no_email_recorded");
  assert.equal(beforeCandidate.ownershipReviewCompleted, false);
  assert.equal(beforeCandidate.requiresManualConfirmation, true);

  await assert.rejects(
    attachAdminCustomerOrder(adminUser(user.id), customer.id, {
      type: "pos_sale",
      saleId: legacySale.id,
      reason: "Apply legacy rewards",
      confirmEmailMismatch: false,
      applyRewards: true
    }, getAdminCustomerRewardDetail),
    /ownership review/i
  );

  const applied = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleId: legacySale.id,
    reason: "Apply legacy rewards",
    note: "Owner reviewed receipt and sale details.",
    confirmEmailMismatch: true,
    applyRewards: true
  }, getAdminCustomerRewardDetail);
  assert.equal(applied.duplicate, true);
  assert.equal(applied.rewardsApplied, true);
  assert.equal(applied.rewardPointsAwarded, 37);
  assert.equal(applied.candidate.ownershipReviewCompleted, true);

  const reviewed = await prisma.inventorySale.findUniqueOrThrow({ where: { id: legacySale.id } });
  assert.equal(reviewed.customerLinkReason, "Apply legacy rewards");
  assert.equal(reviewed.customerLinkNote, "Owner reviewed receipt and sale details.");
  const reviewAudit = await prisma.auditLog.findFirst({ where: { action: "customer.pos_sale.ownership_reviewed", entityId: legacySale.id } });
  assert.ok(reviewAudit);
});

test("refunded no-email sale can link after review but cannot receive rewards", async () => {
  const { user, customer } = await createCustomerWithRewards();
  const item = await createAttachInventoryItem();
  const sale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      quantitySold: 1,
      soldPricePerItem: 35,
      grossSale: 35,
      platform: "local",
      netSale: 0,
      costBasis: 15,
      profitLoss: -15,
      customerEmail: null,
      refundStatus: "refunded",
      refundedAmount: 35,
      soldAt: new Date()
    }
  });

  const search = await searchAdminCustomerAttachCandidates(customer.id, sale.id);
  const candidate = search.candidates.find((item) => item.saleId === sale.id);
  assert.ok(candidate);
  assert.equal(candidate.matchStatus, "no_email_recorded");
  assert.equal(candidate.rewardsEligible, false);
  assert.match(candidate.rewardsBlockedReason ?? "", /refunded/i);

  const result = await attachAdminCustomerOrder(adminUser(user.id), customer.id, {
    type: "pos_sale",
    saleId: sale.id,
    reason: "Legacy refunded sale review",
    note: "Ownership reviewed; sale was later refunded.",
    confirmEmailMismatch: true,
    applyRewards: true
  }, getAdminCustomerRewardDetail);
  assert.equal(result.linked, true);
  assert.equal(result.rewardsApplied, false);
  assert.equal(result.rewardStatus, "canceled_or_refunded");
  assert.equal(await prisma.rewardLedgerEntry.count({ where: { idempotencyKey: `rewards:backfill:pos:${sale.id}` } }), 0);
});

test("admin customer profile validation rejects disallowed identity auth and reward fields", () => {
  assert.throws(
    () => adminCustomerProfileUpdateSchema.parse({
      displayName: "Bad Update",
      phone: "+13055550000",
      status: "active",
      adminNote: "note",
      email: "changed@example.test"
    }),
    /Unrecognized key/
  );
  for (const field of ["customerAccountId", "passwordHash", "sessionRevokedBefore", "availablePoints", "rewardBalance", "emailVerifiedAt"]) {
    assert.throws(
      () => adminCustomerProfileUpdateSchema.parse({
        displayName: "Bad Update",
        phone: "+13055550000",
        status: "active",
        adminNote: "note",
        [field]: "blocked"
      }),
      /Unrecognized key/,
      `${field} should not be editable through customer profile update`
    );
  }
});

test("customer admin note migration is additive and nullable", () => {
  const schema = readFileSync(path.join(projectRoot, "prisma/schema.prisma"), "utf8");
  const sqliteInit = readFileSync(path.join(projectRoot, "prisma/init-sqlite.ts"), "utf8");
  const migration = readFileSync(path.join(projectRoot, "prisma/migrations/20260708204500_customer_account_admin_note/migration.sql"), "utf8");

  assert.match(schema, /adminNote\s+String\?/);
  assert.match(sqliteInit, /"adminNote" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "CustomerAccount" ADD COLUMN "adminNote" TEXT/);
  assert.match(migration, /ALTER TABLE "CustomerAccount" ADD COLUMN "adminNote" TEXT/);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|NOT NULL/i);
});

test("admin customer order link migration is additive and nullable", () => {
  const schema = readFileSync(path.join(projectRoot, "prisma/schema.prisma"), "utf8");
  const sqliteInit = readFileSync(path.join(projectRoot, "prisma/init-sqlite.ts"), "utf8");
  const migration = readFileSync(path.join(projectRoot, "prisma/migrations/20260710024500_admin_customer_order_links/migration.sql"), "utf8");

  for (const field of ["customerLinkSource", "customerLinkedAt", "customerLinkedByUserId", "customerLinkReason", "customerLinkNote"]) {
    assert.match(schema, new RegExp(`${field}\\s+`), `${field} should exist in Prisma schema`);
    assert.match(sqliteInit, new RegExp(`"${field}"`), `${field} should exist in sqlite init`);
    assert.match(migration, new RegExp(`ADD COLUMN "${field}"`), `${field} should be added by migration`);
  }
  assert.match(schema, /@@index\(\[customerLinkSource\]\)/);
  assert.match(schema, /@@index\(\[customerLinkedByUserId\]\)/);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|NOT NULL/i);
  assert.doesNotMatch(migration, /RewardBalance|CustomerSession|passwordHash/i);
});

test("reward adjustment validation requires positive integer points and reason", () => {
  assert.throws(
    () => rewardAdminAdjustmentSchema.parse({
      customerAccountId: "customer-1",
      action: "add",
      points: 0,
      reason: "Customer service credit",
      idempotencyKey: "adjust-validate-1"
    }),
    /greater than 0/
  );
  assert.throws(
    () => rewardAdminAdjustmentSchema.parse({
      customerAccountId: "customer-1",
      action: "add",
      points: 1.5,
      reason: "Customer service credit",
      idempotencyKey: "adjust-validate-2"
    }),
    /integer/
  );
  assert.throws(
    () => rewardAdminAdjustmentSchema.parse({
      customerAccountId: "customer-1",
      action: "add",
      points: 10,
      reason: "",
      idempotencyKey: "adjust-validate-3"
    }),
    /at least 4/
  );
});

test("admin customer attach order validation requires scoped identifiers and strict payloads", () => {
  assert.throws(
    () => adminCustomerAttachOrderSchema.parse({
      type: "storefront_order",
      saleReference: "POS-1",
      reason: "Receipt/order lookup",
      confirmEmailMismatch: false,
      applyRewards: false
    }),
    /Order ID is required/
  );
  assert.throws(
    () => adminCustomerAttachOrderSchema.parse({
      type: "pos_sale",
      orderId: "order-1",
      reason: "POS sale follow-up",
      confirmEmailMismatch: false,
      applyRewards: false
    }),
    /Sale reference or sale ID is required/
  );
  assert.doesNotThrow(() => adminCustomerAttachOrderSchema.parse({
    type: "pos_sale",
    saleId: "sale-1",
    reason: "POS sale follow-up",
    confirmEmailMismatch: false,
    applyRewards: false
  }));
  assert.throws(
    () => adminCustomerAttachOrderSchema.parse({
      type: "storefront_order",
      orderId: "order-1",
      reason: "Receipt/order lookup",
      customerAccountId: "browser-supplied-customer"
    }),
    /Unrecognized key/
  );
  for (const unsafeField of ["matchStatus", "rewardsEligible", "rewardPoints"]) {
    assert.throws(
      () => adminCustomerAttachOrderSchema.parse({
        type: "pos_sale",
        saleId: "sale-1",
        reason: "Legacy sale review",
        confirmEmailMismatch: true,
        applyRewards: true,
        [unsafeField]: unsafeField === "rewardPoints" ? 9999 : true
      }),
      /Unrecognized key/
    );
  }
  assert.equal(adminCustomerAttachOrderSearchSchema.parse({ query: "  ORD-123  " }).query, "ORD-123");
});

test("admin customer rewards routes require private admin access", () => {
  const routePaths = [
    "src/app/api/radar/customers/route.ts",
    "src/app/api/radar/customers/[customerAccountId]/route.ts",
    "src/app/api/radar/customers/[customerAccountId]/attach-order/route.ts",
    "src/app/api/radar/rewards/ledger/route.ts",
    "src/app/api/radar/rewards/adjustments/route.ts"
  ];

  for (const routePath of routePaths) {
    const source = readFileSync(path.join(projectRoot, routePath), "utf8");
    assert.match(source, /requireUser\(/, `${routePath} must require a signed-in user`);
    assert.match(source, /requireAdmin\(user\)/, `${routePath} must require admin access`);
    assert.match(source, /privateOk|privateJson/, `${routePath} must use private no-store responses`);
  }
  const customerDetailRoute = readFileSync(path.join(projectRoot, "src/app/api/radar/customers/[customerAccountId]/route.ts"), "utf8");
  assert.match(customerDetailRoute, /export async function PATCH/);
  assert.match(customerDetailRoute, /adminCustomerProfileUpdateSchema/);
  assert.match(customerDetailRoute, /updateAdminCustomerProfile/);
  assert.doesNotMatch(customerDetailRoute, /emailVerifiedAt|passwordHash|rewardBalance|availablePoints/);
  const attachRoute = readFileSync(path.join(projectRoot, "src/app/api/radar/customers/[customerAccountId]/attach-order/route.ts"), "utf8");
  assert.match(attachRoute, /adminCustomerAttachOrderSearchSchema/);
  assert.match(attachRoute, /adminCustomerAttachOrderSchema/);
  assert.match(attachRoute, /attachAdminCustomerOrder\(user, customerAccountId/);
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
  assert.match(app, /Point adjustments are disabled until admin adjustments are enabled/);
  assert.match(app, /CustomerProfileEditModal/);
  assert.match(app, /RewardAdjustmentModal/);
  assert.match(app, /CustomerAttachOrderModal/);
  assert.match(app, /SalesAttachCustomerModal/);
  assert.match(app, /Attach to Customer/);
  assert.match(app, /Attach Past Order/);
  assert.match(app, /Apply eligible rewards after linking/);
  assert.match(app, /Legacy sale - no email recorded/);
  assert.match(app, /No customer email was saved on this sale/);
  assert.match(app, /I reviewed available records and confirmed this purchase belongs to the selected customer/);
  assert.match(app, /Search is discovery only/);
  assert.match(app, /CustomerSearchProfileCard/);
  assert.match(app, /View Profile/);
  assert.match(app, /Select Customer/);
  assert.match(app, /Selected Customer/);
  assert.match(app, /CustomerProfileSummaryCard/);
  assert.match(app, /CustomerAttachVerificationPanel/);
  assert.match(app, /Purchase email/);
  assert.match(app, /Customer email/);
  assert.match(app, /Verified email match/);
  assert.match(app, /Email mismatch/);
  assert.match(app, /Rewards: Applied/);
  assert.match(app, /Rewards: Skipped/);
  assert.match(app, /I confirmed ownership despite the recorded email mismatch/);
  assert.match(app, /Email changes require a separate verified email-change flow/);
  assert.match(app, /aria-label="Account status"/);
  assert.match(app, /aria-label="Close reward adjustment"/);
  assert.match(app, /aria-label="Reward adjustment action"/);
  assert.match(app, /aria-label="Point amount"/);
  assert.match(app, /aria-label="Reason"/);
  assert.match(app, /Internal admin note/);
  assert.match(app, /Save Adjustment/);
  assert.match(app, /CustomerRewardDetailPanel/);
  const customerEditModal = app.slice(
    app.indexOf("function CustomerProfileEditModal"),
    app.indexOf("function RewardAdjustmentModal")
  );
  assert.match(customerEditModal, /aria-label="Close edit customer"/);
  assert.match(customerEditModal, /customer-profile-edit-modal/);
  assert.match(customerEditModal, /customer-profile-note-field/);
  assert.match(customerEditModal, /Internal admin note/);
  assert.match(customerEditModal, /Save Customer/);
  assert.doesNotMatch(customerEditModal, /type="email"|name="email"|setEmail|value=\{customer\.email\}/);
  const attachModal = app.slice(
    app.indexOf("function CustomerAttachOrderModal"),
    app.indexOf("function CustomerProfileEditModal")
  );
  assert.match(attachModal, /aria-label="Close attach past order"/);
  assert.match(attachModal, /requestJson<AdminCustomerAttachOrderSearchResponseDTO>/);
  assert.match(attachModal, /requestJson<AdminCustomerAttachOrderResultDTO>/);
  assert.match(attachModal, /selectedCandidate\.type === "storefront_order" \? selectedCandidate\.id : undefined/);
  assert.match(attachModal, /selectedCandidate\.type === "pos_sale" \? selectedCandidate\.saleReference \?\? undefined : undefined/);
  assert.match(attachModal, /selectedCandidate\.type === "pos_sale" \? selectedCandidate\.saleId \?\? undefined : undefined/);
  assert.match(attachModal, /disabled=\{!selectedCandidate\.rewardsEligible\}/);
  assert.match(attachModal, /selectedCandidate\?\.requiresManualConfirmation/);
  assert.match(attachModal, /selectedCandidate\.requiresInternalNote/);
  assert.match(attachModal, /selectedCandidate\.matchStatus === "no_email_recorded"/);
  const salesAttachModal = app.slice(
    app.indexOf("function SalesAttachCustomerModal"),
    app.indexOf("function SaleDetailsModal")
  );
  assert.match(salesAttachModal, /aria-label=\{`Attach \$\{target\.label\} to a customer`\}/);
  assert.ok(salesAttachModal.includes("requestJson<AdminCustomerRewardsResponseDTO>(`/api/radar/customers?${params.toString()}`)"));
  assert.match(salesAttachModal, /requestJson<AdminCustomerAttachOrderSearchResponseDTO>/);
  assert.ok(salesAttachModal.includes("`/api/radar/customers/${customer.id}/attach-order?${params.toString()}`"));
  assert.match(salesAttachModal, /requestJson<AdminCustomerAttachOrderResultDTO>/);
  assert.ok(salesAttachModal.includes("`/api/radar/customers/${selectedCustomer.id}/attach-order`"));
  assert.match(salesAttachModal, /setPreviewCustomer\(customer\)/);
  assert.match(salesAttachModal, /onSelect=\{\(\) => void chooseCustomer\(customer\)\}/);
  assert.match(salesAttachModal, /selectedCandidate\.type === "storefront_order" \? selectedCandidate\.id : undefined/);
  assert.match(salesAttachModal, /selectedCandidate\.type === "pos_sale" \? selectedCandidate\.saleReference \?\? undefined : undefined/);
  assert.match(salesAttachModal, /selectedCandidate\.type === "pos_sale" \? selectedCandidate\.saleId \?\? undefined : undefined/);
  assert.match(salesAttachModal, /ownershipConfirmationCopy\(selectedCandidate\)/);
  assert.match(salesAttachModal, /Backfill rewards for this linked purchase when eligible/);
  assert.match(salesAttachModal, /disabled=\{!selectedCandidate\?\.rewardsEligible\}/);
  assert.match(app, /customer\.maskedEmail/);
  assert.doesNotMatch(salesAttachModal, /customerEmail|passwordHash|sessionToken|resetToken|authSecret/i);
  const saleDetailsModal = app.slice(
    app.indexOf("function SaleDetailsModal"),
    app.indexOf("function EditSaleModal")
  );
  assert.match(app, /saleId: sale\.id/);
  assert.match(app, /saleReference: sale\.saleReference\.trim\(\)/);
  assert.match(saleDetailsModal, /Apply Rewards Now/);
  assert.match(saleDetailsModal, /setRewardOverride/);
  assert.match(saleDetailsModal, /displaySale: InventorySaleDTO/);
  assert.match(saleDetailsModal, /saleApplyRewardsDisabledReason\(displaySale\)/);
  assert.match(saleDetailsModal, /rewardPointsEarned: result\.rewardsApplied \? result\.rewardPointsAwarded : displaySale\.rewardPointsEarned/);
  assert.match(saleDetailsModal, /result\.rewardStatus === "already_awarded"/);
  assert.match(saleDetailsModal, /candidate\.requiresManualConfirmation \|\| candidate\.requiresInternalNote/);
  assert.match(saleDetailsModal, /Ownership review required before rewards can be applied/);
  assert.match(saleDetailsModal, /await onRefresh\(\)/);
  assert.match(saleDetailsModal, /Already Awarded/);
  assert.match(saleDetailsModal, /isAdmin && attachTarget && !displaySale\.customerAccountId/);
  assert.match(saleDetailsModal, /Customer link/);
  assert.match(saleDetailsModal, /Linked customer saved/);
  assert.match(saleDetailsModal, /SalesAttachCustomerModal/);
  assert.doesNotMatch(storefrontOrderInclude, /metadataJson|adminNote/i);
  assert.doesNotMatch(customerRewardActivity, /metadataJson|adminNote/i);
});

test("customers rewards workspace has compact mobile table and modal layouts", () => {
  const css = readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customers-rewards-layout,[\s\S]*?body \.customers-overview-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customers-table-row,[\s\S]*?body \.customers-ledger-row\s*\{[\s\S]*?min-width: 0;[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customers-table-row\.header,[\s\S]*?body \.customers-ledger-row\.header\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customers-row-actions \.secondary-action,[\s\S]*?body \.customers-ledger-row > button\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customers-admin-modal\s*\{[\s\S]*?width: calc\(100vw - 24px\);[\s\S]*?max-height: calc\(100dvh - 24px\);/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?body \.customers-admin-modal\.reward-adjustment-modal\s*\{[\s\S]*?width: calc\(100vw - 24px\);[\s\S]*?max-height: calc\(100dvh - 24px\);/);
});

test("edit customer modal keeps profile fields aligned and actions visible", () => {
  const css = readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /body \.customers-admin-modal\.customer-profile-edit-modal\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(css, /body \.customer-profile-edit-modal \.customer-profile-edit-header\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.customer-profile-edit-form \.customer-profile-form-grid\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /body \.customer-profile-edit-form \.customer-profile-form-grid \.customer-profile-field\s*\{[\s\S]*?border: 0;[\s\S]*?padding: 0;/);
  assert.match(css, /body \.customer-profile-edit-form \.customer-profile-note-field\s*\{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(css, /body \.customer-profile-edit-modal \.customer-profile-edit-actions\s*\{[\s\S]*?position: static;[\s\S]*?box-shadow: none;/);
  assert.ok(
    css.lastIndexOf("body .customer-profile-edit-modal .customer-profile-edit-actions") >
      css.indexOf("body .inventory-edit-actions,\nbody .inventory-modal .inventory-edit-actions"),
    "customer profile edit modal footer override must come after the shared sticky inventory footer rule"
  );
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?body \.customer-profile-edit-form \.customer-profile-form-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test("reward adjustment modal keeps fields compact and helper visible", () => {
  const css = readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /body \.customers-admin-modal\.reward-adjustment-modal\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(css, /body \.reward-adjustment-modal \.reward-adjustment-modal-header\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.reward-adjustment-form\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto;[\s\S]*?overflow: hidden;/);
  assert.match(css, /body \.reward-adjustment-form \.reward-adjustment-grid\s*\{[\s\S]*?grid-template-columns: minmax\(120px, 0\.55fr\) minmax\(0, 1fr\);/);
  assert.match(css, /body \.reward-adjustment-form \.reward-adjustment-grid label\s*\{[\s\S]*?border: 0;[\s\S]*?padding: 0;/);
  assert.match(css, /body \.reward-adjustment-form \.reward-adjustment-note-field\s*\{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(css, /body \.reward-adjustment-helper\s*\{[\s\S]*?margin: 0;[\s\S]*?padding: 10px 12px;/);
  assert.match(css, /body \.reward-adjustment-modal \.reward-adjustment-actions\s*\{[\s\S]*?position: static;[\s\S]*?box-shadow: none;/);
  assert.ok(
    css.lastIndexOf("body .reward-adjustment-modal .reward-adjustment-actions") >
      css.indexOf("body .inventory-edit-actions,\nbody .inventory-modal .inventory-edit-actions"),
    "reward adjustment modal footer override must come after the shared sticky inventory footer rule"
  );
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?body \.reward-adjustment-form \.reward-adjustment-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test("attach past order modal has compact desktop and mobile layout", () => {
  const css = readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /body \.customers-admin-modal\.customer-attach-order-modal\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(css, /body \.customer-attach-order-modal \.customer-attach-order-header\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.customer-attach-order-form\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.customer-attach-search-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.customer-attach-candidate\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.customer-attach-order-modal \.customer-attach-actions\s*\{[\s\S]*?position: static;[\s\S]*?box-shadow: none;/);
  assert.match(css, /body \.sales-attach-target-card\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body \.sales-attach-customer\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?body \.customer-attach-search-row,[\s\S]*?body \.customer-attach-candidate,[\s\S]*?body \.sales-attach-target-card,[\s\S]*?body \.sales-attach-customer\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?body \.customer-attach-order-modal \.customer-attach-actions\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});
