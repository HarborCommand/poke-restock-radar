import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { CurrentCustomerAccount } from "../src/lib/customer-account-auth";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-customer-pos-history-"));
const testDbPath = path.join(testDbDir, "customer-pos-history.sqlite");
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
const accountAuthModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-account-auth.ts")).href);
const customerRewardsModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-rewards.ts")).href);
const customerAddressesModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-addresses.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { listCustomerAccountOrders, getCustomerAccountOrderDetail } =
  accountAuthModule as typeof import("../src/lib/customer-account-auth");
const { listCustomerRewardActivity } = customerRewardsModule as typeof import("../src/lib/customer-rewards");
const { createCustomerSavedAddress, updateCustomerSavedAddress, deleteCustomerSavedAddress } =
  customerAddressesModule as typeof import("../src/lib/customer-addresses");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

function currentAccount(account: { id: string; email: string; normalizedEmail: string | null; emailVerifiedAt: Date | null; createdAt: Date }): CurrentCustomerAccount {
  return {
    id: account.id,
    email: account.email,
    normalizedEmail: account.normalizedEmail,
    displayName: null,
    phone: null,
    status: "active",
    sessionRevokedBefore: null,
    emailVerifiedAt: account.emailVerifiedAt,
    lastLoginAt: null,
    createdAt: account.createdAt,
    rewardBalance: null,
    savedAddresses: []
  };
}

async function createCustomer(emailPrefix: string) {
  const email = `${unique(emailPrefix)}@example.test`;
  return prisma.customerAccount.create({
    data: {
      email,
      normalizedEmail: email,
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
}

async function createInventoryItem(input: { name: string; imageUrl?: string | null }) {
  return prisma.inventoryItem.create({
    data: {
      itemType: "product",
      itemName: input.name,
      category: "sealed_packs",
      cost: 10,
      quantity: 10,
      source: "QA fixture",
      purchasedAt: new Date(),
      publicTitle: input.name,
      imageUrl: input.imageUrl ?? null,
      publicImages: input.imageUrl ? JSON.stringify([input.imageUrl]) : null,
      listingStatus: "listed",
      storeStatus: "active"
    }
  });
}

async function createLinkedPosSale(input: {
  customerAccountId: string | null;
  customerEmail?: string | null;
  saleReference: string | null;
  platform?: string;
  grossSale?: number;
  quantity?: number;
  refundStatus?: string | null;
  refundedAmount?: number;
  includeReceiptTotals?: boolean;
}) {
  const item = await createInventoryItem({ name: unique("POS history product"), imageUrl: "https://cdn.example.test/pos-product.webp" });
  const grossSale = input.grossSale ?? 30;
  const quantity = input.quantity ?? 1;
  const includeReceiptTotals = input.includeReceiptTotals ?? true;
  return prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      customerAccountId: input.customerAccountId,
      quantitySold: quantity,
      soldPricePerItem: grossSale / quantity,
      grossSale,
      platform: input.platform ?? "pos",
      fees: 0,
      shippingCost: 0,
      netSale: grossSale,
      costBasis: 12,
      profitLoss: grossSale - 12,
      saleReference: input.saleReference,
      paymentMethod: "zelle",
      paymentReference: "PRIVATE-ZELLE-REFERENCE",
      customerEmail: input.customerEmail ?? null,
      rewardsEligible: Boolean(input.customerAccountId),
      refundStatus: input.refundStatus ?? null,
      refundedAmount: input.refundedAmount ?? 0,
      refundedAt: input.refundedAmount ? new Date() : null,
      soldAt: new Date(),
      notes: includeReceiptTotals
        ? [
            `POS sale ${input.saleReference ?? "legacy"}.`,
            "Payment reference: PRIVATE-ZELLE-REFERENCE.",
            "POS subtotal: $55.00.",
            "POS tax: $3.30.",
            "POS total: $58.30."
          ].join("\n")
        : [`POS sale ${input.saleReference ?? "legacy"}.`, "Payment reference: PRIVATE-ZELLE-REFERENCE."].join("\n")
    }
  });
}

test("linked POS sales appear in customer purchase history without exposing private sale fields", async () => {
  const accountRecord = await createCustomer("claudio");
  const otherAccount = await createCustomer("other");
  const account = currentAccount(accountRecord);
  const onlineItem = await createInventoryItem({ name: "Online order item", imageUrl: "https://cdn.example.test/online.webp" });
  const saleReference = unique("POS-HISTORY");

  await prisma.storefrontOrder.create({
    data: {
      orderNumber: unique("GDG"),
      customerAccountId: account.id,
      customerEmail: account.email,
      status: "paid",
      paymentStatus: "paid",
      fulfillmentStatus: "shipped",
      subtotal: 40,
      shippingCharged: 5,
      tax: 0,
      total: 45,
      isTestOrder: false,
      items: {
        create: {
          inventoryItemId: onlineItem.id,
          publicTitle: "Online order item",
          publicSlug: "online-order-item",
          imageUrl: "https://cdn.example.test/online.webp",
          quantity: 1,
          unitPrice: 40,
          lineTotal: 40
        }
      }
    }
  });

  await createLinkedPosSale({ customerAccountId: account.id, customerEmail: account.email, saleReference, grossSale: 25 });
  await createLinkedPosSale({ customerAccountId: account.id, customerEmail: account.email, saleReference, grossSale: 30 });
  const noTaxSale = await createLinkedPosSale({
    customerAccountId: account.id,
    customerEmail: account.email,
    saleReference: unique("NO-TAX"),
    grossSale: 12,
    includeReceiptTotals: false
  });
  const unlinkedSale = await createLinkedPosSale({
    customerAccountId: null,
    customerEmail: account.email,
    saleReference: unique("UNLINKED"),
    grossSale: 99
  });
  await createLinkedPosSale({ customerAccountId: otherAccount.id, customerEmail: otherAccount.email, saleReference: unique("OTHER"), grossSale: 88 });
  await createLinkedPosSale({ customerAccountId: account.id, customerEmail: account.email, saleReference: unique("SMOKE"), platform: "test", grossSale: 77 });
  const refundedSale = await createLinkedPosSale({
    customerAccountId: account.id,
    customerEmail: account.email,
    saleReference: unique("REFUNDED"),
    grossSale: 20,
    refundStatus: "refunded",
    refundedAmount: 20
  });

  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: account.id,
      points: 18,
      type: "earn",
      reason: "Admin-linked POS sale eligible subtotal",
      status: "available",
      source: "admin_pos_link_backfill",
      idempotencyKey: `rewards:backfill:pos:${saleReference}`,
      metadataJson: JSON.stringify({ saleKey: saleReference, saleReference })
    }
  });

  const history = await listCustomerAccountOrders(account);
  const linkedPos = history.find((purchase) => purchase.detailKey === `pos:${saleReference}`);
  const online = history.find((purchase) => purchase.sourceType === "online");
  const refunded = history.find((purchase) => purchase.detailKey === `pos:${refundedSale.saleReference}`);

  assert.equal(history.length, 4);
  assert.ok(online, "online order should remain visible");
  assert.ok(linkedPos, "linked POS sale should be visible");
  assert.equal(linkedPos.sourceType, "pos");
  assert.equal(linkedPos.sourceLabel, "In-Store Purchase");
  assert.equal(linkedPos.itemCount, 2);
  assert.equal(linkedPos.totalPaid, 58.3);
  assert.equal(linkedPos.rewardsEarned, 18);
  assert.ok(refunded, "refunded POS sale should remain visible");
  assert.equal(refunded.status, "Refunded");
  assert.equal(refunded.refundedAmount, 20);

  assert.equal(history.some((purchase) => purchase.displayReference.includes("UNLINKED")), false);
  assert.equal(history.some((purchase) => purchase.displayReference.includes("OTHER")), false);
  assert.equal(history.some((purchase) => purchase.displayReference.includes("SMOKE")), false);

  const detail = await getCustomerAccountOrderDetail(account, `pos:${saleReference}`);
  assert.ok(detail);
  assert.equal(detail.sourceType, "pos");
  assert.equal(detail.paymentMethodLabel, "Zelle");
  assert.equal(detail.subtotal, 55);
  assert.equal(detail.tax, 3.3);
  assert.equal(detail.totalPaid, 58.3);
  assert.equal(detail.items.length, 2);
  assert.equal(detail.rewardsEarned, 18);

  const noTaxDetail = await getCustomerAccountOrderDetail(account, `pos:${noTaxSale.saleReference}`);
  assert.ok(noTaxDetail);
  assert.equal(noTaxDetail.subtotal, 12);
  assert.equal(noTaxDetail.tax, null);
  assert.equal(noTaxDetail.totalPaid, 12);

  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /PRIVATE-ZELLE-REFERENCE|costBasis|profitLoss|roiPercent|stockLot|customerAccountId|customerLinkNote|admin/i);
  assert.equal(await getCustomerAccountOrderDetail(account, `pos:${unlinkedSale.saleReference}`), null);
  assert.equal(await getCustomerAccountOrderDetail(currentAccount(otherAccount), `pos:${saleReference}`), null);
});

test("online order detail never crosses an existing customer link", async () => {
  const accountARecord = await createCustomer("online-a");
  const accountBRecord = await createCustomer("online-b");
  const accountA = currentAccount(accountARecord);
  const item = await createInventoryItem({ name: unique("Online isolation item") });

  async function createOrder(input: { customerAccountId: string | null; customerEmail: string; orderNumber: string }) {
    return prisma.storefrontOrder.create({
      data: {
        orderNumber: input.orderNumber,
        customerAccountId: input.customerAccountId,
        customerEmail: input.customerEmail,
        status: "paid",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        subtotal: 20,
        shippingCharged: 0,
        tax: 0,
        total: 20,
        isTestOrder: false,
        items: {
          create: {
            inventoryItemId: item.id,
            publicTitle: "Online isolation item",
            publicSlug: unique("online-isolation"),
            quantity: 1,
            unitPrice: 20,
            lineTotal: 20
          }
        }
      }
    });
  }

  const own = await createOrder({ customerAccountId: accountA.id, customerEmail: accountA.email, orderNumber: unique("GDG-A") });
  const other = await createOrder({ customerAccountId: accountBRecord.id, customerEmail: accountA.email, orderNumber: unique("GDG-B") });
  const legacy = await createOrder({ customerAccountId: null, customerEmail: accountA.email, orderNumber: unique("GDG-LEGACY") });

  assert.ok(await getCustomerAccountOrderDetail(accountA, own.orderNumber));
  assert.equal(await getCustomerAccountOrderDetail(accountA, other.orderNumber), null);
  assert.ok(await getCustomerAccountOrderDetail(accountA, legacy.orderNumber));
  assert.equal(await getCustomerAccountOrderDetail(currentAccount(accountBRecord), own.orderNumber), null);
  assert.equal(await getCustomerAccountOrderDetail(accountA, unique("GDG-MISSING")), null);
});

test("reward activity is account-scoped, bounded, and omits internal metadata", async () => {
  const accountARecord = await createCustomer("rewards-a");
  const accountBRecord = await createCustomer("rewards-b");
  const accountA = currentAccount(accountARecord);

  await prisma.rewardLedgerEntry.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      customerAccountId: accountA.id,
      points: 1,
      type: "earn",
      status: "available",
      source: "admin_adjustment",
      reason: `PRIVATE-REASON-${index}`,
      idempotencyKey: unique(`private-key-${index}`),
      metadataJson: JSON.stringify({ private: true, index }),
      createdAt: new Date(Date.now() + index)
    }))
  });
  await prisma.rewardLedgerEntry.create({
    data: {
      customerAccountId: accountBRecord.id,
      points: 999,
      type: "earn",
      status: "available",
      source: "admin_adjustment",
      reason: "OTHER-CUSTOMER-PRIVATE-REASON",
      idempotencyKey: unique("other-private-key")
    }
  });

  const activity = await listCustomerRewardActivity(accountA, 500);
  assert.equal(activity.length, 50);
  assert.equal(activity.every((entry) => entry.points === 1 && entry.sourceType === "adjustment"), true);
  assert.doesNotMatch(JSON.stringify(activity), /PRIVATE-REASON|private-key|metadataJson|idempotencyKey|999/);
});

test("saved address writes stay inside the authenticated account", async () => {
  const accountARecord = await createCustomer("address-a");
  const accountBRecord = await createCustomer("address-b");
  const accountA = currentAccount(accountARecord);
  const accountB = currentAccount(accountBRecord);
  const addressB = await createCustomerSavedAddress(accountB, {
    name: "Private B",
    street1: "2 Private St",
    city: "Miami",
    state: "FL",
    zip: "33101",
    country: "US"
  });

  await assert.rejects(
    updateCustomerSavedAddress(accountA, addressB.id, {
      name: "Cross-account change",
      street1: "1 Wrong St",
      city: "Miami",
      state: "FL",
      zip: "33101",
      country: "US"
    }),
    /not found/i
  );
  await assert.rejects(deleteCustomerSavedAddress(accountA, addressB.id), /not found/i);

  const persisted = await prisma.customerSavedAddress.findUnique({ where: { id: addressB.id } });
  assert.equal(persisted?.customerAccountId, accountB.id);
  assert.equal(persisted?.street1, "2 Private St");
});
