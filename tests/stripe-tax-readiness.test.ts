import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-stripe-readiness-"));
const testDbPath = path.join(testDbDir, "stripe-readiness.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.VERCEL_ENV = "preview";
process.env.ONLINE_STRIPE_TAX_ENABLED = "false";
process.env.POS_STRIPE_TAX_ENABLED = "false";
process.env.STRIPE_CHECKOUT_ENABLED = "false";

execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(root, "src/lib/db.ts")).href);
const readinessModule = await import(pathToFileURL(path.join(root, "src/lib/stripe-tax-readiness.ts")).href);
const stripeTaxModule = await import(pathToFileURL(path.join(root, "src/lib/stripe-tax.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { getStripeTaxReadiness } = readinessModule as typeof import("../src/lib/stripe-tax-readiness");
const { checkStripeTaxProviderReadiness } = stripeTaxModule as typeof import("../src/lib/stripe-tax");

let userId = "";

test.before(async () => {
  const user = await prisma.user.create({ data: { email: "stripe-readiness@example.test", name: "Stripe Readiness", role: "ADMIN", passwordHash: "test-hash" } });
  userId = user.id;
  await prisma.storefrontSettings.create({
    data: {
      userId,
      storeCountry: "US",
      storeState: "FL",
      storeAddressLine1: "100 Test Way",
      storeCity: "Orlando",
      storePostalCode: "32801",
      defaultStripeTaxCode: "txcd_99999999",
      shippingStripeTaxCode: "txcd_92010001"
    }
  });
  await prisma.inventoryItem.createMany({
    data: [
      { userId, itemType: "SEALED", itemName: "Fallback item", cost: 1, quantity: 1, source: "test", purchasedAt: new Date() },
      { userId, itemType: "SEALED", itemName: "Override item", cost: 1, quantity: 1, source: "test", purchasedAt: new Date(), stripeTaxCode: "txcd_99999999" }
    ]
  });
});

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

test("missing credentials are blocked, secrets are redacted, and GET-style readiness performs zero business writes", async () => {
  process.env.STRIPE_SECRET_KEY = "";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "";
  process.env.STRIPE_WEBHOOK_SECRET = "";
  const before = {
    audits: await prisma.auditLog.count(),
    sales: await prisma.inventorySale.count(),
    orders: await prisma.storefrontOrder.count(),
    adjustments: await prisma.taxAdjustment.count()
  };
  const readiness = await getStripeTaxReadiness(userId);
  assert.equal(readiness.connection.apiMode, "missing");
  assert.equal(readiness.connection.providerReachable, null);
  assert.equal(readiness.connection.webhookConfigured, false);
  assert.ok(readiness.blockers.includes("Stripe test credentials missing"));
  assert.deepEqual({
    audits: await prisma.auditLog.count(),
    sales: await prisma.inventorySale.count(),
    orders: await prisma.storefrontOrder.count(),
    adjustments: await prisma.taxAdjustment.count()
  }, before);
  assert.doesNotMatch(JSON.stringify(readiness), /STRIPE_SECRET_KEY|sk_(?:test|live)_|whsec_|DATABASE_URL/);
});

test("test and live credential modes are reported without enabling runtime gates", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_redacted_fixture";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_redacted_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_redacted_fixture";
  const testReadiness = await getStripeTaxReadiness(userId);
  assert.equal(testReadiness.connection.apiMode, "test");
  assert.equal(testReadiness.online.runtimeEnabled, false);
  assert.equal(testReadiness.pos.runtimeEnabled, false);
  assert.doesNotMatch(JSON.stringify(testReadiness), /redacted_fixture/);

  process.env.STRIPE_SECRET_KEY = "sk_live_redacted_fixture";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_redacted_fixture";
  const liveReadiness = await getStripeTaxReadiness(userId);
  assert.equal(liveReadiness.connection.apiMode, "live");
  assert.equal(liveReadiness.online.runtimeEnabled, false);
  assert.equal(liveReadiness.pos.runtimeEnabled, false);
});

test("provider contract maps active, pending, missing, and unavailable registration states safely", async () => {
  const active = await checkStripeTaxProviderReadiness("US", "FL", {
    tax: { registrations: { list: async () => ({ data: [{ country: "US", status: "active", active_from: 1782864000, country_options: { us: { state: "FL" } } }], lastResponse: { requestId: "req_safe_123" } }) } }
  } as never);
  assert.equal(active.reachable, true);
  assert.equal(active.registrationStatus, "active");
  assert.equal(active.requestId, "req_safe_123");
  assert.equal(active.registrationEffectiveDate, "2026-07-01");

  const pending = await checkStripeTaxProviderReadiness("US", "FL", {
    tax: { registrations: { list: async () => ({ data: [{ country: "US", status: "scheduled", country_options: { us: { state: "FL" } } }] }) } }
  } as never);
  assert.equal(pending.registrationStatus, "pending");
  const missing = await checkStripeTaxProviderReadiness("US", "FL", { tax: { registrations: { list: async () => ({ data: [] }) } } } as never);
  assert.equal(missing.registrationStatus, "missing");
  const unavailable = await checkStripeTaxProviderReadiness("US", "FL", { tax: { registrations: { list: async () => { throw new Error("provider fixture"); } } } } as never);
  assert.equal(unavailable.reachable, false);
  assert.equal(unavailable.registrationStatus, "unknown");
});

test("admin-only route is private, explicit, origin protected, rate limited, and does not call Stripe on GET", () => {
  const route = readFileSync(path.join(root, "src/app/api/radar/tax-readiness/route.ts"), "utf8");
  const lib = readFileSync(path.join(root, "src/lib/stripe-tax-readiness.ts"), "utf8");
  const getSource = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  for (const requirement of [/requireUser/, /requireAdmin/, /privateOk/, /authorizeAdminMutation/, /admin_tax_provider_check/, /requestId/]) assert.match(route, requirement);
  assert.doesNotMatch(getSource, /runStripeTaxConnectivityCheck|checkStripeTaxProviderReadiness/);
  assert.doesNotMatch(getSource, /prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
  assert.match(lib, /checkStripeTaxProviderReadiness/);
  assert.doesNotMatch(lib, /secretKey:\s*process\.env|webhookSecret|registrationId/);
});

test("readiness UI exposes accessible non-color-only status and all required sections", () => {
  const component = readFileSync(path.join(root, "src/components/StripeTaxReadinessWorkspace.tsx"), "utf8");
  for (const copy of ["Stripe Connection", "Tax Registrations", "Product Configuration", "Online Readiness", "POS Readiness", "Live Blockers", "Run safe connectivity check"]) {
    assert.match(component, new RegExp(copy));
  }
  assert.match(component, /Status: \{state\}/);
  assert.match(component, /credentials are never displayed|identifiers are intentionally never displayed/);
  assert.doesNotMatch(component, /manual county|county rate|secret value/i);
});
