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
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-inventory-adjustments-"));
const testDbPath = path.join(testDbDir, "inventory-adjustments.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const radarModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/radar-service.ts")).href);
const validationModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/validation.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { adjustInventoryStock } = radarModule as typeof import("../src/lib/radar-service");
const { inventoryAdjustmentSchema } = validationModule as typeof import("../src/lib/validation");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;

function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source start: ${startNeedle}`);
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : source.length;
  assert.notEqual(end, -1, `Missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

async function createAdmin(): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: `${unique("admin")}@example.test`,
      name: "Inventory Admin",
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

async function createItem(userId: string, lots: Array<{ quantity: number; remainingQuantity: number; costPerUnit: number }>) {
  const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const totalCost = lots.reduce((sum, lot) => sum + lot.quantity * lot.costPerUnit, 0);
  const item = await prisma.inventoryItem.create({
    data: {
      userId,
      itemType: "product",
      itemName: unique("Booster Box"),
      category: "booster_boxes",
      cost: quantity > 0 ? totalCost / quantity : 0,
      quantity,
      totalCost,
      source: "Distributor",
      purchasedAt: new Date("2026-01-01T00:00:00Z")
    }
  });
  for (const [index, lot] of lots.entries()) {
    await prisma.inventoryStockLot.create({
      data: {
        inventoryItemId: item.id,
        purchasedAt: new Date(Date.UTC(2026, 0, index + 1)),
        source: `Lot ${index + 1}`,
        quantity: lot.quantity,
        costPerUnit: lot.costPerUnit,
        totalCost: lot.quantity * lot.costPerUnit,
        remainingQuantity: lot.remainingQuantity
      }
    });
  }
  return item;
}

test("quick add stock creates an immutable adjustment, stock lot, and one audit record", async () => {
  const admin = await createAdmin();
  const item = await createItem(admin.id, [{ quantity: 2, remainingQuantity: 2, costPerUnit: 10 }]);

  const result = await adjustInventoryStock(admin, item.id, {
    action: "add",
    quantity: 3,
    reason: "new_purchase_restock",
    unitCost: 12,
    note: "private receiving note",
    idempotencyKey: "add-stock-key-1"
  }, "req-add-1");

  assert.equal(result.duplicate, false);
  assert.equal(result.item.quantityOwned, 5);
  assert.equal(result.adjustment.quantityDelta, 3);
  assert.equal(result.adjustment.quantityBefore, 2);
  assert.equal(result.adjustment.quantityAfter, 5);
  assert.equal(result.adjustment.unitCostCents, 1200);
  assert.equal(result.adjustment.hasPrivateNote, true);
  assert.equal(result.item.stockAdjustments?.length, 1);

  const lots = await prisma.inventoryStockLot.findMany({ where: { inventoryItemId: item.id }, orderBy: { createdAt: "asc" } });
  assert.equal(lots.length, 2);
  assert.equal(lots.at(-1)?.quantity, 3);
  assert.equal(lots.at(-1)?.remainingQuantity, 3);
  assert.equal(await prisma.auditLog.count({ where: { action: "inventory.stock_adjusted", entityId: item.id } }), 1);
});

test("quick remove stock consumes FIFO lots and preserves historical sale cost basis", async () => {
  const admin = await createAdmin();
  const item = await createItem(admin.id, [
    { quantity: 2, remainingQuantity: 1, costPerUnit: 10 },
    { quantity: 3, remainingQuantity: 3, costPerUnit: 20 }
  ]);
  const sale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      userId: admin.id,
      quantitySold: 1,
      soldPricePerItem: 30,
      grossSale: 30,
      platform: "local",
      netSale: 30,
      costBasis: 10,
      profitLoss: 20,
      soldAt: new Date()
    }
  });

  const result = await adjustInventoryStock(admin, item.id, {
    action: "remove",
    quantity: 2,
    reason: "damaged",
    idempotencyKey: "remove-stock-key-1"
  }, "req-remove-1");

  assert.equal(result.item.quantityOwned, 2);
  assert.equal(result.adjustment.quantityDelta, -2);
  const lots = await prisma.inventoryStockLot.findMany({ where: { inventoryItemId: item.id }, orderBy: { purchasedAt: "asc" } });
  assert.deepEqual(lots.map((lot) => lot.remainingQuantity), [0, 2]);
  const persistedSale = await prisma.inventorySale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(persistedSale.costBasis, 10);
  assert.equal(persistedSale.quantitySold, 1);
});

test("duplicate adjustment submissions return the original result without double-writing stock or audit", async () => {
  const admin = await createAdmin();
  const item = await createItem(admin.id, [{ quantity: 4, remainingQuantity: 4, costPerUnit: 8 }]);
  const input = {
    action: "remove" as const,
    quantity: 1,
    reason: "inventory_correction",
    idempotencyKey: "duplicate-remove-key"
  };

  const first = await adjustInventoryStock(admin, item.id, input, "req-dup-1");
  const second = await adjustInventoryStock(admin, item.id, input, "req-dup-2");

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.adjustment.id, second.adjustment.id);
  assert.equal((await prisma.inventoryStockLot.findFirstOrThrow({ where: { inventoryItemId: item.id } })).remainingQuantity, 3);
  assert.equal(await prisma.inventoryAdjustment.count({ where: { inventoryItemId: item.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "inventory.stock_adjusted", entityId: item.id } }), 1);
});

test("quick remove rejects negative inventory and does not create revenue, rewards, or tax records", async () => {
  const admin = await createAdmin();
  const item = await createItem(admin.id, [{ quantity: 1, remainingQuantity: 1, costPerUnit: 10 }]);
  const before = {
    sales: await prisma.inventorySale.count(),
    rewards: await prisma.rewardLedgerEntry.count(),
    tax: await prisma.taxAdjustment.count()
  };

  await assert.rejects(
    () => adjustInventoryStock(admin, item.id, {
      action: "remove",
      quantity: 2,
      reason: "lost",
      idempotencyKey: "negative-remove-key"
    }, "req-negative-1"),
    /Cannot remove 2\. Only 1 on hand/
  );

  assert.equal(await prisma.inventoryAdjustment.count({ where: { inventoryItemId: item.id } }), 0);
  assert.equal((await prisma.inventoryStockLot.findFirstOrThrow({ where: { inventoryItemId: item.id } })).remainingQuantity, 1);
  assert.equal(await prisma.inventorySale.count(), before.sales);
  assert.equal(await prisma.rewardLedgerEntry.count(), before.rewards);
  assert.equal(await prisma.taxAdjustment.count(), before.tax);
});

test("concurrent deductions serialize so stock never goes below zero", async () => {
  const admin = await createAdmin();
  const item = await createItem(admin.id, [{ quantity: 1, remainingQuantity: 1, costPerUnit: 10 }]);
  const attempts = await Promise.allSettled([
    adjustInventoryStock(admin, item.id, { action: "remove", quantity: 1, reason: "inventory_correction", idempotencyKey: "concurrent-a" }, "req-concurrent-a"),
    adjustInventoryStock(admin, item.id, { action: "remove", quantity: 1, reason: "inventory_correction", idempotencyKey: "concurrent-b" }, "req-concurrent-b")
  ]);
  const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");

  assert.equal(fulfilled.length, 1);
  assert.equal((await prisma.inventoryStockLot.findFirstOrThrow({ where: { inventoryItemId: item.id } })).remainingQuantity, 0);
  assert.equal(await prisma.inventoryAdjustment.count({ where: { inventoryItemId: item.id } }), 1);
});

test("inventory adjustment schema enforces approved reasons", () => {
  assert.equal(inventoryAdjustmentSchema.parse({
    action: "add",
    quantity: 1,
    reason: "customer_return",
    idempotencyKey: "schema-add-key"
  }).reason, "customer_return");
  assert.throws(() => inventoryAdjustmentSchema.parse({
    action: "remove",
    quantity: 1,
    reason: "new_purchase_restock",
    idempotencyKey: "schema-bad-key"
  }));
});

test("route and UI keep stock adjustments admin-only, same-origin, idempotent, and mobile-safe", () => {
  const route = readFileSync(path.join(projectRoot, "src/app/api/radar/inventory/[itemId]/adjustments/route.ts"), "utf8");
  const app = readFileSync(path.join(projectRoot, "src/components/RadarApp.tsx"), "utf8");
  const css = readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");
  const service = readFileSync(path.join(projectRoot, "src/lib/radar-service.ts"), "utf8");
  const panel = sourceSlice(app, "function InventoryQuickStockAdjustmentPanel", "function InventoryEditStockLotModal");
  const workspaceShell = sourceSlice(app, "function ProductWorkspaceShell", "function ProductWorkspaceAuthenticityProofCard");
  const history = sourceSlice(app, "function InventoryAdjustmentHistoryList", "function InventoryQuickStockAdjustmentPanel");
  assert.match(route, /authorizeAdminMutation\(request, user\)/);
  assert.match(route, /withRequestId\(privateOk\(result/);
  assert.match(route, /safeMutationError/);
  assert.match(service, /lockInventoryItemForAdjustment/);
  assert.match(service, /idempotencyKey: scopedIdempotencyKey/);
  assert.match(service, /action: "inventory\.stock_adjusted"/);
  assert.match(app, /Add Stock/);
  assert.match(app, /Remove Stock/);
  assert.match(app, /Adjustment History/);
  assert.match(panel, /<small>Current<\/small>/);
  assert.match(panel, /<small>Adjustment<\/small>/);
  assert.match(panel, /<small>Result<\/small>/);
  assert.equal((panel.match(/inventory-adjustment-summary-flow/g) ?? []).length, 1);
  assert.equal((panel.match(/aria-label="Stock adjustment action"/g) ?? []).length, 1);
  assert.match(workspaceShell, /label: "Adjust Stock"/);
  assert.doesNotMatch(workspaceShell, /label: "Remove Stock"/);
  assert.match(panel, /action === "add" \? \(/);
  assert.match(panel, /name="unitCost"/);
  assert.match(panel, /Unit cost per unit \(\$\)/);
  assert.match(panel, /remove-mode/);
  assert.match(panel, /Private note \(optional, admin-only\)/);
  assert.match(panel, /rows=\{2\}/);
  assert.match(panel, /resultingQuantity/);
  assert.match(panel, /inventory-adjustment-low-stock/);
  assert.match(panel, /limit=\{5\} compact/);
  assert.match(history, /hasPrivateNote \? "Private note saved" : "No private note"/);
  assert.doesNotMatch(history, /adjustment\.note/);
  assert.match(history, /className="inventory-adjustment-history-card"/);
  assert.match(history, /adjustment\.quantityDelta >= 0 \? "\+" : "-"/);
  assert.match(history, /Before \{adjustment\.quantityBefore\} → After \{adjustment\.quantityAfter\}/);
  assert.match(history, /title=\{`Actor \$\{adjustment\.actorLabel\}\. Reference \$\{adjustment\.referenceId\}`\}/);
  assert.match(history, /adjustment\.referenceId\.slice\(0, 4\).*adjustment\.referenceId\.slice\(-4\)/);
  assert.match(css, /body \.inventory-quick-adjustment-sheet \{[\s\S]*width: min\(1240px, 100%\);/);
  assert.match(css, /body \.inventory-adjustment-layout \{[\s\S]*grid-template-columns: minmax\(0, 1\.55fr\) minmax\(360px, 1fr\);/);
  assert.match(css, /body \.product-workspace-content \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/);
  assert.match(css, /body \.inventory-adjustment-summary-card \{[\s\S]*position: sticky;/);
  assert.match(css, /body \.inventory-adjustment-history\.compact article\.inventory-adjustment-history-card \{[\s\S]*grid-template-columns: minmax\(72px, auto\) auto minmax\(0, 1fr\);/);
  assert.match(css, /body \.inventory-adjustment-history\.compact article\.inventory-adjustment-history-card strong,[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/);
  assert.match(css, /body \.inventory-adjustment-history\.compact article\.inventory-adjustment-history-card span:nth-of-type\(2\) \{[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(css, /body \.inventory-adjustment-history\.compact article\.inventory-adjustment-history-card small \{[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(css, /body \.inventory-adjustment-main-inputs \{[\s\S]*grid-template-columns:/);
  assert.match(css, /body \.inventory-adjustment-note \{[\s\S]*min-height: 58px;[\s\S]*resize: vertical;/);
  assert.match(css, /@media \(max-width: 980px\)\s*\{[\s\S]*body \.inventory-adjustment-layout \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*body \.inventory-adjustment-actions \{[\s\S]*position: sticky;[\s\S]*safe-area-inset-bottom/);
  assert.match(app, /Sold outside POS/);
  assert.match(app, /390|430|inventory-quick-adjustment-sheet|product-workspace/);
});
