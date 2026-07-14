import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/types/radar";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-pos-customer-contact-"));
const testDbPath = path.join(testDbDir, "pos-customer-contact.sqlite");
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
const radarServiceModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/radar-service.ts")).href);
const posCustomerModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/pos-customer.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { createPosSale, quotePosSaleTax, refundPosSale } = radarServiceModule as typeof import("../src/lib/radar-service");
const {
  normalizePosCustomerPhone,
  resolvePosCustomerMatch
} = posCustomerModule as typeof import("../src/lib/pos-customer");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;
let activeOwner: SessionUser;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

function setPosRewardsEnabled(enabled: boolean) {
  process.env.CUSTOMER_REWARDS_ENABLED = enabled ? "true" : "false";
  process.env.CUSTOMER_POS_REWARDS_ENABLED = enabled ? "true" : "false";
}

test.beforeEach(async () => {
  setPosRewardsEnabled(false);
  activeOwner = await createAdminUser();
});

async function createAdminUser(): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: `${unique("pos-admin")}@example.test`,
      name: "POS Admin",
      role: "ADMIN",
      passwordHash: "test-hash"
    }
  });
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
  activeOwner = sessionUser;
  return sessionUser;
}

async function createInventoryItem(userId: string) {
  return prisma.inventoryItem.create({
    data: {
      userId,
      itemType: "product",
      itemName: unique("POS customer test product"),
      category: "sealed_packs",
      cost: 10,
      quantity: 3,
      source: "Preview QA",
      purchasedAt: new Date(),
      publicPrice: 25,
      targetSellPrice: 25,
      listingStatus: "listed",
      publishToStore: false,
      storeStatus: "draft",
      localPickupAvailable: true,
      shippingAvailable: true
    }
  });
}

type QuotedPosSaleInput = Omit<Parameters<typeof createPosSale>[1], "quoteId">;

async function createQuotedPosSale(user: SessionUser, input: QuotedPosSaleInput & Record<string, unknown>) {
  const quote = await quotePosSaleTax(user, {
    idempotencyKey: input.idempotencyKey,
    items: input.items,
    selectedCustomerAccountId: input.selectedCustomerAccountId,
    taxExempt: input.taxExempt,
    taxExemptReason: input.taxExemptReason,
    taxExemptionReference: input.taxExemptionReference
  });
  return createPosSale(user, { ...input, quoteId: quote.quoteId });
}

async function createCustomer(input: {
  email: string;
  phone?: string | null;
  status?: string;
  emailVerifiedAt?: Date | null;
}) {
  return prisma.customerAccount.create({
    data: {
      userId: activeOwner.id,
      email: input.email,
      normalizedEmail: input.email.toLowerCase(),
      phone: input.phone ?? null,
      status: input.status ?? "active",
      emailVerifiedAt: input.emailVerifiedAt === undefined ? new Date() : input.emailVerifiedAt
    }
  });
}

async function createVerifiedCustomer(input: { email: string; phone?: string | null }) {
  return createCustomer(input);
}

test("POS customer contact matching links verified email but not phone-only contact", async () => {
  const phone = "+15551234567";
  const account = await createVerifiedCustomer({ email: `${unique("collector")}@example.test`, phone });

  const emailMatch = await resolvePosCustomerMatch({ customerEmail: account.email.toUpperCase(), customerPhone: "(555) 123-4567" }, activeOwner.id);
  assert.equal(emailMatch.customerAccountId, account.id);
  assert.equal(emailMatch.customerEmail, account.email);
  assert.equal(emailMatch.customerPhone, phone);
  assert.equal(emailMatch.customerMatchMethod, "email");
  assert.equal(emailMatch.rewardsEligible, false);

  const phoneMatch = await resolvePosCustomerMatch({ customerPhone: "555-123-4567" }, activeOwner.id);
  assert.equal(phoneMatch.customerAccountId, null);
  assert.equal(phoneMatch.customerMatchMethod, "phone_possible");
  assert.equal(phoneMatch.rewardsEligible, false);
  assert.match(phoneMatch.message, /Enter email/);

  await createVerifiedCustomer({ email: `${unique("collector")}@example.test`, phone });
  const multiplePhoneMatch = await resolvePosCustomerMatch({ customerPhone: "555-123-4567" }, activeOwner.id);
  assert.equal(multiplePhoneMatch.customerAccountId, null);
  assert.equal(multiplePhoneMatch.customerMatchMethod, "phone_multiple");
  assert.equal(multiplePhoneMatch.rewardsEligible, false);
});

test("POS customer matching rejects unverified and inactive accounts", async () => {
  const unverified = await createCustomer({
    email: `${unique("unverified")}@example.test`,
    phone: "+15551110001",
    emailVerifiedAt: null
  });
  const inactive = await createCustomer({
    email: `${unique("inactive")}@example.test`,
    phone: "+15551110002",
    status: "disabled"
  });

  const unverifiedMatch = await resolvePosCustomerMatch({ customerEmail: unverified.email }, activeOwner.id);
  assert.equal(unverifiedMatch.customerAccountId, null);
  assert.equal(unverifiedMatch.customerMatchMethod, "email_unverified");
  assert.equal(unverifiedMatch.rewardsEligible, false);

  const inactiveMatch = await resolvePosCustomerMatch({ customerEmail: inactive.email }, activeOwner.id);
  assert.equal(inactiveMatch.customerAccountId, null);
  assert.equal(inactiveMatch.customerMatchMethod, "email_unverified");
  assert.equal(inactiveMatch.rewardsEligible, false);

  const unverifiedSelection = await resolvePosCustomerMatch({ selectedCustomerAccountId: unverified.id }, activeOwner.id);
  assert.equal(unverifiedSelection.customerAccountId, null);
  assert.equal(unverifiedSelection.customerMatchMethod, "email_unverified");
  assert.equal(unverifiedSelection.rewardsEligible, false);
  assert.match(unverifiedSelection.message, /verified active account/);
});

test("POS customer matching rejects cross-owner customer id email and phone tampering", async () => {
  const firstOwnerId = activeOwner.id;
  await createAdminUser();
  const otherAccount = await createVerifiedCustomer({
    email: `${unique("other-owner-customer")}@example.test`,
    phone: "+15558675309"
  });

  const selected = await resolvePosCustomerMatch({ selectedCustomerAccountId: otherAccount.id }, firstOwnerId);
  const email = await resolvePosCustomerMatch({ customerEmail: otherAccount.email }, firstOwnerId);
  const phone = await resolvePosCustomerMatch({ customerPhone: otherAccount.phone }, firstOwnerId);

  assert.equal(selected.customerAccountId, null);
  assert.equal(email.customerAccountId, null);
  assert.equal(email.customerMatchMethod, "email_not_found");
  assert.equal(phone.customerAccountId, null);
  assert.equal(phone.customerMatchMethod, "phone_not_found");
});

test("POS customer matching keeps email primary and returns minimal admin-safe fields", async () => {
  const emailAccount = await createVerifiedCustomer({
    email: `${unique("email-primary")}@example.test`,
    phone: "+15550001111"
  });
  await createVerifiedCustomer({
    email: `${unique("phone-only")}@example.test`,
    phone: "+15552223333"
  });

  const phoneNoMatch = await resolvePosCustomerMatch({ customerPhone: "555-999-0000" }, activeOwner.id);
  assert.equal(phoneNoMatch.customerAccountId, null);
  assert.equal(phoneNoMatch.customerMatchMethod, "phone_not_found");
  assert.equal(phoneNoMatch.rewardsEligible, false);

  const emailPriority = await resolvePosCustomerMatch({
    customerEmail: emailAccount.email.toUpperCase(),
    customerPhone: "555-222-3333"
  }, activeOwner.id);
  assert.equal(emailPriority.customerAccountId, emailAccount.id);
  assert.equal(emailPriority.customerMatchMethod, "email");
  assert.equal(emailPriority.customerEmail, emailAccount.email);
  assert.equal(emailPriority.customerPhone, "+15552223333");
  assert.equal(emailPriority.rewardsEligible, false);

  assert.deepEqual(Object.keys(emailPriority).sort(), [
    "customerAccountId",
    "customerEmail",
    "customerMatchMethod",
    "customerPhone",
    "displayEmail",
    "displayPhone",
    "message",
    "rewardsEligible"
  ]);
  for (const privateKey of [
    "passwordHash",
    "tokenHash",
    "sessionToken",
    "rewardBalance",
    "rewardLedgerEntries",
    "savedAddresses",
    "address",
    "authenticityNotes"
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(emailPriority, privateKey), false, `unexpected private key ${privateKey}`);
  }
});

test("POS customer matching never resolves an account from another workspace", async () => {
  const ownerA = await createAdminUser();
  const accountA = await createVerifiedCustomer({ email: `${unique("workspace-a")}@example.test`, phone: "+15550001001" });
  const ownerB = await createAdminUser();
  const accountB = await createVerifiedCustomer({ email: `${unique("workspace-b")}@example.test`, phone: "+15550001002" });

  const before = {
    customers: await prisma.customerAccount.count(),
    orders: await prisma.storefrontOrder.count(),
    sales: await prisma.inventorySale.count(),
    rewards: await prisma.rewardLedgerEntry.count(),
    audits: await prisma.auditLog.count()
  };

  const byId = await resolvePosCustomerMatch({ selectedCustomerAccountId: accountA.id }, ownerB.id);
  const byEmail = await resolvePosCustomerMatch({ customerEmail: accountA.email }, ownerB.id);
  const byPhone = await resolvePosCustomerMatch({ customerPhone: accountA.phone }, ownerB.id);
  assert.equal(byId.customerAccountId, null);
  assert.equal(byEmail.customerAccountId, null);
  assert.equal(byPhone.customerAccountId, null);

  const ownMatch = await resolvePosCustomerMatch({ selectedCustomerAccountId: accountB.id }, ownerB.id);
  assert.equal(ownMatch.customerAccountId, accountB.id);
  assert.notEqual(ownerA.id, ownerB.id);
  assert.deepEqual({
    customers: await prisma.customerAccount.count(),
    orders: await prisma.storefrontOrder.count(),
    sales: await prisma.inventorySale.count(),
    rewards: await prisma.rewardLedgerEntry.count(),
    audits: await prisma.auditLog.count()
  }, before, "customer search must not link, award, audit, or create business records");
});

test("POS sale stores optional customer contact and creates no reward ledger while disabled", async () => {
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("buyer")}@example.test`, phone: "+15557654321" });

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("contact-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: account.email,
    customerPhone: "(555) 765-4321"
  });

  assert.equal(receipt.customerLinked, true);
  assert.match(receipt.customerEmail ?? "", /^b\*\*\*@/);
  assert.equal(receipt.customerPhone, "***-***-4321");
  assert.equal(receipt.customerMatchMethod, "email");
  assert.equal(receipt.rewardsEligible, false);

  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference: receipt.saleReference } });
  assert.equal(sale.customerAccountId, account.id);
  assert.equal(sale.customerEmail, account.email);
  assert.equal(sale.customerPhone, "+15557654321");
  assert.equal(sale.customerMatchMethod, "email");
  assert.equal(sale.rewardsEligible, false);
  assert.equal(await prisma.rewardLedgerEntry.count(), 0);
});

test("POS sale ignores browser-supplied customer ownership and reward fields", async () => {
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const linkedAccount = await createVerifiedCustomer({ email: `${unique("linked")}@example.test`, phone: "+15557654322" });
  const otherAccount = await createVerifiedCustomer({ email: `${unique("other")}@example.test`, phone: "+15557654323" });

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("spoofed-contact-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: linkedAccount.email.toUpperCase(),
    customerPhone: "(555) 765-4322",
    customerAccountId: otherAccount.id,
    rewardsEligible: true,
    points: 999
  } as QuotedPosSaleInput & Record<string, unknown>);

  assert.equal(receipt.customerLinked, true);
  assert.match(receipt.customerEmail ?? "", /^l\*\*\*@/);
  assert.equal(receipt.rewardsEligible, false);

  const sale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference: receipt.saleReference } });
  assert.equal(sale.customerAccountId, linkedAccount.id);
  assert.equal(sale.rewardsEligible, false);
  assert.equal(await prisma.rewardLedgerEntry.count(), 0);
});

test("POS sale still works without customer contact", async () => {
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("no-contact-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "zelle"
  });

  assert.equal(receipt.customerLinked, false);
  assert.equal(receipt.customerEmail, null);
  assert.equal(receipt.customerPhone, null);
  assert.equal(receipt.customerMatchMethod, "none");
  assert.equal(receipt.rewardsEligible, false);
  assert.equal(await prisma.rewardLedgerEntry.count(), 0);
});

test("POS rewards award available points once for verified email match when explicitly enabled", async () => {
  setPosRewardsEnabled(true);
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("pos-reward-buyer")}@example.test`, phone: "+15550004444" });
  const idempotencyKey = unique("pos-reward-sale");

  const match = await resolvePosCustomerMatch({ customerEmail: account.email.toUpperCase() }, activeOwner.id);
  assert.equal(match.customerAccountId, account.id);
  assert.equal(match.rewardsEligible, true);

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey,
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: account.email
  });
  const duplicateReceipt = await createQuotedPosSale(user, {
    idempotencyKey,
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: account.email
  });

  assert.equal(duplicateReceipt.saleReference, receipt.saleReference);
  assert.equal(receipt.customerLinked, true);
  assert.equal(receipt.rewardsEligible, true);
  assert.equal(receipt.rewardStatus, "available");
  assert.equal(receipt.rewardPointsEarned, 25);
  assert.equal(receipt.rewardPointsReversed, 0);

  const saleRows = await prisma.inventorySale.findMany({ where: { saleReference: receipt.saleReference } });
  assert.equal(saleRows.length, 1);
  assert.equal(saleRows[0].customerAccountId, account.id);
  assert.equal(saleRows[0].rewardsEligible, true);

  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: { idempotencyKey: `rewards:pos:earn:${receipt.saleReference}` }
  });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].customerAccountId, account.id);
  assert.equal(ledger[0].orderId, null);
  assert.equal(ledger[0].points, 25);
  assert.equal(ledger[0].type, "earn");
  assert.equal(ledger[0].status, "available");
  assert.equal(ledger[0].source, "pos");
  assert.equal(ledger[0].eligibleSubtotalCents, 2500);
  assert.ok(ledger[0].settledAt);
  assert.match(ledger[0].metadataJson ?? "", /Manual POS rewards are available immediately/);

  const balance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: account.id } });
  assert.equal(balance.pendingPoints, 0);
  assert.equal(balance.availablePoints, 25);
  assert.equal(balance.lifetimeEarnedPoints, 25);
});

test("POS selected verified customer account earns rewards without trusting browser reward fields", async () => {
  setPosRewardsEnabled(true);
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("selected-pos-buyer")}@example.test`, phone: "+15550007777" });
  const otherAccount = await createVerifiedCustomer({ email: `${unique("spoofed-selected-pos-buyer")}@example.test`, phone: "+15550008888" });

  const match = await resolvePosCustomerMatch({ selectedCustomerAccountId: account.id }, activeOwner.id);
  assert.equal(match.customerAccountId, account.id);
  assert.equal(match.customerMatchMethod, "email");
  assert.equal(match.rewardsEligible, true);

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("selected-pos-reward-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    selectedCustomerAccountId: account.id,
    customerAccountId: otherAccount.id,
    rewardsEligible: true,
    points: 999
  } as QuotedPosSaleInput & Record<string, unknown>);

  assert.equal(receipt.customerLinked, true);
  assert.match(receipt.customerEmail ?? "", /^s\*\*\*@/);
  assert.equal(receipt.rewardsEligible, true);
  assert.equal(receipt.rewardPointsEarned, 25);
});

test("POS rewards use adjusted subtotal and do not award for phone-only contact", async () => {
  setPosRewardsEnabled(true);
  const user = await createAdminUser();
  const adjustedItem = await createInventoryItem(user.id);
  const phoneOnlyItem = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("adjusted-pos-buyer")}@example.test`, phone: "+15550005555" });

  const adjustedReceipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("adjusted-pos-reward-sale"),
    items: [{
      inventoryItemId: adjustedItem.id,
      quantity: 2,
      adjustedUnitPrice: 19.99,
      discountReason: "customer_discount",
      discountNote: "test discount"
    }],
    paymentMethod: "cash",
    customerEmail: account.email
  });

  assert.equal(adjustedReceipt.subtotal, 50);
  assert.equal(adjustedReceipt.discount, 10.02);
  assert.equal(adjustedReceipt.taxableSubtotal, 39.98);
  assert.equal(adjustedReceipt.rewardPointsEarned, 39);
  const adjustedLedger = await prisma.rewardLedgerEntry.findUniqueOrThrow({
    where: { idempotencyKey: `rewards:pos:earn:${adjustedReceipt.saleReference}` }
  });
  assert.equal(adjustedLedger.eligibleSubtotalCents, 3998);
  assert.equal(adjustedLedger.points, 39);

  const phoneOnlyReceipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("phone-only-no-pos-reward"),
    items: [{ inventoryItemId: phoneOnlyItem.id, quantity: 1 }],
    paymentMethod: "cash",
    customerPhone: "555-000-5555"
  });
  assert.equal(phoneOnlyReceipt.customerLinked, false);
  assert.equal(phoneOnlyReceipt.rewardsEligible, false);
  assert.equal(phoneOnlyReceipt.rewardStatus, "not_eligible");
  assert.equal(phoneOnlyReceipt.rewardPointsEarned, 0);
  assert.equal(await prisma.rewardLedgerEntry.count({ where: { idempotencyKey: `rewards:pos:earn:${phoneOnlyReceipt.saleReference}` } }), 0);
});

test("POS manual refund reverses awarded POS rewards once", async () => {
  setPosRewardsEnabled(true);
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("pos-refund-buyer")}@example.test`, phone: "+15550006666" });

  const receipt = await createQuotedPosSale(user, {
    idempotencyKey: unique("pos-reward-refund-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: account.email
  });
  assert.equal(receipt.rewardPointsEarned, 25);

  const refundedReceipt = await refundPosSale(user, receipt.saleReference, {
    idempotencyKey: "pos-reward-refund-key",
    refundType: "full",
    reason: "customer_return",
    restoreInventory: false
  });
  const duplicateRefundReceipt = await refundPosSale(user, receipt.saleReference, {
    idempotencyKey: "pos-reward-refund-key",
    refundType: "full",
    reason: "customer_return",
    restoreInventory: false
  });

  assert.equal(refundedReceipt.rewardStatus, "reversed");
  assert.equal(refundedReceipt.rewardPointsEarned, 25);
  assert.equal(refundedReceipt.rewardPointsReversed, 25);
  assert.equal(duplicateRefundReceipt.rewardStatus, "reversed");
  const ledger = await prisma.rewardLedgerEntry.findMany({
    where: { idempotencyKey: { in: [`rewards:pos:earn:${receipt.saleReference}`, `rewards:pos:refund:${receipt.saleReference}`] } },
    orderBy: { createdAt: "asc" }
  });
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].points, 25);
  assert.equal(ledger[1].points, -25);
  assert.equal(ledger[1].type, "reverse");
  assert.equal(ledger[1].status, "reversed");
  assert.equal(ledger[1].reversalOfEntryId, ledger[0].id);

  const balance = await prisma.rewardBalance.findUniqueOrThrow({ where: { customerAccountId: account.id } });
  assert.equal(balance.pendingPoints, 0);
  assert.equal(balance.availablePoints, 0);
  assert.equal(balance.lifetimeEarnedPoints, 25);
});

test("POS phone normalization supports common owner-entered formats", () => {
  assert.equal(normalizePosCustomerPhone("(555) 123-4567"), "+15551234567");
  assert.equal(normalizePosCustomerPhone("1-555-123-4567"), "+15551234567");
  assert.equal(normalizePosCustomerPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePosCustomerPhone("123"), null);
});
