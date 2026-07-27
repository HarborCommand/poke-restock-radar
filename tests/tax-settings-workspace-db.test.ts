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
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-tax-settings-"));
const testDbPath = path.join(testDbDir, "tax-settings.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.VERCEL_ENV = "preview";
process.env.ONLINE_STRIPE_TAX_ENABLED = "false";
process.env.POS_SALES_TAX_ENABLED = "false";
process.env.MANUAL_TAX_FALLBACK_ENABLED = "false";
process.env.TAX_EXEMPT_SALES_ENABLED = "false";
process.env.TAX_REPORTING_ENABLED = "false";
process.env.STRIPE_CHECKOUT_ENABLED = "false";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "";
process.env.STRIPE_SECRET_KEY = "";
process.env.BLOB_READ_WRITE_TOKEN = "";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const taxAdminModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/tax-admin.ts")).href);
const validationModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/validation.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { getTaxAdminSettings, saveTaxAdminSettings } = taxAdminModule as typeof import("../src/lib/tax-admin");
const { taxAdminSettingsSchema } = validationModule as typeof import("../src/lib/validation");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

function sessionUser(id: string): SessionUser {
  return {
    id,
    email: "tax-admin@example.test",
    name: "Tax Admin",
    role: "ADMIN",
    canAddSightings: true,
    canAddComps: true,
    canRunChecks: true,
    canReceivePushAlerts: true
  };
}

const disabledProfile = {
  storeCountry: "US",
  storeState: "FL",
  storeCounty: "Test County",
  storeAddressLine1: "100 Test Way",
  storeAddressLine2: "",
  storeCity: "Orlando",
  storePostalCode: "32801",
  stateRateBasisPoints: 600,
  countyRateBasisPoints: 100,
  effectiveDate: "2026-07-01",
  sourceNote: "Disposable Preview fixture",
  onlineTaxProfileEnabled: false,
  posTaxEnabled: false,
  taxExemptSalesEnabled: false,
  taxReportingProfileEnabled: false,
  localPickupTaxTreatment: "pending_review",
  exemptionReferenceRequired: true,
  exemptionReasonRequired: true,
  defaultTaxCategory: "general_tangible_goods",
  defaultStripeTaxCode: "txcd_99999999",
  shippingStripeTaxCode: "txcd_92010001",
  defaultReportingPeriod: "monthly",
  registrationConfirmed: false,
  storeAddressConfirmed: false,
  countyConfirmed: false,
  defaultCodeConfirmed: false,
  previewOnlinePassed: false,
  previewPickupPassed: false,
  previewPosPassed: false,
  receiptVerified: false,
  refundVerified: false,
  reportReconciled: false,
  ownerApproved: false
} as const;

test("GET is write-free, duplicate saves are idempotent, and runtime gates stay authoritative", async () => {
  const user = await prisma.user.create({
    data: { email: "tax-admin@example.test", name: "Tax Admin", role: "ADMIN", passwordHash: "test-hash" }
  });
  const actor = sessionUser(user.id);

  const initial = await getTaxAdminSettings(user.id);
  assert.equal(initial.collectionDisabled, true);
  assert.equal(await prisma.storefrontSettings.count(), 0);
  assert.equal(await prisma.auditLog.count(), 0);

  const parsed = taxAdminSettingsSchema.parse(disabledProfile);
  await saveTaxAdminSettings(actor, parsed, "req-tax-create");
  assert.equal(await prisma.storefrontSettings.count(), 1);
  assert.equal(await prisma.auditLog.count(), 1);

  await saveTaxAdminSettings(actor, parsed, "req-tax-duplicate");
  assert.equal(await prisma.storefrontSettings.count(), 1);
  assert.equal(await prisma.auditLog.count(), 1);

  assert.equal(taxAdminSettingsSchema.safeParse({ ...disabledProfile, legacyManualTaxFallbackEnabled: true }).success, false);
  assert.equal(await prisma.auditLog.count(), 1);

  const incompleteEnable = taxAdminSettingsSchema.parse({
    ...disabledProfile,
    posTaxEnabled: true,
    enableTaxCollectionConfirmed: true,
    enablementReason: "configuration_rehearsal"
  });
  await assert.rejects(saveTaxAdminSettings(actor, incompleteEnable, "req-tax-incomplete"), /must be confirmed|readiness is incomplete/i);
  assert.equal(await prisma.auditLog.count(), 1);

  const readyPosProfile = taxAdminSettingsSchema.parse({
    ...disabledProfile,
    posTaxEnabled: true,
    registrationConfirmed: true,
    storeAddressConfirmed: true,
    countyConfirmed: true,
    defaultCodeConfirmed: true,
    previewPosPassed: true,
    receiptVerified: true,
    refundVerified: true,
    reportReconciled: true,
    ownerApproved: true,
    enableTaxCollectionConfirmed: true,
    enablementReason: "approved_preview_validation"
  });
  const saved = await saveTaxAdminSettings(actor, readyPosProfile, "req-tax-enable");
  assert.equal(saved.pos.profileEnabled, true);
  assert.equal(saved.pos.runtimeEnabled, false);
  assert.equal(saved.pos.active, false);
  assert.equal(saved.collectionDisabled, true);
  assert.equal(saved.pos.lastUpdatedByAdmin, user.id);
  assert.equal(await prisma.auditLog.count(), 2);

  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "tax.settings.updated" }, orderBy: { createdAt: "desc" } });
  const metadata = JSON.parse(audit.metadata ?? "{}") as { requestId?: string; changedFields?: string[]; enablementReason?: string };
  assert.equal(metadata.requestId, "req-tax-enable");
  assert.ok(metadata.changedFields?.includes("posTaxEnabled"));
  assert.equal(metadata.enablementReason, "approved_preview_validation");
  assert.equal(await prisma.taxAdjustment.count(), 0);
  assert.equal(await prisma.storefrontOrder.count(), 0);
  assert.equal(await prisma.inventorySale.count(), 0);
});
