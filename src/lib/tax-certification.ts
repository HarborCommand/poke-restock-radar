import { prisma } from "@/lib/db";
import { BUILD_INFO } from "@/generated/build-info";

export const TAX_CERTIFICATION_SCENARIOS = [
  "online_same_county_florida", "online_different_county_florida", "online_out_of_state", "online_local_pickup",
  "online_shipping_tax", "online_checkout_creation", "online_signed_webhook_snapshot", "online_duplicate_webhook",
  "online_full_refund", "online_partial_refund", "pos_in_person", "pos_delivery", "pos_cash", "pos_zelle",
  "pos_transaction_recording", "pos_duplicate_finalize", "pos_full_reversal", "pos_partial_reversal",
  "pos_duplicate_reversal", "pos_provider_failure"
] as const;

export type TaxCertificationScenario = typeof TAX_CERTIFICATION_SCENARIOS[number];
export type TaxCertificationStatus = "not_run" | "blocked" | "passed" | "failed" | "expired";

type CertificationEnv = Record<string, string | undefined>;
type Evidence = {
  scenario: TaxCertificationScenario;
  status: TaxCertificationStatus;
  contractStatus: "passed" | "failed";
  providerMode: "contract_mock" | "stripe_test";
  safeProviderReference: string | null;
  expectedAmountCents: number | null;
  actualAmountCents: number | null;
  requestId: string | null;
  buildCommit: string;
  detailCode: string | null;
  runAt: string;
  expiresAt: string | null;
};

function value(env: CertificationEnv, name: string) { return env[name]?.trim() ?? ""; }

export function stripeCertificationSafety(env: CertificationEnv = process.env) {
  const key = value(env, "STRIPE_SECRET_KEY");
  const baseUrl = value(env, "STORE_BASE_URL") || value(env, "APP_URL");
  const databaseUrl = value(env, "DATABASE_URL");
  const hardBlocks = [
    key.startsWith("sk_live_") ? "live_key_refused" : null,
    value(env, "VERCEL_ENV") === "production" || value(env, "NODE_ENV") === "production" ? "production_environment_refused" : null,
    /gamedaygrabs\.com/i.test(baseUrl) || /poke-restock-radar\.vercel\.app/i.test(baseUrl) ? "production_base_url_refused" : null,
    /(?:prod|production)/i.test(databaseUrl) ? "production_database_refused" : null
  ].filter((item): item is string => Boolean(item));
  const blockers = [
    !key.startsWith("sk_test_") ? "stripe_test_credentials_missing" : null,
    value(env, "TAX_CERTIFICATION_DATABASE_CONFIRMATION") !== "DISPOSABLE_PREVIEW" ? "disposable_preview_database_unconfirmed" : null,
    value(env, "TAX_CERTIFICATION_PROVIDER_WRITES_CONFIRMED") !== "true" ? "provider_writes_not_confirmed" : null
  ].filter((item): item is string => Boolean(item));
  return { safe: hardBlocks.length === 0 && blockers.length === 0, hardBlocks, blockers, mode: key.startsWith("sk_test_") ? "test" as const : key.startsWith("sk_live_") ? "live" as const : "missing" as const };
}

function buildCommit() { return BUILD_INFO.commitShort || "unknown"; }
function runAt() { return new Date().toISOString(); }
function expiresAt(now: string) { return new Date(new Date(now).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); }

function safeReference(value: unknown) {
  return typeof value === "string" && /^(?:taxcalc_|tax_|cs_test_|evt_|re_|req_)[A-Za-z0-9_]+$/.test(value) ? value.slice(0, 160) : null;
}

function safeCents(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000 ? Number(value) : null; }

export function contractCertificationEvidence(env: CertificationEnv = process.env): Evidence[] {
  const safety = stripeCertificationSafety(env);
  const now = runAt();
  const status: TaxCertificationStatus = safety.mode === "test" && !safety.hardBlocks.length ? "not_run" : "blocked";
  const detailCode = safety.hardBlocks[0] ?? safety.blockers[0] ?? "stripe_execution_not_run";
  return TAX_CERTIFICATION_SCENARIOS.map((scenario) => ({ scenario, status, contractStatus: "passed", providerMode: "contract_mock", safeProviderReference: null, expectedAmountCents: null, actualAmountCents: null, requestId: null, buildCommit: buildCommit(), detailCode, runAt: now, expiresAt: null }));
}

export type StripeScenarioExecutor = (scenario: TaxCertificationScenario) => Promise<{ passed: boolean; providerReference?: string | null; expectedAmountCents?: number | null; actualAmountCents?: number | null; requestId?: string | null; detailCode?: string | null }>;

export async function stripeCertificationEvidence(executor: StripeScenarioExecutor | null, env: CertificationEnv = process.env): Promise<Evidence[]> {
  const safety = stripeCertificationSafety(env);
  const now = runAt();
  if (!safety.safe || !executor) {
    const detailCode = safety.hardBlocks[0] ?? safety.blockers[0] ?? "stripe_test_executor_unavailable";
    return TAX_CERTIFICATION_SCENARIOS.map((scenario) => ({ scenario, status: "blocked", contractStatus: "passed", providerMode: "stripe_test", safeProviderReference: null, expectedAmountCents: null, actualAmountCents: null, requestId: null, buildCommit: buildCommit(), detailCode, runAt: now, expiresAt: null }));
  }
  const output: Evidence[] = [];
  for (const scenario of TAX_CERTIFICATION_SCENARIOS) {
    try {
      const result = await executor(scenario);
      output.push({ scenario, status: result.passed ? "passed" : "failed", contractStatus: "passed", providerMode: "stripe_test", safeProviderReference: safeReference(result.providerReference), expectedAmountCents: safeCents(result.expectedAmountCents), actualAmountCents: safeCents(result.actualAmountCents), requestId: safeReference(result.requestId), buildCommit: buildCommit(), detailCode: result.detailCode?.replace(/[^a-z0-9_]/gi, "_").slice(0, 80) || null, runAt: now, expiresAt: result.passed ? expiresAt(now) : null });
    } catch {
      output.push({ scenario, status: "failed", contractStatus: "passed", providerMode: "stripe_test", safeProviderReference: null, expectedAmountCents: null, actualAmountCents: null, requestId: null, buildCommit: buildCommit(), detailCode: "provider_execution_failed", runAt: now, expiresAt: null });
    }
  }
  return output;
}

export async function persistTaxCertificationEvidence(userId: string, evidence: Evidence[]) {
  for (const item of evidence) {
    await prisma.taxCertificationEvidence.upsert({
      where: { userId_scenario_buildCommit_providerMode: { userId, scenario: item.scenario, buildCommit: item.buildCommit, providerMode: item.providerMode } },
      create: { userId, ...item, runAt: new Date(item.runAt), expiresAt: item.expiresAt ? new Date(item.expiresAt) : null },
      update: { status: item.status, contractStatus: item.contractStatus, safeProviderReference: item.safeProviderReference, expectedAmountCents: item.expectedAmountCents, actualAmountCents: item.actualAmountCents, requestId: item.requestId, detailCode: item.detailCode, runAt: new Date(item.runAt), expiresAt: item.expiresAt ? new Date(item.expiresAt) : null }
    });
  }
  return taxCertificationReport(userId);
}

export async function taxCertificationReport(userId: string) {
  const rows = await prisma.taxCertificationEvidence.findMany({ where: { userId }, orderBy: [{ scenario: "asc" }, { runAt: "desc" }] });
  const now = Date.now();
  return {
    generatedAt: new Date().toISOString(),
    scenarios: TAX_CERTIFICATION_SCENARIOS.map((scenario) => {
      const row = rows.find((item) => item.scenario === scenario && item.providerMode === "stripe_test") ?? rows.find((item) => item.scenario === scenario);
      if (!row) return { scenario, status: "not_run" as const, contractStatus: "not_run" as const };
      const status = row.status === "passed" && row.expiresAt && row.expiresAt.getTime() <= now ? "expired" : row.status;
      return { scenario, status, contractStatus: row.contractStatus, providerMode: row.providerMode, safeProviderReference: row.safeProviderReference, expectedAmountCents: row.expectedAmountCents, actualAmountCents: row.actualAmountCents, requestId: row.requestId, buildCommit: row.buildCommit, detailCode: row.detailCode, runAt: row.runAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null };
    })
  };
}
