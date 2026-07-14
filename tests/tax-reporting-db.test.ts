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
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-tax-reporting-"));
const testDbPath = path.join(testDbDir, "tax-reporting.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.VERCEL_ENV = "preview";
process.env.AUTH_SECRET = "tax-reporting-test-secret-with-at-least-thirty-two-characters";
process.env.TAX_REPORTING_ENABLED = "true";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const reportingModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/tax-reporting.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { buildTaxReport, taxReportCsv, taxReportDateBounds } = reportingModule as typeof import("../src/lib/tax-reporting");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

async function businessCounts() {
  return {
    orders: await prisma.storefrontOrder.count(),
    sales: await prisma.inventorySale.count(),
    taxAdjustments: await prisma.taxAdjustment.count(),
    inventory: await prisma.inventoryItem.count(),
    paymentEvents: await prisma.paymentEvent.count(),
    rewardEntries: await prisma.rewardLedgerEntry.count(),
    audits: await prisma.auditLog.count()
  };
}

test("database report reads are tenant-isolated, canonical, and perform zero business writes", async () => {
  const ownerRecord = await prisma.user.create({ data: { email: "report-owner@example.test", name: "Report Owner", role: "ADMIN", passwordHash: "test-hash" } });
  const otherRecord = await prisma.user.create({ data: { email: "other-owner@example.test", name: "Other Owner", role: "ADMIN", passwordHash: "test-hash" } });
  const user: SessionUser = {
    id: ownerRecord.id,
    email: ownerRecord.email,
    name: ownerRecord.name,
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
  const item = await prisma.inventoryItem.create({
    data: {
      userId: ownerRecord.id,
      itemType: "product",
      itemName: "Reporting fixture",
      category: "sealed_packs",
      cost: 10,
      quantity: 10,
      source: "Disposable test fixture",
      purchasedAt: new Date("2026-07-01T12:00:00.000Z")
    }
  });
  const taxedOrder = await prisma.storefrontOrder.create({
    data: {
      userId: ownerRecord.id,
      orderNumber: "REPORT-ONLINE",
      status: "paid",
      paymentStatus: "paid",
      subtotal: 100,
      subtotalCents: 10_000,
      discountCents: 1_000,
      shippingCharged: 5,
      shippingCents: 500,
      taxableSubtotalCents: 9_000,
      tax: 6.3,
      taxCents: 630,
      total: 101.3,
      totalCents: 10_130,
      taxStatus: "collected",
      taxProvider: "stripe_tax",
      taxCalculationId: "cs_report_online",
      taxJurisdictionCountry: "US",
      taxJurisdictionState: "FL",
      refundedTaxCents: 0,
      paidAt: new Date("2026-07-05T16:00:00.000Z"),
      isTestOrder: false
    }
  });
  await prisma.storefrontOrder.createMany({ data: [
    {
      userId: ownerRecord.id,
      orderNumber: "REPORT-TEST-EXCLUDED",
      status: "paid",
      paymentStatus: "paid",
      subtotalCents: 50_000,
      discountCents: 0,
      shippingCents: 0,
      taxableSubtotalCents: 50_000,
      taxCents: 3_500,
      totalCents: 53_500,
      taxStatus: "collected",
      refundedTaxCents: 0,
      paidAt: new Date("2026-07-05T16:00:00.000Z"),
      isTestOrder: true
    },
    {
      userId: ownerRecord.id,
      orderNumber: "REPORT-UNPAID-EXCLUDED",
      status: "pending_payment",
      paymentStatus: "pending",
      subtotalCents: 60_000,
      discountCents: 0,
      shippingCents: 0,
      taxableSubtotalCents: null,
      taxCents: null,
      totalCents: 60_000,
      taxStatus: "not_recorded",
      isTestOrder: false,
      createdAt: new Date("2026-07-05T16:00:00.000Z")
    },
    {
      userId: otherRecord.id,
      orderNumber: "OTHER-TENANT-EXCLUDED",
      status: "paid",
      paymentStatus: "paid",
      subtotalCents: 70_000,
      discountCents: 0,
      shippingCents: 0,
      taxableSubtotalCents: 70_000,
      taxCents: 4_900,
      totalCents: 74_900,
      taxStatus: "collected",
      refundedTaxCents: 0,
      paidAt: new Date("2026-07-05T16:00:00.000Z"),
      isTestOrder: false
    }
  ] });
  const posLines = await Promise.all([
    prisma.inventorySale.create({ data: {
      inventoryItemId: item.id, userId: ownerRecord.id, quantitySold: 1, soldPricePerItem: 30, grossSale: 30, platform: "pos", netSale: 32.1, costBasis: 10, profitLoss: 22.1,
      saleReference: "REPORT-POS", subtotalCents: 3_000, discountCents: 0, taxableSubtotalCents: 3_000, taxCents: 210, stateTaxCents: 180, countySurtaxCents: 30,
      totalCents: 3_210, refundedTaxCents: 0, taxStatus: "collected", taxExempt: false, taxJurisdictionCountry: "US", taxJurisdictionState: "FL", taxJurisdictionCounty: "Orange", soldAt: new Date("2026-07-06T16:00:00.000Z")
    } }),
    prisma.inventorySale.create({ data: {
      inventoryItemId: item.id, userId: ownerRecord.id, quantitySold: 1, soldPricePerItem: 20, grossSale: 20, platform: "pos", netSale: 21.4, costBasis: 10, profitLoss: 11.4,
      saleReference: "REPORT-POS", subtotalCents: 2_000, discountCents: 0, taxableSubtotalCents: 2_000, taxCents: 140, stateTaxCents: 120, countySurtaxCents: 20,
      totalCents: 2_140, refundedTaxCents: 0, taxStatus: "collected", taxExempt: false, taxJurisdictionCountry: "US", taxJurisdictionState: "FL", taxJurisdictionCounty: "Orange", soldAt: new Date("2026-07-06T16:00:00.000Z")
    } })
  ]);
  await prisma.taxAdjustment.create({
    data: {
      idempotencyKey: "tax:reporting:zero-adjustment",
      channel: "online",
      adjustmentType: "refund",
      storefrontOrderId: taxedOrder.id,
      providerReference: "re_report_zero",
      refundedAmountCents: 0,
      refundedTaxCents: 0,
      createdByUserId: ownerRecord.id
    }
  });
  await prisma.paymentEvent.createMany({ data: [
    { orderId: taxedOrder.id, provider: "stripe", eventId: "evt_report_1", eventType: "checkout.session.completed", payload: "{}" },
    { orderId: taxedOrder.id, provider: "stripe", eventId: "evt_report_duplicate_delivery", eventType: "checkout.session.completed", payload: "{}" }
  ] });

  const before = await businessCounts();
  const bounds = taxReportDateBounds("2026-07-01", "2026-07-31");
  const report = await buildTaxReport(user, { ...bounds, country: "US", state: "FL", page: 1, pageSize: 50 });
  const csv = taxReportCsv({ ...report, filters: { ...report.filters, export: true, page: 1, pageSize: 5_000 }, rows: report.rows });
  const after = await businessCounts();

  assert.deepEqual(after, before);
  assert.equal(report.summary.sourceRecordCount, 3);
  assert.equal(report.summary.transactionCount, 2);
  assert.equal(report.summary.totalTaxCents, 980);
  assert.equal(report.summary.floridaStateTaxCents, 300);
  assert.equal(report.summary.countySurtaxCents, 50);
  assert.equal(report.summary.unallocatedTaxCents, 630);
  assert.equal(report.rows.filter((row) => row.reference === "REPORT-POS").length, 1);
  assert.doesNotMatch(JSON.stringify(report), /OTHER-TENANT|REPORT-TEST|REPORT-UNPAID|example\.test|internal-sale-id/);
  assert.doesNotMatch(csv, /OTHER-TENANT|REPORT-TEST|REPORT-UNPAID|example\.test/);
  assert.equal(posLines.length, 2);
});
