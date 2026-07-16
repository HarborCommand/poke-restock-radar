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
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-pos-tax-quote-"));
const testDbPath = path.join(testDbDir, "pos-tax-quote.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.VERCEL_ENV = "preview";
process.env.AUTH_SECRET = "pos-tax-quote-test-secret-with-at-least-thirty-two-characters";
process.env.POS_SALES_TAX_ENABLED = "true";
process.env.ONLINE_STRIPE_TAX_ENABLED = "false";
process.env.TAX_EXEMPT_SALES_ENABLED = "false";
process.env.TAX_REPORTING_ENABLED = "false";
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
const stripeTaxModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/stripe-tax.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { createPosSale, quotePosSaleTax, refundPosSale } = radarServiceModule as typeof import("../src/lib/radar-service");
const { setStripeTaxClientForTests } = stripeTaxModule as typeof import("../src/lib/stripe-tax");
let calculationCounter = 0;
const calculations = new Map<string, Array<{ id: string; reference: string; amount: number; amount_tax: number }>>();
const calculationShipping = new Map<string, { amount: number; amount_tax: number } | null>();
setStripeTaxClientForTests({ tax: {
  calculations: { create: async (payload: { line_items: Array<{ amount: number; quantity: number; reference: string }>; shipping_cost?: { amount: number } }) => {
    const id = `taxcalc_test_${++calculationCounter}`;
    const lines = payload.line_items.map((line, index) => ({ id: `tax_li_calc_${calculationCounter}_${index}`, reference: line.reference, amount: line.amount, amount_tax: Math.round(line.amount * 0.07), quantity: line.quantity }));
    calculations.set(id, lines);
    const shippingAmount = payload.shipping_cost?.amount ?? 0;
    const shippingTax = Math.round(shippingAmount * 0.07);
    const tax = lines.reduce((sum, line) => sum + line.amount_tax, 0) + shippingTax;
    calculationShipping.set(id, shippingAmount ? { amount: shippingAmount, amount_tax: shippingTax } : null);
    return { id, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 300, tax_amount_exclusive: tax, tax_amount_inclusive: 0,
      shipping_cost: shippingAmount ? { amount: shippingAmount, amount_tax: shippingTax } : null, line_items: { data: lines },
      tax_breakdown: [{ amount: tax, taxable_amount: lines.reduce((sum, line) => sum + line.amount, 0) + shippingAmount, taxability_reason: "standard_rated", tax_rate_details: { country: "US", state: "FL", percentage_decimal: "7.0", tax_type: "sales_tax" } }] };
  } },
  transactions: {
    createFromCalculation: async (payload: { calculation: string; reference: string }) => ({
      id: `tax_transaction_${payload.calculation}`,
      livemode: false,
      reference: payload.reference,
      shipping_cost: calculationShipping.get(payload.calculation) ?? null,
      line_items: { data: (calculations.get(payload.calculation) ?? []).map((line, index) => ({ ...line, id: `tax_li_transaction_${calculationCounter}_${index}` })) }
    }),
    createReversal: async (payload: { reference: string; original_transaction: string }) => ({
      id: `tax_reversal_${++calculationCounter}`,
      livemode: false,
      reference: payload.reference,
      reversal: { original_transaction: payload.original_transaction }
    })
  },
  registrations: { list: async () => ({ data: [{ country: "US", status: "active", country_options: { us: { state: "FL" } } }] }) }
} } as never);

test.after(async () => {
  setStripeTaxClientForTests(null);
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let uniqueCounter = 0;
function unique(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

test("stale signed POS quotes roll back cleanly and duplicate finalize is once-only", async () => {
  const userRecord = await prisma.user.create({
    data: { email: `${unique("pos-tax-admin")}@example.test`, name: "POS Tax Admin", role: "ADMIN", passwordHash: "test-hash" }
  });
  const user: SessionUser = {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
  await prisma.storefrontSettings.create({
    data: {
      userId: user.id,
      storeCountry: "US",
      storeState: "FL",
      storeCounty: "Preview County",
      storeAddressLine1: "100 Test Way",
      storeCity: "Orlando",
      storePostalCode: "32801",
      stateTaxRateBasisPoints: 600,
      countyTaxRateBasisPoints: 100,
      taxProfileEffectiveAt: new Date("2026-07-01T00:00:00.000Z"),
      taxProfileSourceNote: "Disposable Preview rate fixture",
      posTaxEnabled: true,
      taxExemptSalesEnabled: false
    }
  });
  const createItem = async (name: string, taxableOverride: boolean | null = true) => {
    const item = await prisma.inventoryItem.create({ data: {
      userId: user.id,
      itemType: "product",
      itemName: `${name} ${unique("fixture")}`,
      category: "sealed_packs",
      cost: 10,
      quantity: 20,
      source: "Disposable Preview QA",
      purchasedAt: new Date(),
      publicPrice: 25,
      targetSellPrice: 25,
      taxableOverride,
      taxCategory: "general_tangible_goods",
      listingStatus: "listed",
      publishToStore: false,
      storeStatus: "draft",
      localPickupAvailable: true,
      shippingAvailable: true
    } });
    await prisma.inventoryStockLot.create({
      data: {
        inventoryItemId: item.id,
        purchasedAt: new Date(),
        source: "Disposable Preview QA",
        quantity: 20,
        costPerUnit: 10,
        totalCost: 200,
        remainingQuantity: 20
      }
    });
    return item;
  };
  const taxableItem = await createItem("Taxable item");
  const nonTaxableItem = await createItem("Non-taxable item", false);

  const assertNoSaleMutation = async () => {
    const items = await prisma.inventoryItem.findMany({ where: { id: { in: [taxableItem.id, nonTaxableItem.id] } }, orderBy: { id: "asc" } });
    assert.deepEqual(items.map((item) => item.quantity), [20, 20]);
    const lots = await prisma.inventoryStockLot.findMany({ where: { inventoryItemId: { in: [taxableItem.id, nonTaxableItem.id] } }, orderBy: { id: "asc" } });
    assert.deepEqual(lots.map((lot) => lot.remainingQuantity), [20, 20]);
    assert.equal(await prisma.inventorySale.count(), 0);
    assert.equal(await prisma.rewardLedgerEntry.count(), 0);
    assert.equal(await prisma.taxAdjustment.count(), 0);
  };
  type PosSaleItem = Parameters<typeof quotePosSaleTax>[1]["items"][number];
  const quote = (idempotencyKey: string, items: PosSaleItem[] = [{ inventoryItemId: taxableItem.id, quantity: 1 }]) =>
    quotePosSaleTax(user, { idempotencyKey, items });
  const finalize = (idempotencyKey: string, quoteId: string, items: PosSaleItem[] = [{ inventoryItemId: taxableItem.id, quantity: 1 }]) =>
    createPosSale(user, { idempotencyKey, quoteId, items, paymentMethod: "cash" });

  const quantityKey = unique("quantity-change");
  const quantityQuote = await quote(quantityKey);
  await assert.rejects(finalize(quantityKey, quantityQuote.quoteId, [{ inventoryItemId: taxableItem.id, quantity: 2 }]), /stale/i);
  await assertNoSaleMutation();

  const removedKey = unique("removed-item");
  const removedQuote = await quote(removedKey, [
    { inventoryItemId: taxableItem.id, quantity: 1 },
    { inventoryItemId: nonTaxableItem.id, quantity: 1 }
  ]);
  await assert.rejects(finalize(removedKey, removedQuote.quoteId), /stale/i);
  await assertNoSaleMutation();

  const discountKey = unique("discount-change");
  const discountQuote = await quote(discountKey);
  await assert.rejects(
    finalize(discountKey, discountQuote.quoteId, [{
      inventoryItemId: taxableItem.id,
      quantity: 1,
      adjustedUnitPrice: 20,
      discountReason: "owner_override"
    }]),
    /stale/i
  );
  await assertNoSaleMutation();

  const rateKey = unique("tax-code-change");
  const rateQuote = await quote(rateKey);
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { defaultStripeTaxCode: "txcd_92010001" } });
  await assert.rejects(finalize(rateKey, rateQuote.quoteId), /stale/i);
  await assertNoSaleMutation();
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { defaultStripeTaxCode: "txcd_99999999" } });

  const jurisdictionKey = unique("jurisdiction-change");
  const jurisdictionQuote = await quote(jurisdictionKey);
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { storeCounty: "Other Preview County" } });
  await assert.rejects(finalize(jurisdictionKey, jurisdictionQuote.quoteId), /stale/i);
  await assertNoSaleMutation();
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { storeCounty: "Preview County" } });

  const priceKey = unique("price-change");
  const priceQuote = await quote(priceKey);
  await prisma.inventoryItem.update({ where: { id: taxableItem.id }, data: { publicPrice: 30 } });
  await assert.rejects(finalize(priceKey, priceQuote.quoteId), /stale/i);
  await assertNoSaleMutation();
  await prisma.inventoryItem.update({ where: { id: taxableItem.id }, data: { publicPrice: 25 } });

  const profileKey = unique("profile-change");
  const profileQuote = await quote(profileKey);
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { posTaxEnabled: false } });
  await assert.rejects(finalize(profileKey, profileQuote.quoteId), /provider profile|enabled/i);
  await assertNoSaleMutation();
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { posTaxEnabled: true } });

  const replayKey = unique("replay-source");
  const replayQuote = await quote(replayKey);
  await assert.rejects(finalize(unique("replay-target"), replayQuote.quoteId), /stale/i);
  await assertNoSaleMutation();

  const validKey = unique("valid-finalize");
  const validQuote = await quote(validKey);
  assert.equal(validQuote.merchandiseSubtotal, 25);
  assert.equal(validQuote.taxableSubtotal, 25);
  assert.equal(validQuote.stateTax, 1.75);
  assert.equal(validQuote.countySurtax, 0);
  assert.equal(validQuote.tax, 1.75);
  assert.equal(validQuote.total, 26.75);
  const receipt = await finalize(validKey, validQuote.quoteId);
  await prisma.storefrontSettings.update({ where: { userId: user.id }, data: { posTaxEnabled: false } });
  const duplicateReceipt = await finalize(validKey, validQuote.quoteId);
  assert.equal(duplicateReceipt.saleReference, receipt.saleReference);
  assert.equal(receipt.total, 26.75);
  assert.equal(await prisma.inventorySale.count(), 1);
  assert.equal(await prisma.rewardLedgerEntry.count(), 0);
  assert.equal(await prisma.taxAdjustment.count(), 0);
  assert.equal((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: taxableItem.id } })).quantity, 20);
  assert.equal((await prisma.inventoryStockLot.findFirstOrThrow({ where: { inventoryItemId: taxableItem.id } })).remainingQuantity, 19);
  assert.equal((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: nonTaxableItem.id } })).quantity, 20);

  const partialRefundInput = {
    idempotencyKey: unique("partial-refund"),
    refundType: "partial" as const,
    partialRefundAmount: 10,
    reason: "customer_return",
    restoreInventory: false
  };
  const partialReceipt = await refundPosSale(user, receipt.saleReference, partialRefundInput);
  const duplicatePartialReceipt = await refundPosSale(user, receipt.saleReference, partialRefundInput);
  assert.equal(partialReceipt.refundStatus, "partially_refunded");
  assert.equal(partialReceipt.refundedAmount, 10);
  assert.equal(partialReceipt.refundedTax, 0.65);
  assert.equal(partialReceipt.refundedMerchandise, 9.35);
  assert.equal(partialReceipt.netTotal, 16.75);
  assert.equal(duplicatePartialReceipt.refundedAmount, 10);
  assert.equal(await prisma.taxAdjustment.count({ where: { saleReference: receipt.saleReference } }), 1);

  const fullRefundInput = {
    idempotencyKey: unique("full-refund"),
    refundType: "full" as const,
    reason: "customer_return",
    restoreInventory: false
  };
  const fullReceipt = await refundPosSale(user, receipt.saleReference, fullRefundInput);
  const duplicateFullReceipt = await refundPosSale(user, receipt.saleReference, fullRefundInput);
  assert.equal(fullReceipt.refundStatus, "refunded");
  assert.equal(fullReceipt.refundedAmount, 26.75);
  assert.equal(fullReceipt.refundedTax, 1.75);
  assert.equal(fullReceipt.refundedMerchandise, 25);
  assert.equal(fullReceipt.netTotal, 0);
  assert.equal(duplicateFullReceipt.refundedAmount, 26.75);
  assert.equal(await prisma.taxAdjustment.count({ where: { saleReference: receipt.saleReference } }), 2);

  process.env.POS_SALES_TAX_ENABLED = "false";
  const disabledKey = unique("tax-disabled");
  const disabledQuote = await quote(disabledKey, [{ inventoryItemId: nonTaxableItem.id, quantity: 1 }]);
  assert.equal(disabledQuote.taxStatus, "not_recorded");
  assert.equal(disabledQuote.tax, 0);
  assert.equal(disabledQuote.total, 25);
  const disabledReceipt = await finalize(disabledKey, disabledQuote.quoteId, [{ inventoryItemId: nonTaxableItem.id, quantity: 1 }]);
  assert.equal(disabledReceipt.taxStatus, "not_recorded");
  assert.equal(disabledReceipt.total, 25);
  const disabledSale = await prisma.inventorySale.findFirstOrThrow({ where: { saleReference: disabledReceipt.saleReference } });
  assert.equal(disabledSale.taxCents, null);
  assert.equal(disabledSale.taxStatus, "not_recorded");
  process.env.POS_SALES_TAX_ENABLED = "true";
});
