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
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-pos-inventory-locations-"));
const testDbPath = path.join(testDbDir, "pos-inventory-locations.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.POS_SALES_TAX_ENABLED = "false";
process.env.CUSTOMER_ACCOUNTS_ENABLED = "false";
process.env.CUSTOMER_REWARDS_ENABLED = "false";
process.env.CUSTOMER_POS_REWARDS_ENABLED = "false";
process.env.CUSTOMER_REWARD_REDEMPTION_ENABLED = "false";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const radarServiceModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/radar-service.ts")).href);
const locationModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/inventory-physical-location.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { createPosSale, quotePosSaleTax } = radarServiceModule as typeof import("../src/lib/radar-service");
const {
  getInventoryPhysicalLocationBalance,
  transferInventoryPhysicalQuantity
} = locationModule as typeof import("../src/lib/inventory-physical-location");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

async function createAdmin(): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: `${unique("pos-location-admin")}@example.test`,
      name: "POS Location Admin",
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

test("POS sale of 2 units consumes Store stock and preserves Warehouse quantity", async () => {
  const user = await createAdmin();
  const item = await prisma.inventoryItem.create({
    data: {
      userId: user.id,
      itemType: "product",
      itemName: "Pokemon First Partner Illustration Collection Series 2",
      category: "collection_boxes",
      cost: 20,
      quantity: 3,
      source: "Distributor",
      purchasedAt: new Date(),
      publicPrice: 34.99,
      targetSellPrice: 34.99,
      listingStatus: "listed",
      publishToStore: false,
      storeStatus: "draft",
      localPickupAvailable: true,
      shippingAvailable: true
    }
  });
  await prisma.inventoryStockLot.create({
    data: {
      inventoryItemId: item.id,
      purchasedAt: new Date(),
      source: "Distributor",
      quantity: 3,
      costPerUnit: 20,
      totalCost: 60,
      remainingQuantity: 3
    }
  });
  await transferInventoryPhysicalQuantity(item.id, "IN_STORE", "WAREHOUSE", 1, 3);

  const before = await getInventoryPhysicalLocationBalance(item.id, 3);
  assert.equal(before.inStoreQuantity, 2);
  assert.equal(before.warehouseQuantity, 1);

  const idempotencyKey = unique("pos-location-sale");
  const items = [{ inventoryItemId: item.id, quantity: 2 }];
  const quote = await quotePosSaleTax(user, { idempotencyKey, items });
  const receipt = await createPosSale(user, { idempotencyKey, quoteId: quote.quoteId, items, paymentMethod: "cash" });
  const duplicateReceipt = await createPosSale(user, { idempotencyKey, quoteId: quote.quoteId, items, paymentMethod: "cash" });

  assert.equal(duplicateReceipt.saleReference, receipt.saleReference);
  assert.equal(await prisma.inventorySale.count({ where: { saleReference: receipt.saleReference } }), 1);
  assert.equal((await prisma.inventoryStockLot.findFirstOrThrow({ where: { inventoryItemId: item.id } })).remainingQuantity, 1);

  const after = await getInventoryPhysicalLocationBalance(item.id, 1);
  assert.equal(after.inStoreQuantity, 0);
  assert.equal(after.warehouseQuantity, 1);
});
