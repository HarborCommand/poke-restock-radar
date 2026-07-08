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
const { createPosSale } = radarServiceModule as typeof import("../src/lib/radar-service");
const {
  normalizePosCustomerPhone,
  resolvePosCustomerMatch
} = posCustomerModule as typeof import("../src/lib/pos-customer");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

async function createAdminUser(): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: `${unique("pos-admin")}@example.test`,
      name: "POS Admin",
      role: "ADMIN",
      passwordHash: "test-hash"
    }
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
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

async function createVerifiedCustomer(input: { email: string; phone?: string | null }) {
  return prisma.customerAccount.create({
    data: {
      email: input.email,
      normalizedEmail: input.email.toLowerCase(),
      phone: input.phone ?? null,
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
}

test("POS customer contact matching links verified email but not phone-only contact", async () => {
  const phone = "+15551234567";
  const account = await createVerifiedCustomer({ email: `${unique("collector")}@example.test`, phone });

  const emailMatch = await resolvePosCustomerMatch({ customerEmail: account.email.toUpperCase(), customerPhone: "(555) 123-4567" });
  assert.equal(emailMatch.customerAccountId, account.id);
  assert.equal(emailMatch.customerEmail, account.email);
  assert.equal(emailMatch.customerPhone, phone);
  assert.equal(emailMatch.customerMatchMethod, "email");
  assert.equal(emailMatch.rewardsEligible, false);

  const phoneMatch = await resolvePosCustomerMatch({ customerPhone: "555-123-4567" });
  assert.equal(phoneMatch.customerAccountId, null);
  assert.equal(phoneMatch.customerMatchMethod, "phone_possible");
  assert.equal(phoneMatch.rewardsEligible, false);
  assert.match(phoneMatch.message, /Enter email/);

  await createVerifiedCustomer({ email: `${unique("collector")}@example.test`, phone });
  const multiplePhoneMatch = await resolvePosCustomerMatch({ customerPhone: "555-123-4567" });
  assert.equal(multiplePhoneMatch.customerAccountId, null);
  assert.equal(multiplePhoneMatch.customerMatchMethod, "phone_multiple");
  assert.equal(multiplePhoneMatch.rewardsEligible, false);
});

test("POS sale stores optional customer contact and creates no reward ledger while disabled", async () => {
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);
  const account = await createVerifiedCustomer({ email: `${unique("buyer")}@example.test`, phone: "+15557654321" });

  const receipt = await createPosSale(user, {
    idempotencyKey: unique("contact-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: account.email,
    customerPhone: "(555) 765-4321"
  });

  assert.equal(receipt.customerAccountId, account.id);
  assert.equal(receipt.customerEmail, account.email);
  assert.equal(receipt.customerPhone, "+15557654321");
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

test("POS sale still works without customer contact", async () => {
  const user = await createAdminUser();
  const item = await createInventoryItem(user.id);

  const receipt = await createPosSale(user, {
    idempotencyKey: unique("no-contact-sale"),
    items: [{ inventoryItemId: item.id, quantity: 1 }],
    paymentMethod: "zelle"
  });

  assert.equal(receipt.customerAccountId, null);
  assert.equal(receipt.customerEmail, null);
  assert.equal(receipt.customerPhone, null);
  assert.equal(receipt.customerMatchMethod, "none");
  assert.equal(receipt.rewardsEligible, false);
  assert.equal(await prisma.rewardLedgerEntry.count(), 0);
});

test("POS phone normalization supports common owner-entered formats", () => {
  assert.equal(normalizePosCustomerPhone("(555) 123-4567"), "+15551234567");
  assert.equal(normalizePosCustomerPhone("1-555-123-4567"), "+15551234567");
  assert.equal(normalizePosCustomerPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePosCustomerPhone("123"), null);
});
