import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = mkdtempSync(path.join(tmpdir(), "gdg-tax-certification-"));
const dbPath = path.join(dbDir, "certification.sqlite");
process.env.DATABASE_URL = `file:${dbPath}`;
execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: "pipe" });

const dbModule = await import(pathToFileURL(path.join(root, "src/lib/db.ts")).href);
const certificationModule = await import(pathToFileURL(path.join(root, "src/lib/tax-certification.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { TAX_CERTIFICATION_SCENARIOS, stripeCertificationSafety, contractCertificationEvidence, stripeCertificationEvidence, persistTaxCertificationEvidence } = certificationModule as typeof import("../src/lib/tax-certification");

let userId = "";
test.before(async () => { userId = (await prisma.user.create({ data: { email: "certification@example.test", name: "Certification", role: "ADMIN", passwordHash: "test" } })).id; });
test.after(async () => { await prisma.$disconnect(); rmSync(dbDir, { recursive: true, force: true }); });

test("harness covers every online and POS certification scenario", () => {
  assert.equal(TAX_CERTIFICATION_SCENARIOS.length, 20);
  for (const scenario of ["online_same_county_florida", "online_different_county_florida", "online_local_pickup", "online_signed_webhook_snapshot", "online_partial_refund", "pos_in_person", "pos_cash", "pos_zelle", "pos_duplicate_finalize", "pos_full_reversal", "pos_partial_reversal", "pos_provider_failure"]) assert.ok(TAX_CERTIFICATION_SCENARIOS.includes(scenario as never));
});

test("safety refuses live keys, Production URLs, Production runtime, and Production databases", () => {
  assert.ok(stripeCertificationSafety({ STRIPE_SECRET_KEY: "sk_live_fixture", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true" }).hardBlocks.includes("live_key_refused"));
  assert.ok(stripeCertificationSafety({ STRIPE_SECRET_KEY: "sk_test_fixture", STORE_BASE_URL: "https://gamedaygrabs.com", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true" }).hardBlocks.includes("production_base_url_refused"));
  assert.ok(stripeCertificationSafety({ STRIPE_SECRET_KEY: "sk_test_fixture", VERCEL_ENV: "production", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true" }).hardBlocks.includes("production_environment_refused"));
  assert.ok(stripeCertificationSafety({ STRIPE_SECRET_KEY: "sk_test_fixture", DATABASE_URL: "postgres://production.example/db", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true" }).hardBlocks.includes("production_database_refused"));
});

test("missing credentials are blocked while contract checks pass without fabricating Stripe certification", async () => {
  const contracts = contractCertificationEvidence({});
  assert.ok(contracts.every((item) => item.contractStatus === "passed" && item.status === "blocked"));
  const stripe = await stripeCertificationEvidence(null, {});
  assert.ok(stripe.every((item) => item.status === "blocked" && item.providerMode === "stripe_test"));
});

test("duplicate evidence persistence is idempotent, safe, and does not enable runtime flags", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_fixture", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true", VERCEL_ENV: "preview", ONLINE_STRIPE_TAX_ENABLED: "false", POS_STRIPE_TAX_ENABLED: "false" };
  const evidence = await stripeCertificationEvidence(async (scenario) => ({ passed: true, providerReference: scenario.startsWith("online") ? "cs_test_safe_123" : "tax_safe_123", expectedAmountCents: 107, actualAmountCents: 107, requestId: "req_safe_123" }), env);
  await persistTaxCertificationEvidence(userId, evidence);
  await persistTaxCertificationEvidence(userId, evidence);
  assert.equal(await prisma.taxCertificationEvidence.count({ where: { userId } }), TAX_CERTIFICATION_SCENARIOS.length);
  const serialized = JSON.stringify(await prisma.taxCertificationEvidence.findMany({ where: { userId } }));
  assert.doesNotMatch(serialized, /sk_test_fixture|customer|address|email|phone/i);
  assert.equal(env.ONLINE_STRIPE_TAX_ENABLED, "false");
  assert.equal(env.POS_STRIPE_TAX_ENABLED, "false");
});

test("unsafe evidence fields are discarded and provider failures are recorded without PII", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_fixture", TAX_CERTIFICATION_DATABASE_CONFIRMATION: "DISPOSABLE_PREVIEW", TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED: "true", VERCEL_ENV: "preview" };
  const evidence = await stripeCertificationEvidence(async () => ({ passed: false, providerReference: "customer@example.test", expectedAmountCents: -1, actualAmountCents: 1e12, requestId: "Bearer secret", detailCode: "bad detail with spaces" }), env);
  assert.ok(evidence.every((item) => item.safeProviderReference === null && item.requestId === null && item.expectedAmountCents === null && item.actualAmountCents === null));
  assert.ok(evidence.every((item) => item.detailCode === "bad_detail_with_spaces"));
});

test("CLI commands and migration are installed without real customer fixtures", () => {
  const pkg = readFileSync(path.join(root, "package.json"), "utf8");
  for (const command of ["tax:certify:contracts", "tax:certify:stripe", "tax:certify:report"]) assert.match(pkg, new RegExp(command.replaceAll(":", "\\:")));
  const migration = readFileSync(path.join(root, "prisma/migrations/20260716033000_stripe_tax_certification/migration.sql"), "utf8");
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(migration, /TaxCertificationEvidence/);
  assert.match(schema, /map: "TaxCertificationEvidence_userId_scenario_buildCommit_providerMo"/);
  assert.doesNotMatch(migration, /customerEmail|shippingLine|STRIPE_SECRET_KEY/);
});
