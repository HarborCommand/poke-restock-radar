import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { customerAccountFeatureConfig } from "../src/lib/customer-accounts";
import { resolveCustomerSessionTimeout, shouldTouchCustomerSessionActivity } from "../src/lib/customer-session-timeouts";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

function cssRule(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const bodyStart = source.indexOf("{", start) + 1;
  const end = source.indexOf("\n}", bodyStart);
  assert.notEqual(end, -1, `missing CSS rule close: ${selector}`);
  return source.slice(bodyStart, end);
}

test("customer account and rewards feature flags default disabled", () => {
  const config = customerAccountFeatureConfig({});

  assert.equal(config.customerAccountsEnabled, false);
  assert.equal(config.customerRewardsEnabled, false);
  assert.equal(config.customerPosRewardsEnabled, false);
  assert.equal(config.customerRewardRedemptionEnabled, false);
  assert.equal(config.customerAuthRateLimitEnabled, false);
  assert.equal(config.customerSecurityCenterEnabled, false);
  assert.equal(config.customerLoginAlertsEnabled, false);
  assert.equal(config.customerSessionTimeoutsEnabled, false);
  assert.equal(config.customerSessionIdleTimeoutMinutes, 10);
  assert.equal(config.customerSessionAbsoluteTimeoutHours, 12);
  assert.equal(config.customerSessionWarningSeconds, 60);
  assert.equal(config.customerSessionActivityTouchIntervalSeconds, 60);
  assert.equal(config.accountProvider, "password_magic_link");
  assert.equal(config.rewardsProvider, "internal_ledger");
  assert.deepEqual(config.envVars, [
    "CUSTOMER_ACCOUNTS_ENABLED",
    "CUSTOMER_REWARDS_ENABLED",
    "CUSTOMER_POS_REWARDS_ENABLED",
    "CUSTOMER_REWARD_REDEMPTION_ENABLED",
    "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED",
    "CUSTOMER_AUTH_RATE_LIMIT_ENABLED",
    "CUSTOMER_SECURITY_CENTER_ENABLED",
    "CUSTOMER_LOGIN_ALERTS_ENABLED",
    "CUSTOMER_SESSION_TIMEOUTS_ENABLED",
    "CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES",
    "CUSTOMER_SESSION_ABSOLUTE_TIMEOUT_HOURS",
    "CUSTOMER_SESSION_WARNING_SECONDS",
    "CUSTOMER_SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS"
  ]);
  assert.equal(config.customerRewardAdminAdjustmentsEnabled, false);
});

test("customer session timeout flags parse safely without enabling by default", () => {
  const config = customerAccountFeatureConfig({
    CUSTOMER_SESSION_TIMEOUTS_ENABLED: "true",
    CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES: "15",
    CUSTOMER_SESSION_ABSOLUTE_TIMEOUT_HOURS: "8",
    CUSTOMER_SESSION_WARNING_SECONDS: "90",
    CUSTOMER_SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: "120"
  });
  const fallbackConfig = customerAccountFeatureConfig({
    CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES: "0",
    CUSTOMER_SESSION_ABSOLUTE_TIMEOUT_HOURS: "bad",
    CUSTOMER_SESSION_WARNING_SECONDS: "3",
    CUSTOMER_SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: "-1"
  });

  assert.equal(config.customerSessionTimeoutsEnabled, true);
  assert.equal(config.customerSessionIdleTimeoutMinutes, 15);
  assert.equal(config.customerSessionAbsoluteTimeoutHours, 8);
  assert.equal(config.customerSessionWarningSeconds, 90);
  assert.equal(config.customerSessionActivityTouchIntervalSeconds, 120);
  assert.equal(fallbackConfig.customerSessionTimeoutsEnabled, false);
  assert.equal(fallbackConfig.customerSessionIdleTimeoutMinutes, 10);
  assert.equal(fallbackConfig.customerSessionAbsoluteTimeoutHours, 12);
  assert.equal(fallbackConfig.customerSessionWarningSeconds, 60);
  assert.equal(fallbackConfig.customerSessionActivityTouchIntervalSeconds, 60);
});

test("customer session timeout helper enforces idle absolute and throttled activity windows", () => {
  const config = customerAccountFeatureConfig({
    CUSTOMER_SESSION_TIMEOUTS_ENABLED: "true",
    CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES: "10",
    CUSTOMER_SESSION_ABSOLUTE_TIMEOUT_HOURS: "12",
    CUSTOMER_SESSION_WARNING_SECONDS: "60",
    CUSTOMER_SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: "60"
  });
  const base = new Date("2026-06-26T12:00:00.000Z");
  const active = resolveCustomerSessionTimeout(
    config,
    {
      lastActivityAt: base,
      absoluteExpiresAt: new Date("2026-06-27T00:00:00.000Z")
    },
    new Date("2026-06-26T12:08:59.000Z")
  );
  const idleExpired = resolveCustomerSessionTimeout(
    config,
    {
      lastActivityAt: base,
      absoluteExpiresAt: new Date("2026-06-27T00:00:00.000Z")
    },
    new Date("2026-06-26T12:10:01.000Z")
  );
  const absoluteExpired = resolveCustomerSessionTimeout(
    config,
    {
      lastActivityAt: new Date("2026-06-26T23:59:00.000Z"),
      absoluteExpiresAt: new Date("2026-06-27T00:00:00.000Z")
    },
    new Date("2026-06-27T00:00:01.000Z")
  );
  const revoked = resolveCustomerSessionTimeout(
    config,
    {
      lastActivityAt: base,
      absoluteExpiresAt: new Date("2026-06-27T00:00:00.000Z"),
      revokedAt: new Date("2026-06-26T12:03:00.000Z")
    },
    new Date("2026-06-26T12:04:00.000Z")
  );

  assert.equal(active.reason, "active");
  assert.equal(active.idleExpiresAt.toISOString(), "2026-06-26T12:10:00.000Z");
  assert.equal(active.warningStartsAt.toISOString(), "2026-06-26T12:09:00.000Z");
  assert.equal(idleExpired.reason, "idle_expired");
  assert.equal(absoluteExpired.reason, "absolute_expired");
  assert.equal(revoked.reason, "revoked");
  assert.equal(shouldTouchCustomerSessionActivity(config, base, new Date("2026-06-26T12:00:59.000Z")), false);
  assert.equal(shouldTouchCustomerSessionActivity(config, base, new Date("2026-06-26T12:01:00.000Z")), true);
});

test("customer account and rewards schema foundation exists without touching checkout totals", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const checkoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );
  const webhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );

  for (const model of [
    "CustomerAccount",
    "CustomerSavedAddress",
    "CustomerMagicLinkToken",
    "CustomerPasswordResetToken",
    "RewardLedgerEntry",
    "RewardBalance"
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`), `missing ${model}`);
  }

  assert.match(schema, /email\s+String\s+@unique/);
  assert.match(schema, /normalizedEmail\s+String\?/);
  assert.match(schema, /status\s+String\s+@default\("active"\)/);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /lastLoginAt\s+DateTime\?/);
  assert.match(schema, /passwordHash\s+String\?/);
  assert.match(schema, /passwordSetAt\s+DateTime\?/);
  assert.match(schema, /tokenHash\s+String\s+@unique/);
  assert.match(schema, /expiresAt\s+DateTime/);
  assert.match(schema, /usedAt\s+DateTime\?/);
  assert.match(schema, /customerAccountId\s+String\?/);
  assert.match(schema, /availablePoints\s+Int\s+@default\(0\)/);
  assert.match(schema, /lifetimeEarnedPoints\s+Int\s+@default\(0\)/);
  assert.match(schema, /pendingPoints\s+Int\s+@default\(0\)/);
  assert.match(schema, /type\s+String/);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.match(schema, /status\s+String\?/);
  assert.match(schema, /availableAt\s+DateTime\?/);
  assert.match(schema, /settledAt\s+DateTime\?/);
  assert.match(schema, /eligibleSubtotalCents\s+Int\?/);
  assert.match(schema, /source\s+String\?/);
  assert.match(schema, /reversalOfEntryId\s+String\?/);
  assert.match(schema, /metadataJson\s+String\?/);

  assert.doesNotMatch(checkoutSession, /CustomerAccount|RewardLedgerEntry|RewardBalance|CUSTOMER_ACCOUNTS_ENABLED|CUSTOMER_REWARDS_ENABLED|customerAccountId|reward|points/i);
  assert.doesNotMatch(webhook, /CUSTOMER_REWARD_REDEMPTION_ENABLED|coupon|promotion_code|allow_promotion_codes|discount|redeem/i);
  assert.doesNotMatch(checkoutSession + webhook, /coupon|promotion_code|allow_promotion_codes|redeem/i);
});

test("customer account migration is additive and does not expose private payment data", () => {
  const migration = readProjectFile("prisma/migrations/20260623033000_customer_accounts_rewards_foundation/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const rewardLedger = sourceSlice(schema, "model RewardLedgerEntry", "model RewardBalance");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerAccount"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerSavedAddress"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerMagicLinkToken"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "RewardLedgerEntry"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "RewardBalance"/);
  assert.match(migration, /ALTER TABLE "StorefrontOrder" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(migration, /ALTER TABLE "StorefrontCustomer" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.doesNotMatch(migration + rewardLedger, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe|webhook body/i);
});

test("customer account normalized email migration is additive and non-unique until conflicts are audited", () => {
  const migration = readProjectFile("prisma/migrations/20260626013000_customer_account_normalized_email/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  assert.match(migration, /ALTER TABLE "CustomerAccount" ADD COLUMN "normalizedEmail" TEXT/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "CustomerAccount_normalizedEmail_idx"/);
  assert.doesNotMatch(migration, /UNIQUE|DROP|DELETE\s+FROM|TRUNCATE|UPDATE\s+"|SET NOT NULL/i);
  assert.match(schema, /normalizedEmail\s+String\?/);
  assert.match(schema, /@@index\(\[normalizedEmail\]\)/);
  assert.match(sqliteInit, /"normalizedEmail" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "CustomerAccount" ADD COLUMN "normalizedEmail" TEXT/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "CustomerAccount_normalizedEmail_idx"/);
});

test("customer session timeout migration is additive and stores only token hashes", () => {
  const migration = readProjectFile("prisma/migrations/20260626023000_customer_session_timeouts/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");
  const sessionModel = sourceSlice(schema, "model CustomerSession", "model CustomerPasswordResetToken");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerSession"/);
  assert.match(migration, /"customerAccountId" TEXT NOT NULL/);
  assert.match(migration, /"tokenHash" TEXT NOT NULL/);
  assert.match(migration, /"lastActivityAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(migration, /"absoluteExpiresAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(migration, /"revokedAt" TIMESTAMP\(3\)/);
  assert.match(migration, /"revokeReason" TEXT/);
  assert.match(migration, /"userAgentSummary" TEXT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.match(schema, /sessions\s+CustomerSession\[\]/);
  assert.match(sessionModel, /tokenHash\s+String\s+@unique/);
  assert.match(sessionModel, /lastActivityAt\s+DateTime/);
  assert.match(sessionModel, /absoluteExpiresAt\s+DateTime/);
  assert.match(sessionModel, /revokedAt\s+DateTime\?/);
  assert.match(sqliteInit, /CREATE TABLE IF NOT EXISTS "CustomerSession"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key"/);
  assert.doesNotMatch(sessionModel + migration, /\btoken\s+String\b|plainText|password|cardNumber|cvc|payment_method_details|raw Stripe|webhook body/i);
});

test("customer auth hardening uses persistent hashed rate limits and session revocation", () => {
  const migration = readProjectFile("prisma/migrations/20260626033000_customer_auth_hardening/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");
  const rateLimit = readProjectFile("src/lib/customer-auth-rate-limit.ts");
  const authOrigin = readProjectFile("src/lib/auth-origin.ts");
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const loginRoute = readProjectFile("src/app/api/account/login/route.ts");
  const registerRoute = readProjectFile("src/app/api/account/register/route.ts");
  const magicRequestRoute = readProjectFile("src/app/api/account/magic-link/request/route.ts");
  const forgotRoute = readProjectFile("src/app/api/account/forgot-password/route.ts");
  const resetRoute = readProjectFile("src/app/api/account/reset-password/route.ts");
  const verifyRoute = readProjectFile("src/app/api/account/magic-link/verify/route.ts");
  const logoutRoute = readProjectFile("src/app/api/account/logout/route.ts");
  const addressRoute = readProjectFile("src/app/api/account/addresses/route.ts");
  const refreshRoute = readProjectFile("src/app/api/account/session/refresh/route.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const authSession = sourceSlice(auth, "type CustomerSessionPayload", "export type CustomerSessionTimeoutMetadata");
  const resetFunction = sourceSlice(auth, "export async function resetCustomerPassword", "export async function verifyCustomerMagicLink");
  const limiterModel = sourceSlice(schema, "model CustomerAuthRateLimit", "model CustomerSession");

  assert.match(migration, /ALTER TABLE "CustomerAccount" ADD COLUMN "sessionRevokedBefore" TIMESTAMP\(3\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerAuthRateLimit"/);
  assert.match(migration, /"emailKeyHash" TEXT NOT NULL/);
  assert.match(migration, /"clientKeyHash" TEXT NOT NULL/);
  assert.match(migration, /"attemptCount" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAuthRateLimit_action_emailKeyHash_clientKeyHash_windowStart_key"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER COLUMN|SET NOT NULL/i);

  assert.match(schema, /model CustomerAuthRateLimit \{/);
  assert.match(schema, /emailKeyHash\s+String/);
  assert.match(schema, /clientKeyHash\s+String/);
  assert.match(schema, /@@unique\(\[action, emailKeyHash, clientKeyHash, windowStart\]\)/);
  assert.match(schema, /sessionRevokedBefore\s+DateTime\?/);
  assert.match(sqliteInit, /CREATE TABLE IF NOT EXISTS "CustomerAuthRateLimit"/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_blockedUntil_idx"/);

  assert.match(rateLimit, /customerAuthRateLimitingEnabled/);
  assert.match(rateLimit, /customerAccountFeatureConfig\(\)\.customerAuthRateLimitEnabled/);
  assert.match(rateLimit, /createHmac\("sha256", secret\)/);
  assert.match(rateLimit, /normalizeCustomerEmail\(input\.email\)/);
  assert.match(rateLimit, /x-forwarded-for/);
  assert.match(rateLimit, /prisma\.customerAuthRateLimit\.upsert/);
  assert.match(rateLimit, /CustomerAuthRateLimitExceededError/);
  assert.match(rateLimit, /Retry-After/);
  assert.match(rateLimit, /assertCustomerSameOriginRequest/);
  assert.match(authOrigin, /request\.headers\.get\("origin"\)/);
  assert.match(authOrigin, /sec-fetch-site/);
  assert.doesNotMatch(rateLimit + migration + limiterModel, /rawEmail|plainEmail|rawIp|ipAddress\s+String|email\s+String\s+\/\/ rate|clientIp|passwordHash|tokenHash|cardNumber|cvc|payment_method_details|raw Stripe|webhook body/i);

  for (const [route, action] of [
    [loginRoute, "password_login"],
    [registerRoute, "registration"],
    [magicRequestRoute, "magic_link_request"],
    [forgotRoute, "forgot_password_request"],
    [resetRoute, "password_reset_submit"],
    [verifyRoute, "magic_link_verify"]
  ] as const) {
    assert.match(route, /enforceCustomerAuthRateLimit/);
    assert.match(route, new RegExp(`action:\\s*"${action}"`));
    assert.match(route, /CustomerAuthRateLimitExceededError/);
  }

  for (const route of [loginRoute, registerRoute, magicRequestRoute, forgotRoute, resetRoute, logoutRoute, addressRoute, refreshRoute]) {
    assert.match(route, /assertCustomerSameOriginRequest/);
    assert.match(route, /CustomerAuthOriginError/);
  }

  assert.match(authSession, /iat\?:\s*number/);
  assert.match(auth, /const customerDummyPasswordHash/);
  assert.match(auth, /customerPasswordMaxLength = 128/);
  assert.match(auth, /bcrypt\.compare\(input\.password, passwordHashForCompare\)/);
  assert.match(auth, /sessionRevokedBefore/);
  assert.match(auth, /issuedAt < account\.sessionRevokedBefore\.getTime\(\)/);
  assert.match(resetFunction, /sessionRevokedBefore:\s*now/);
  assert.match(resetFunction, /customerSession\.updateMany/);
  assert.match(resetFunction, /revokeReason:\s*"password_reset"/);
  assert.match(accountComponents, /Too many attempts\. Please wait a few minutes and try again\./);
  assert.match(accountComponents, /rate_limited/);
  assert.doesNotMatch(auth + rateLimit + loginRoute + registerRoute + magicRequestRoute + forgotRoute + resetRoute + verifyRoute, /plainTextPassword|rawPassword|token:\s*token\b|sessionId|password hashes? sent|cardNumber|cvc|payment_method_details|raw Stripe|webhook body|costBasis|supplier/i);
});

test("reward ledger idempotency migration is additive", () => {
  const migration = readProjectFile("prisma/migrations/20260623043000_reward_ledger_idempotency/migration.sql");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  assert.match(migration, /ALTER TABLE "RewardLedgerEntry" ADD COLUMN "idempotencyKey" TEXT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.match(sqliteInit, /"idempotencyKey" TEXT/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
});

test("reward pending ledger migration is additive and SQLite-aligned", () => {
  const migration = readProjectFile("prisma/migrations/20260706103000_rewards_pending_ledger_phase1/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  for (const column of ["status", "availableAt", "settledAt", "eligibleSubtotalCents", "source", "reversalOfEntryId"]) {
    assert.match(migration, new RegExp(`ALTER TABLE "RewardLedgerEntry" ADD COLUMN "${column}"`), `missing migration column ${column}`);
    assert.match(sqliteInit, new RegExp(`ALTER TABLE "RewardLedgerEntry" ADD COLUMN "${column}"`), `missing sqlite column ${column}`);
    assert.match(schema, new RegExp(`${column}\\s+`), `missing schema column ${column}`);
  }
  for (const index of ["status", "availableAt", "source", "reversalOfEntryId"]) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_${index}_idx"`), `missing migration index ${index}`);
    assert.match(sqliteInit, new RegExp(`CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_${index}_idx"`), `missing sqlite index ${index}`);
  }
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.doesNotMatch(migration, /payment_method_details|payment_method_data|card_number|cardNumber|cvc|cvv|raw Stripe|webhook body/i);
});

test("customer password account migration is additive and stores only hashes", () => {
  const migration = readProjectFile("prisma/migrations/20260623064500_customer_password_accounts/migration.sql");
  const schema = readProjectFile("prisma/schema.prisma");
  const customerPasswordSchema = sourceSlice(schema, "model CustomerAccount", "model CustomerSavedAddress");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  assert.match(migration, /ALTER TABLE "CustomerAccount" ADD COLUMN "passwordHash" TEXT/);
  assert.match(migration, /ALTER TABLE "CustomerAccount" ADD COLUMN "passwordSetAt" TIMESTAMP\(3\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CustomerPasswordResetToken"/);
  assert.match(migration, /"tokenHash" TEXT NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPasswordResetToken_tokenHash_key"/);
  assert.match(schema, /model CustomerPasswordResetToken \{/);
  assert.match(schema, /passwordResetTokens CustomerPasswordResetToken\[\]/);
  assert.match(schema, /passwordHash\s+String\?/);
  assert.match(sqliteInit, /"passwordHash" TEXT/);
  assert.match(sqliteInit, /CREATE TABLE IF NOT EXISTS "CustomerPasswordResetToken"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.doesNotMatch(migration + customerPasswordSchema, /\bpassword\s+String\b|plainTextPassword|rawPassword|cardNumber|cvc|payment_method_details|raw Stripe|webhook body/i);
});

test("customer account SQLite bootstrap stays aligned with the foundation schema", () => {
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  for (const table of ["CustomerAccount", "CustomerSession", "CustomerAuthRateLimit", "CustomerSavedAddress", "CustomerMagicLinkToken", "CustomerPasswordResetToken", "RewardLedgerEntry", "RewardBalance"]) {
    assert.match(sqliteInit, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  assert.match(sqliteInit, /ALTER TABLE "StorefrontOrder" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "StorefrontCustomer" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "CustomerAccount" ADD COLUMN "normalizedEmail" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "CustomerAccount" ADD COLUMN "sessionRevokedBefore" DATETIME/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_email_key"/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "CustomerAccount_normalizedEmail_idx"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key"/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "CustomerSession_lastActivityAt_idx"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAuthRateLimit_action_emailKeyHash_clientKeyHash_windowStart_key"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMagicLinkToken_tokenHash_key"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPasswordResetToken_tokenHash_key"/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_customerAccountId_idx"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
});

test("customer account routes are feature-flagged and keep guest checkout visible", () => {
  const accountPage = readProjectFile("src/app/account/page.tsx");
  const loginPage = readProjectFile("src/app/account/login/page.tsx");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");
  const rewardsPage = readProjectFile("src/app/account/rewards/page.tsx");
  const addressesPage = readProjectFile("src/app/account/addresses/page.tsx");
  const forgotPasswordPage = readProjectFile("src/app/account/forgot-password/page.tsx");
  const resetPasswordPage = readProjectFile("src/app/account/reset-password/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const magicLinkRequestRoute = readProjectFile("src/app/api/account/magic-link/request/route.ts");
  const passwordLoginRoute = readProjectFile("src/app/api/account/login/route.ts");
  const registerRoute = readProjectFile("src/app/api/account/register/route.ts");
  const forgotPasswordRoute = readProjectFile("src/app/api/account/forgot-password/route.ts");
  const resetPasswordRoute = readProjectFile("src/app/api/account/reset-password/route.ts");

  for (const source of [accountPage, ordersPage, rewardsPage, addressesPage]) {
    assert.match(source, /customerAccountsEnabled\(\)/);
    assert.match(source, /CustomerAccountsComingSoon/);
    assert.match(source, /currentCustomerAccount/);
  }

  assert.match(loginPage, /CustomerLoginPageContent/);
  assert.match(forgotPasswordPage, /AccountForgotPasswordPageContent/);
  assert.match(resetPasswordPage, /AccountResetPasswordPageContent/);
  for (const source of [loginPage, forgotPasswordPage, resetPasswordPage]) {
    assert.match(source, /<CustomerAccountShell focusedAuth>/);
  }
  assert.match(magicLinkRequestRoute, /customerAccountsEnabled\(\)/);
  assert.match(magicLinkRequestRoute, /privateJson\(\{ error: "Customer accounts are not enabled yet\." \}, 404\)/);
  for (const route of [passwordLoginRoute, registerRoute, forgotPasswordRoute, resetPasswordRoute]) {
    assert.match(route, /customerAccountsEnabled\(\)/);
    assert.match(route, /privateJson\(\{ error: "Customer accounts are not enabled yet\." \}, 404\)/);
  }
  assert.match(accountComponents, /Customer accounts coming soon/);
  assert.match(accountComponents, /Shop as Guest/);
  assert.match(accountComponents, /guest checkout remains available|You do not need an account to\s+place an order/i);
  assert.match(accountComponents, /action="\/api\/account\/magic-link\/request"/);
  assert.match(accountComponents, /action="\/api\/account\/login"/);
  assert.match(accountComponents, /action="\/api\/account\/register"/);
  assert.match(accountComponents, /type="email"/);
});

test("customer account isolation helpers normalize identity and reject client-supplied ownership", () => {
  const security = readProjectFile("src/lib/customer-account-security.ts");
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const http = readProjectFile("src/lib/http.ts");
  const sessionRoute = readProjectFile("src/app/api/account/session/route.ts");
  const addressRoute = readProjectFile("src/app/api/account/addresses/route.ts");
  const accountPages = [
    readProjectFile("src/app/account/page.tsx"),
    readProjectFile("src/app/account/orders/page.tsx"),
    readProjectFile("src/app/account/orders/[orderNumber]/page.tsx"),
    readProjectFile("src/app/account/addresses/page.tsx"),
    readProjectFile("src/app/account/rewards/page.tsx"),
    readProjectFile("src/app/account/login/page.tsx"),
    readProjectFile("src/app/account/forgot-password/page.tsx"),
    readProjectFile("src/app/account/reset-password/page.tsx")
  ].join("\n");

  assert.match(security, /export function normalizeCustomerEmail/);
  assert.match(security, /value\?\.trim\(\)\.toLowerCase\(\)/);
  assert.match(security, /export function verifiedCustomerIdentity/);
  assert.match(security, /export function customerVisibleOrderWhere/);
  assert.match(security, /export function hasClientSuppliedCustomerOwnership/);
  for (const key of ["customerAccountId", "accountEmail", "sessionId", "addressOwnerId", "orderOwnerId", "rewardOwnerId"]) {
    assert.match(security, new RegExp(`"${key}"`));
  }

  assert.match(auth, /SELECT "id"\s*\r?\n\s*FROM "CustomerAccount"/);
  assert.match(auth, /lower\(trim\("email"\)\) = \$\{normalizedEmail\}/);
  assert.match(auth, /OR "normalizedEmail" = \$\{normalizedEmail\}/);
  assert.match(auth, /CustomerAccountIdentityConflictError/);
  assert.match(auth, /findCustomerAccountByNormalizedEmail/);
  assert.match(auth, /findOrCreateCustomerAccountByNormalizedEmail/);
  assert.doesNotMatch(auth, /customerAccount\.upsert\(\{\s*\r?\n\s*where:\s*\{\s*email\s*\}/);
  assert.match(rewards, /findOrCreateCustomerAccountByNormalizedEmail\(email, tx\)/);
  assert.match(rewards, /CustomerAccountIdentityConflictError/);
  assert.match(rewards, /status: "customer_account_conflict"/);

  assert.match(http, /privateNoStoreHeaders/);
  assert.match(http, /Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate"/);
  assert.match(sessionRoute, /privateOk/);
  assert.match(addressRoute, /privateJson/);
  assert.match(addressRoute, /withPrivateNoStore/);
  assert.match(accountPages, /unstable_noStore as noStore/);
  assert.equal((accountPages.match(/noStore\(\)/g) || []).length, 8);
});

test("customer account UI polish keeps account creation optional and mobile-safe", () => {
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const accountDashboard = sourceSlice(
    accountComponents,
    "export function AccountDashboard",
    "export function AccountSecurityUnavailable"
  );
  const accountLogin = sourceSlice(
    accountComponents,
    "const loginBenefits",
    "export function AccountOrders"
  );
  const css = readProjectFile("src/app/globals.css");
  const cartClient = readProjectFile("src/components/StorefrontClient.tsx");
  const desktopAuthCss = sourceSlice(
    css,
    "@media (min-width: 961px)",
    "@media (min-width: 961px) and (max-height: 820px)"
  );
  const desktopAuthShellRule = cssRule(desktopAuthCss, ".gdg-auth-focused-shell");
  const desktopAuthContentRule = cssRule(desktopAuthCss, ".gdg-account-shell.auth-focused");
  const loginBenefitIconRule = cssRule(css, ".gdg-login-page .gdg-login-benefit-icon");
  const loginBenefitSvgRule = cssRule(css, ".gdg-login-page .gdg-login-benefit-icon svg");

  assert.match(accountLogin, /gdg-login-page/);
  assert.match(accountLogin, /CustomerAuthWelcomePanel/);
  assert.match(accountLogin, /GrabbyMascot/);
  assert.match(accountLogin, /Welcome back, Collector!/);
  assert.doesNotMatch(accountLogin, /gdg-login-brand-mark/);
  assert.doesNotMatch(accountLogin, /GameDayGrabs Account/);
  assert.match(accountLogin, /Hey there! I'm Grabby\./);
  assert.match(accountLogin, /Let's get you signed in so we can keep the good pulls coming!/);
  assert.match(accountLogin, /Earn Rewards/);
  assert.match(accountLogin, /Collect points on eligible purchases/);
  assert.match(accountLogin, /Track Orders/);
  assert.match(accountLogin, /Check status and view order history/);
  assert.match(accountLogin, /Secure & Easy/);
  assert.match(accountLogin, /Your account is protected/);
  assert.match(accountLogin, /Sign In/);
  assert.match(accountLogin, /Create Account/);
  assert.match(accountLogin, /Forgot Password\?/);
  assert.match(accountLogin, /Email sign-in link/);
  assert.match(accountLogin, /No password\? We'll send a secure one-time sign-in link\./);
  assert.match(accountLogin, /New rewards account\? Create or verify it first\./);
  assert.match(accountLogin, /Guest checkout is always available\./);
  assert.match(accountLogin, /Use your checkout email for rewards\./);
  assert.doesNotMatch(accountLogin, /Create an account to track orders and rewards\. Guest checkout is still available/);
  assert.match(accountLogin, /Rewards redemption coming soon\./);
  assert.match(accountLogin, /Your session expired\. Sign in again to continue\./);
  assert.match(accountLogin, /action="\/api\/account\/login"/);
  assert.match(accountLogin, /action="\/api\/account\/register"/);
  assert.match(accountLogin, /action="\/api\/account\/magic-link\/request"/);
  assert.match(accountLogin, /action="\/api\/account\/forgot-password"/);
  assert.match(accountLogin, /action="\/api\/account\/reset-password"/);
  assert.match(accountLogin, /Use the same email you used at checkout or POS/);
  assert.match(accountLogin, /If points were earned before you created a password/);
  assert.doesNotMatch(accountLogin, /Keep me signed in/);
  assert.doesNotMatch(accountLogin, /Pok[e\u00e9] Ball|official Pok[e\u00e9]mon|Nintendo|protected artwork|franchise-protected/i);
  assert.match(accountComponents, /Account Overview/);
  assert.match(accountComponents, /Welcome back/);
  assert.match(accountComponents, /Signed in as <strong>\{account\.email\}<\/strong>/);
  assert.match(accountComponents, /Track orders, rewards, saved addresses, and support in one\s+place/);
  assert.match(accountComponents, /Guest checkout stays available\. No account required to buy\./);
  assert.match(accountComponents, /Track your collection orders/);
  assert.match(accountDashboard, /AccountHeroGrabby/);
  assert.match(accountComponents, /GrabbyMascot variant="welcome" size="large" className="account-overview"/);
  assert.match(accountComponents, /Grabby has your dashboard ready\./);
  assert.doesNotMatch(accountComponents, /DashboardCardFan/);
  assert.doesNotMatch(accountComponents, /gdg-account-card-fan/);
  assert.match(accountDashboard, /RewardsInfoStrip/);
  assert.match(accountComponents, /gdg-rewards-info-strip/);
  assert.match(accountComponents, /gdg-rewards-spotlight/);
  assert.match(accountComponents, /gdg-rewards-summary-grid/);
  assert.match(css, /\.gdg-rewards-spotlight\s*\{[\s\S]*?grid-template-columns: 170px minmax\(0, 1fr\) minmax\(330px, 0\.72fr\);/);
  assert.match(css, /\.gdg-rewards-summary-grid\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(accountDashboard, /recentOrderItem = previewOrders\[0\]\?\.items\.find\(\(item\) => item\.imageUrl\)/);
  assert.match(accountDashboard, /recentOrderImageUrl = recentOrderItem\?\.imageUrl/);
  assert.match(accountDashboard, /gdg-account-orders-preview-visual has-image/);
  assert.match(accountDashboard, /alt=\{recentOrderImageAlt\}/);
  assert.match(accountDashboard, /Image unavailable/);
  assert.match(accountDashboard, /Purchases will appear here/);
  assert.match(accountDashboard, /previewItem\?\.imageUrl/);
  assert.match(accountDashboard, /thumbnail/);
  for (const label of ["Purchases", "Rewards", "Saved Addresses", "Order Status", "Support"]) {
    assert.match(accountComponents, new RegExp(label));
  }
  for (const label of ["Purchase History", "Points", "Saved Addresses", "Support / Order Status"]) {
    assert.match(accountDashboard, new RegExp(label));
  }
  assert.match(accountDashboard, /Earn 1 point per \$1 on eligible product purchases/);
  assert.match(accountDashboard, /Redemption coming soon/);
  assert.match(accountDashboard, /Rewards redemption coming soon/);
  assert.match(accountDashboard, /Display only/);
  assert.match(accountComponents, /const availablePoints = balance\?\.availablePoints \?\? 0/);
  assert.match(accountComponents, /const lifetimeEarnedPoints = balance\?\.lifetimeEarnedPoints \?\? 0/);
  assert.match(accountComponents, /const pendingPoints = balance\?\.pendingPoints \?\? 0/);
  assert.match(accountComponents, /Points are display-only and do not affect checkout totals yet\./);
  assert.match(accountDashboard, /Online orders and linked in-store purchases appear here/);
  assert.doesNotMatch(accountDashboard, /gdg-account-grabby-card/);
  assert.doesNotMatch(accountDashboard, /variant="support"/);
  assert.doesNotMatch(accountDashboard, /Grabby can point you to order status, policies, and support/);
  assert.doesNotMatch(accountDashboard, /Saved addresses make future checkout easier/);
  assert.doesNotMatch(accountDashboard, /Manage addresses/);
  assert.doesNotMatch(accountDashboard, /Contact <a href=\{\`mailto:\$\{GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL\}\`\}/);
  assert.doesNotMatch(accountDashboard, /gdg-account-support-panel/);
  assert.doesNotMatch(accountComponents, /section: "security", label: "Security", href: "\/account\/security"/);
  assert.doesNotMatch(accountComponents, /Redeem points|Apply points|reward discount|points discount/i);
  assert.match(css, /\.gdg-address-form/);
  assert.match(accountComponents, /focusedAuth = false/);
  assert.match(accountComponents, /focusedAuth \? null : <StorefrontFooter/);
  assert.match(accountComponents, /gdg-auth-focused-shell/);
  assert.match(accountComponents, /gdg-account-shell\$\{focusedAuth \? " auth-focused" : ""\}/);
  assert.match(css, /\.gdg-account-tabs/);
  assert.match(css, /\.gdg-account-magic-option/);
  assert.match(css, /\.gdg-login-page/);
  assert.match(css, /\.gdg-login-welcome/);
  assert.doesNotMatch(css, /\.gdg-login-brand-mark/);
  assert.match(css, /\.gdg-login-auth-card/);
  assert.match(css, /\.gdg-login-grabby/);
  assert.match(css, /\.gdg-login-magic-form/);
  assert.match(css, /\.gdg-auth-focused-shell/);
  assert.match(css, /\.gdg-account-shell\.auth-focused/);
  assert.match(css, /min-height:\s*calc\(100svh - 106px\)/);
  assert.match(desktopAuthShellRule, /height:\s*100dvh/);
  assert.match(desktopAuthShellRule, /min-height:\s*100dvh/);
  assert.match(desktopAuthShellRule, /overflow:\s*hidden/);
  assert.match(desktopAuthContentRule, /flex:\s*1 1 auto/);
  assert.match(desktopAuthContentRule, /min-height:\s*0/);
  assert.match(css, /\.gdg-login-input input:-webkit-autofill/);
  assert.match(css, /-webkit-box-shadow:\s*0 0 0 1000px #fffdf7 inset !important/);
  assert.match(css, /-webkit-text-fill-color:\s*#101828 !important/);
  assert.match(css, /background-color:\s*#fffdf7 !important/);
  assert.match(css, /\.gdg-login-benefit\s*\{\s*\r?\n\s*display: grid;\s*\r?\n\s*grid-template-columns: 52px minmax\(0, 1fr\)/);
  assert.match(css, /\.gdg-login-page \.gdg-login-benefit-icon/);
  assert.match(loginBenefitIconRule, /display:\s*flex/);
  assert.match(loginBenefitIconRule, /align-items:\s*center/);
  assert.match(loginBenefitIconRule, /justify-content:\s*center/);
  assert.match(loginBenefitIconRule, /width:\s*52px/);
  assert.match(loginBenefitIconRule, /height:\s*52px/);
  assert.match(loginBenefitSvgRule, /margin:\s*0/);
  assert.match(loginBenefitSvgRule, /transform:\s*none/);
  assert.match(css, /\.gdg-login-page \.gdg-login-benefit p strong,\s*\r?\n\s*\.gdg-login-page \.gdg-login-benefit p span/);
  assert.doesNotMatch(css, /\.gdg-login-benefit strong,\s*\r?\n\s*\.gdg-login-benefit span/);
  assert.match(css, /\.gdg-login-page,\s*\r?\n\s*\.gdg-login-page\.single\s*\{\s*\r?\n\s*grid-template-columns: 1fr/);
  assert.match(css, /\.gdg-login-magic-form\s*\{\s*\r?\n\s*grid-template-columns: 1fr/);
  assert.match(css, /\.gdg-account-hero-dashboard/);
  assert.match(css, /\.gdg-account-hero-grabby/);
  assert.match(css, /\.gdg-account-hero-grabby \.grabby-mascot\.account-overview/);
  assert.match(css, /\.gdg-account-stat-grid/);
  assert.match(css, /\.gdg-account-dashboard-layout/);
  assert.match(css, /\.gdg-account-preview-row/);
  assert.match(css, /\.gdg-account-orders-preview-visual/);
  assert.match(css, /\.gdg-account-orders-preview-visual\.has-image/);
  assert.match(css, /\.gdg-account-orders-preview-visual img/);
  assert.doesNotMatch(css, /\.gdg-account-card-fan/);
  assert.doesNotMatch(css, /\.gdg-account-card-box/);
  assert.match(css, /\.gdg-account-nav/);
  assert.match(css, /\.gdg-account-shell::before/);
  assert.match(css, /\.gdg-account-stat-card:nth-child\(1\)/);
  assert.match(css, /\.gdg-account-rewards-panel::after/);
  assert.match(css, /\.gdg-rewards-info-strip/);
  assert.match(css, /\.gdg-account-preview-thumb img/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.gdg-account-shell > \* \+ \*/);
  assert.match(css, /padding:\s*20px 0 calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /linear-gradient\(180deg, #ffffff 0%, #fffdf7 42%, #f8faf7 100%\)/);
  assert.doesNotMatch(css, /\.gdg-account-shell\s*\{[\s\S]{0,520}#05080d/);
  assert.doesNotMatch(css, /\.gdg-account-nav\s*\{[\s\S]{0,420}rgba\(255, 255, 255, 0\.08\)/);
  assert.doesNotMatch(css, /\.gdg-account-hero-copy h1\s*\{[\s\S]{0,180}color: #ffffff/);
  assert.doesNotMatch(css, /\.gdg-account-rewards-panel\s*\{[\s\S]{0,420}#26114f/);
  assert.match(css, /\.gdg-account-dashboard,\s*\r?\n\s*\.gdg-account-dashboard-layout,\s*\r?\n\s*\.gdg-account-side-stack,\s*\r?\n\s*\.gdg-rewards-main-grid\s*\{\s*\r?\n\s*gap: 18px/);
  assert.match(css, /\.gdg-account-rewards-panel::after\s*\{\s*\r?\n\s*right: -36px;\s*\r?\n\s*top: -30px;\s*\r?\n\s*width: 108px;\s*\r?\n\s*opacity: 0\.16/);
  assert.match(css, /\.gdg-rewards-summary-card::after\s*\{[\s\S]*?right: -36px;[\s\S]*?bottom: -42px;[\s\S]*?width: 112px;/);
  assert.match(css, /\.gdg-rewards-info-strip\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[\s\S]*?gap: 12px;[\s\S]*?border-radius: 20px;[\s\S]*?padding: 14px/);
  assert.match(css, /\.gdg-account-progress-label\s*\{[\s\S]*?flex-wrap: wrap/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.gdg-rewards-info-strip > div\s*\{\s*\r?\n\s*grid-template-columns: 52px minmax\(0, 1fr\)/);
  assert.match(css, /\.gdg-account-hero-actions,\s*\r?\n\s*\.gdg-account-hero-actions form,\s*\r?\n\s*\.gdg-account-hero-actions \.gdg-primary-button,\s*\r?\n\s*\.gdg-account-hero-actions \.gdg-secondary-button\s*\{\s*\r?\n\s*width: 100%/);
  assert.match(css, /\.gdg-account-nav::-webkit-scrollbar\s*\{\s*\r?\n\s*display: none/);
  assert.match(css, /\.gdg-address-form,\s*\r?\n\s*\.gdg-address-actions\s*\{\s*\r?\n\s*grid-template-columns: 1fr/);
  assert.match(cartClient, /No account required/);
  assert.match(cartClient, /Guest checkout available/);
  assert.doesNotMatch(accountComponents, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|costBasis|netProfit|supplier|private lot|passwordHash|magic-link token|reset token/i);
});

test("storefront exposes optional account entry points without requiring login for checkout", () => {
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const types = readProjectFile("src/types/radar.ts");

  assert.match(types, /customerAccounts:\s*\{\s*\r?\n\s*enabled: boolean/);
  assert.match(storefront, /customerAccountFeatureConfig\(\)/);
  assert.match(storefront, /enabled: accountFeatures\.customerAccountsEnabled/);
  assert.match(client, /fetch\("\/api\/account\/session", \{ cache: "no-store", credentials: "same-origin" \}\)/);
  assert.match(client, /accountSignedIn \? "\/account" : "\/account\/login"/);
  assert.match(client, /accountSignedIn \? "My Account" : "Sign In \/ Create Account"/);
  assert.match(client, /className="gdg-account-entry"/);
  assert.match(client, /gdg-mobile-account-nav/);
  assert.match(client, /<button\s*\r?\n\s*className="gdg-account-entry"/);
  assert.match(client, /customerAccountMenuLinks\.map\(\(item\) => \(/);
  assert.match(client, /<Link href="\/account\/login" className="gdg-cart-account-link">\s*\r?\n\s*Create an account\s*\r?\n\s*<\/Link>/);
  assert.match(client, /to track orders\{settings\.customerAccounts\.rewardsEnabled \? " and rewards" : ""\}/);
  assert.match(client, /Proceed to Secure Checkout/);
  assert.match(client, /No account required/);
  assert.match(client, /Guest checkout available/);
  assert.doesNotMatch(client, /redeem points|apply points|points discount|reward discount/i);
});

test("storefront header exposes a signed-in account dropdown and mobile account links", () => {
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const headerSource = sourceSlice(client, "export function StorefrontHeader", "export function StorefrontFooter");
  const css = readProjectFile("src/app/globals.css");
  const logoutRoute = readProjectFile("src/app/api/account/logout/route.ts");

  assert.match(client, /customerAccountMenuLinks/);
  for (const [label, href] of [
    ["My Account", "/account"],
    ["My Orders", "/account/orders"],
    ["Rewards", "/account/rewards"],
    ["Saved Addresses", "/account/addresses"],
    ["Order Status", "/order-status"]
  ]) {
    assert.match(client, new RegExp(`label: "${label}"`));
    assert.match(client, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`));
  }
  assert.doesNotMatch(client, /label: "Account Security"/);
  assert.doesNotMatch(client, /href: "\/account\/security"/);

  assert.match(client, /accountSignedIn \? "\/account" : "\/account\/login"/);
  assert.match(client, /Sign In \/ Create Account/);
  assert.match(client, /aria-haspopup="menu"/);
  assert.match(client, /aria-expanded=\{accountMenuOpen\}/);
  assert.match(client, /role="menu"/);
  assert.match(client, /role="menuitem"/);
  assert.match(client, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(client, /event\.key === "Escape"/);
  assert.match(client, /action="\/api\/account\/logout"/);
  assert.match(client, /gdg-mobile-account-menu/);
  assert.match(client, /setMenuOpen\(false\)/);
  assert.match(logoutRoute, /clearCustomerSessionCookie/);
  assert.match(logoutRoute, /status:\s*303/);

  assert.match(css, /\.gdg-account-menu/);
  assert.match(css, /\.gdg-account-dropdown/);
  assert.match(css, /\.gdg-account-dropdown\.open/);
  assert.match(css, /width: min\(260px, calc\(100vw - 28px\)\)/);
  assert.match(css, /\.gdg-mobile-account-menu/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /\.gdg-account-menu\s*\{\s*\r?\n\s*display: none/);
  assert.doesNotMatch(headerSource, /redeem points|apply points|points discount|reward discount|coupon/i);
  assert.doesNotMatch(headerSource, /passwordHash|tokenHash|magic-link token|reset token|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|adminNotes|costBasis|supplier|private lot/i);
});

test("customer session timeout warning is client-side safe and keeps guest cart separate", () => {
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const css = readProjectFile("src/app/globals.css");
  const sessionController = sourceSlice(client, "function CustomerSessionExpiryController", "function subscribeCart");
  const sessionHook = sourceSlice(client, "function useCustomerAccountSession", "function CustomerSessionExpiryController");

  assert.match(client, /customerSessionEventKey = "gdg-customer-session-event"/);
  assert.match(client, /broadcastCustomerSessionEvent/);
  assert.match(sessionController, /Your session is about to expire due to inactivity\./);
  assert.match(sessionController, /Stay signed in/);
  assert.match(sessionController, /Sign out/);
  assert.match(sessionController, /\/api\/account\/session\/refresh/);
  assert.match(sessionController, /\/api\/account\/logout/);
  assert.match(sessionController, /timeout\.idleExpiresAt/);
  assert.match(sessionController, /timeout\.warningSeconds/);
  assert.match(sessionController, /Guest cart items remain separate and are not removed/);
  assert.match(client, /window\.localStorage\.setItem\(customerSessionEventKey/);
  assert.match(sessionHook, /detail\.reason === "logout" \|\| detail\.reason === "expired"/);
  assert.match(sessionHook, /window\.location\.pathname\.startsWith\("\/account"\)/);
  assert.doesNotMatch(sessionHook, /localStorage\.setItem\([^)]*(token|sessionId|tokenHash|password|magic)/i);
  assert.match(css, /\.gdg-session-warning/);
  assert.match(css, /\.gdg-session-warning-card/);
  assert.match(css, /\.gdg-session-warning-actions/);
  assert.match(client, /const cartKey = "poke-radar-cart"/);
  assert.doesNotMatch(sessionController, /removeItem\(cartKey\)|setItem\(cartKey|writeCart\(\[\]\)|shippingQuote|zip/i);
});

test("customer magic link tokens are hashed, one-time, and stored outside admin auth", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const requestRoute = readProjectFile("src/app/api/account/magic-link/request/route.ts");
  const verifyRoute = readProjectFile("src/app/api/account/magic-link/verify/route.ts");
  const schema = readProjectFile("prisma/schema.prisma");

  assert.match(auth, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(auth, /hashCustomerMagicLinkToken\(token\)/);
  assert.match(auth, /tokenHash,\s*\r?\n\s*expiresAt/);
  assert.match(schema, /tokenHash\s+String\s+@unique/);
  assert.doesNotMatch(auth, /token:\s*token\b/);
  assert.doesNotMatch(schema, /\btoken\s+String\b/);

  const verifyFunction = sourceSlice(auth, "export async function verifyCustomerMagicLink", "export async function setCustomerSessionCookie");
  assert.match(verifyFunction, /record\.usedAt/);
  assert.match(verifyFunction, /record\.expiresAt\.getTime\(\)\s*<=\s*now\.getTime\(\)/);
  assert.match(verifyFunction, /usedAt:\s*now/);
  assert.match(verifyFunction, /emailVerifiedAt/);

  assert.match(auth, /gdg_customer_session/);
  assert.match(auth, /__Host-gdg_customer_session/);
  assert.doesNotMatch(auth, /poke_radar_session|admin_session/i);
  assert.match(requestRoute, /requestCustomerMagicLink/);
  assert.match(verifyRoute, /setCustomerSessionCookie/);
  assert.match(verifyRoute, /clearCustomerSessionCookie/);
});

test("customer magic link email uses existing provider safely without raw payment data", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const requestFunction = sourceSlice(auth, "export async function requestCustomerMagicLink", "export async function verifyCustomerMagicLink");

  assert.match(requestFunction, /sendEmailViaProvider/);
  assert.match(requestFunction, /Your GameDayGrabs account login link/);
  assert.match(requestFunction, /X-Entity-Ref-ID/);
  assert.match(requestFunction, /X-GDD-Notification-Type/);
  assert.match(requestFunction, /notificationType/);
  assert.match(requestFunction, /customer_account_magic_link/);
  assert.match(requestFunction, /idempotencyKey:\s*`customer-account-magic-link:\$\{tokenHash\}`/);
  assert.doesNotMatch(requestFunction, /card number|cardNumber|cvc|payment_method|paymentMethod|raw Stripe|webhook body|stripePaymentIntent|stripeCheckoutSession/i);
});

test("customer password login register and reset are hashed token-based and guest checkout safe", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const loginRoute = readProjectFile("src/app/api/account/login/route.ts");
  const registerRoute = readProjectFile("src/app/api/account/register/route.ts");
  const forgotRoute = readProjectFile("src/app/api/account/forgot-password/route.ts");
  const resetRoute = readProjectFile("src/app/api/account/reset-password/route.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const checkoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );
  const registerFunction = sourceSlice(auth, "export async function registerCustomerAccountWithPassword", "export async function authenticateCustomerPassword");
  const loginFunction = sourceSlice(auth, "export async function authenticateCustomerPassword", "export async function requestCustomerPasswordReset");
  const forgotFunction = sourceSlice(auth, "export async function requestCustomerPasswordReset", "export async function resetCustomerPassword");
  const resetFunction = sourceSlice(auth, "export async function resetCustomerPassword", "export async function verifyCustomerMagicLink");

  assert.match(auth, /import bcrypt from "bcryptjs"/);
  assert.match(auth, /bcrypt\.hash\(password, 12\)/);
  assert.match(loginFunction, /passwordHashForCompare/);
  assert.match(loginFunction, /bcrypt\.compare\(input\.password, passwordHashForCompare\)/);
  assert.match(auth, /const customerAccountLookupSelect = \{/);
  assert.match(auth, /passwordHash:\s*true/);
  assert.match(registerFunction, /findCustomerAccountByNormalizedEmail\(email\)/);
  assert.match(registerFunction, /const passwordHash = await hashCustomerPassword\(input\.password\)/);
  assert.match(registerFunction, /passwordHash,\s*\r?\n\s*passwordSetAt/);
  assert.match(registerFunction, /else if \(existingAccount\.status === "active" && !existingAccount\.passwordHash\)/);
  assert.match(registerFunction, /prisma\.customerAccount\.update\(\{\s*\r?\n\s*where: \{ id: existingAccount\.id \}/);
  assert.doesNotMatch(registerFunction, /else if \(existingAccount\.status === "active" && existingAccount\.passwordHash\)/);
  assert.match(registerFunction, /requestCustomerMagicLink/);
  assert.doesNotMatch(registerFunction, /emailVerifiedAt:\s*new Date|lastLoginAt:\s*new Date/);
  assert.match(loginFunction, /!account\.emailVerifiedAt/);
  assert.match(loginFunction, /verificationEmail = await requestCustomerMagicLink/);
  assert.match(forgotFunction, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(forgotFunction, /hashCustomerPasswordResetToken\(token\)/);
  assert.match(forgotFunction, /customerPasswordResetToken\.create/);
  assert.match(forgotFunction, /Reset your GameDayGrabs account password/);
  assert.match(forgotFunction, /idempotencyKey:\s*`customer-account-password-reset:\$\{tokenHash\}`/);
  assert.match(resetFunction, /customerPasswordResetToken\.findUnique/);
  assert.match(resetFunction, /record\.usedAt/);
  assert.match(resetFunction, /record\.expiresAt\.getTime\(\)\s*<=\s*now\.getTime\(\)/);
  assert.match(resetFunction, /passwordSetAt:\s*now/);
  assert.match(resetFunction, /usedAt:\s*now/);
  assert.match(loginRoute, /Email or password is incorrect/);
  assert.match(accountComponents, /Use the email sign-in link or reset your password if needed/);
  assert.match(loginRoute, /setCustomerSessionCookie/);
  assert.match(resetRoute, /setCustomerSessionCookie/);
  assert.match(resetRoute, /clearCustomerSessionCookie/);
  assert.doesNotMatch(resetRoute, /searchParams\.set\("token"/);
  assert.match(registerRoute, /registerCustomerAccountWithPassword/);
  assert.match(forgotRoute, /sent_if_eligible/);
  assert.match(accountComponents, /Use your checkout email for rewards/);
  assert.match(accountComponents, /No password\? We'll send a secure one-time sign-in link/);
  assert.match(accountComponents, /If points were earned before you created a password/);
  assert.match(accountComponents, /Guest checkout is always available/);
  assert.match(accountComponents, /Redemption coming soon/);
  assert.doesNotMatch(checkoutSession, /CustomerPasswordResetToken|passwordHash|passwordSetAt|customerPassword|redeem|points discount|reward discount/i);
  assert.doesNotMatch(auth + loginRoute + registerRoute + forgotRoute + resetRoute + accountComponents, /plainTextPassword|rawPassword|token:\s*token\b|cardNumber|cvc|payment_method_details|raw Stripe|webhook body|costBasis|supplier/i);
});

test("password registration repairs magic-link accounts without replacing existing passwords", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const registerFunction = sourceSlice(auth, "export async function registerCustomerAccountWithPassword", "export async function authenticateCustomerPassword");
  const verifyFunction = sourceSlice(auth, "export async function verifyCustomerMagicLink", "export async function setCustomerSessionCookie");
  const resetFunction = sourceSlice(auth, "export async function resetCustomerPassword", "export async function verifyCustomerMagicLink");
  const addressRoute = readProjectFile("src/app/api/account/addresses/route.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");

  assert.match(registerFunction, /const existingAccount = await findCustomerAccountByNormalizedEmail\(email\)/);
  assert.match(auth, /passwordHash:\s*true/);
  assert.match(registerFunction, /const passwordHash = await hashCustomerPassword\(input\.password\)/);
  assert.match(registerFunction, /const passwordSetAt = new Date\(\)/);
  assert.match(registerFunction, /if \(!existingAccount\) \{/);
  assert.match(registerFunction, /else if \(existingAccount\.status === "active" && !existingAccount\.passwordHash\) \{/);
  assert.match(registerFunction, /passwordHash,\s*\r?\n\s*passwordSetAt/);
  assert.match(registerFunction, /\.\.\.\(displayName && !existingAccount\.displayName \? \{ displayName \} : \{\}\)/);
  assert.match(registerFunction, /normalizedEmail:\s*email/);
  assert.doesNotMatch(registerFunction, /where:\s*\{\s*email\s*\},\s*\r?\n\s*data:\s*\{\s*passwordHash/);
  assert.doesNotMatch(registerFunction, /passwordHash:\s*null|passwordSetAt:\s*null/);

  assert.match(verifyFunction, /emailVerifiedAt: account\.emailVerifiedAt \?\? now/);
  assert.match(verifyFunction, /lastLoginAt:\s*now/);
  assert.doesNotMatch(verifyFunction, /passwordSetAt|data:\s*\{[\s\S]{0,180}passwordHash/);

  assert.match(resetFunction, /passwordHash,\s*\r?\n\s*passwordSetAt:\s*now/);
  assert.match(resetFunction, /normalizedEmail: normalizeCustomerAccountEmail\(record\.customerAccount\.email\)/);
  assert.match(resetFunction, /emailVerifiedAt: record\.customerAccount\.emailVerifiedAt \?\? now/);
  assert.match(addressRoute, /currentCustomerAccount\(\)/);
  assert.match(addressRoute, /createCustomerSavedAddress\(account, input\.input\)/);
  assert.match(accountComponents, /Use the email sign-in link or reset your password if needed/);
  assert.match(accountComponents, /Use the same email you used at checkout or POS/);
});

test("customer account dashboard and order pages require a verified customer session", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const accountPage = readProjectFile("src/app/account/page.tsx");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");
  const sessionRoute = readProjectFile("src/app/api/account/session/route.ts");
  const refreshRoute = readProjectFile("src/app/api/account/session/refresh/route.ts");
  const logoutRoute = readProjectFile("src/app/api/account/logout/route.ts");

  const currentAccountFunction = sourceSlice(auth, "export async function currentCustomerAccountSessionStatus", "export async function currentCustomerAccount");
  assert.match(currentAccountFunction, /if \(!customerAccountsEnabled\(\)\)/);
  assert.match(currentAccountFunction, /verifyCustomerSessionToken/);
  assert.match(currentAccountFunction, /ignoreExpiration: config\.customerSessionTimeoutsEnabled/);
  assert.match(currentAccountFunction, /hashCustomerSessionToken\(token\)/);
  assert.match(currentAccountFunction, /prisma\.customerSession\.findUnique/);
  assert.match(currentAccountFunction, /resolveCustomerSessionTimeout/);
  assert.match(currentAccountFunction, /shouldTouchCustomerSessionActivity/);
  assert.match(currentAccountFunction, /lastActivityAt: now/);
  assert.match(currentAccountFunction, /timeoutState\.reason !== "active"/);
  assert.match(auth, /!account\.emailVerifiedAt/);
  assert.match(auth, /account\.normalizedEmail \?\? normalizeCustomerAccountEmail\(account\.email\)/);
  assert.match(auth, /requireVerifiedCustomerAccountIdentity/);
  assert.match(auth, /export async function setCustomerSessionCookie/);
  assert.match(auth, /prisma\.customerSession\.create/);
  assert.match(auth, /tokenHash: hashCustomerSessionToken\(token\)/);
  assert.match(auth, /absoluteExpiresAt/);
  assert.match(auth, /userAgentSummary/);
  assert.match(auth, /export async function revokeCurrentCustomerSession/);
  assert.match(logoutRoute, /revokeCurrentCustomerSession\("logout"\)/);
  assert.match(logoutRoute, /clearCustomerSessionCookie/);
  assert.match(sessionRoute, /currentCustomerAccountSessionStatus\(\{ touchActivity: false \}\)/);
  assert.match(sessionRoute, /timeout: status\.timeout/);
  assert.match(sessionRoute, /if \(status\.shouldClearCookie\) clearCustomerSessionCookie\(response\)/);
  assert.match(refreshRoute, /currentCustomerAccountSessionStatus\(\{ touchActivity: true \}\)/);
  assert.match(refreshRoute, /timeout: status\.timeout/);
  assert.match(refreshRoute, /clearCustomerSessionCookie\(response\)/);
  assert.match(accountPage, /listCustomerAccountOrders\(account\)/);
  assert.match(accountPage, /noStore\(\)/);
  assert.match(accountPage, /account \? <AccountDashboard/);
  assert.match(accountPage, /recentOrders=\{recentOrders\}/);
  assert.match(accountPage, /<AccountSignInRequired/);
  assert.match(ordersPage, /listCustomerAccountOrders\(account\)/);
  assert.match(ordersPage, /noStore\(\)/);
  assert.match(ordersPage, /<AccountSignInRequired title="Sign in to view your order history\."/);
});

test("customer security center backend remains gated while customer-facing UI is removed", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const securityPage = readProjectFile("src/app/account/security/page.tsx");
  const securityRoute = readProjectFile("src/app/api/account/security/sessions/route.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const config = readProjectFile("src/lib/customer-accounts.ts");
  const security = readProjectFile("src/lib/customer-account-security.ts");

  const listSessions = sourceSlice(auth, "export async function listCustomerAccountSecuritySessions", "async function findOwnedCustomerSessionByRef");
  const findSession = sourceSlice(auth, "async function findOwnedCustomerSessionByRef", "export async function revokeCustomerAccountSecuritySession");
  const revokeSession = sourceSlice(auth, "export async function revokeCustomerAccountSecuritySession", "export async function signOutOtherCustomerSecuritySessions");
  const signOutOther = sourceSlice(auth, "export async function signOutOtherCustomerSecuritySessions", "export async function signOutAllCustomerSecuritySessions");
  const signOutAll = sourceSlice(auth, "export async function signOutAllCustomerSecuritySessions", "export function clearCustomerSessionCookie");
  const loginAlert = sourceSlice(auth, "export function customerLoginAlertText", "export async function requestCustomerMagicLink");
  const sessionStatus = sourceSlice(auth, "export async function currentCustomerAccountSessionStatus", "export async function currentCustomerAccount");
  const accountSecurityUnavailable = sourceSlice(accountComponents, "export function AccountSecurityUnavailable", "export function CustomerLoginPageContent");

  assert.match(config, /customerSecurityCenterEnabled:\s*boolean/);
  assert.match(config, /customerLoginAlertsEnabled:\s*boolean/);
  assert.match(config, /CUSTOMER_SECURITY_CENTER_ENABLED/);
  assert.match(config, /CUSTOMER_LOGIN_ALERTS_ENABLED/);
  assert.match(securityPage, /AccountSecurityUnavailable/);
  assert.doesNotMatch(securityPage, /customerSecurityCenterEnabled\(\)/);
  assert.doesNotMatch(securityPage, /currentCustomerAccount\(\)/);
  assert.doesNotMatch(securityPage, /listCustomerAccountSecuritySessions/);
  assert.match(securityPage, /robots:\s*\{\s*\r?\n\s*index:\s*false/);
  assert.doesNotMatch(accountComponents, /\{ section: "security", label: "Security", href: "\/account\/security"/);
  assert.match(accountSecurityUnavailable, /Account security is handled automatically/);
  assert.match(accountSecurityUnavailable, /rate limiting, and session timeouts active/);
  assert.doesNotMatch(accountSecurityUnavailable, /Active Sessions|Your signed-in devices|Only sessions for this verified account|Sign out all other devices|Sign out all devices|Revoke session|Sign out this session/);
  assert.doesNotMatch(client, /label: "Account Security"/);
  assert.doesNotMatch(client, /href: "\/account\/security"/);

  assert.match(listSessions, /customerSecurityCenterEnabled\(\)/);
  assert.match(listSessions, /requireVerifiedCustomerAccountIdentity\(account\)/);
  assert.match(listSessions, /customerAccountId: account\.id/);
  assert.match(listSessions, /currentTokenHash/);
  assert.match(listSessions, /safeCustomerDeviceSummary\(session\.userAgentSummary\)/);
  assert.match(listSessions, /ref: customerSessionActionRef\(session\.id\)/);
  assert.match(findSession, /customerAccountId: account\.id/);
  assert.match(findSession, /customerSessionActionRef\(session\.id\) === cleanRef/);
  assert.match(revokeSession, /where:\s*\{\s*\r?\n\s*id: session\.id,\s*\r?\n\s*customerAccountId: account\.id/);
  assert.match(revokeSession, /revokedCurrent/);
  assert.match(signOutOther, /tokenHash: \{ not: currentTokenHash \}/);
  assert.match(signOutAll, /customerAccountId: account\.id/);
  assert.match(signOutAll, /sessionRevokedBefore: now/);
  assert.match(sessionStatus, /customerSessionTrackingEnabled\(config\)/);
  assert.match(sessionStatus, /session\.revokedAt/);
  assert.match(sessionStatus, /shouldClearCookie: true/);

  assert.match(securityRoute, /assertCustomerSameOriginRequest\(request\)/);
  assert.match(securityRoute, /hasClientSuppliedCustomerOwnership\(input\.raw\)/);
  assert.match(securityRoute, /currentCustomerAccount\(\)/);
  assert.match(securityRoute, /revokeCustomerAccountSecuritySession\(account, input\.sessionRef\)/);
  assert.match(securityRoute, /signOutOtherCustomerSecuritySessions\(account\)/);
  assert.match(securityRoute, /signOutAllCustomerSecuritySessions\(account\)/);
  assert.match(securityRoute, /clearCustomerSessionCookie\(response\)/);
  assert.match(security, /"sessionId"/);
  assert.match(security, /"customerAccountId"/);

  assert.match(auth, /export function safeCustomerDeviceSummary/);
  assert.match(auth, /Chrome.*Windows/s);
  assert.match(auth, /Safari.*iPhone/s);
  assert.match(auth, /Mobile browser/);
  assert.match(loginAlert, /new sign-in/);
  assert.match(loginAlert, /Device:/);
  assert.match(loginAlert, /To review your account/);
  assert.doesNotMatch(loginAlert, /active sessions|\/account\/security/);
  assert.doesNotMatch(loginAlert, /ip address|token hash|session token|reset token|password|payment method|card number|cvc|raw stripe/i);
  assert.doesNotMatch(accountSecurityUnavailable, /tokenHash|sessionId|customerAccountId|passwordHash|magic-link token|reset token|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|adminNotes|costBasis|supplier|private lot|ipAddress|fullIp/i);
});

test("customer purchase history combines verified-email orders and linked POS sales safely", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const security = readProjectFile("src/lib/customer-account-security.ts");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderHistory = sourceSlice(auth, "export async function listCustomerAccountOrders", "export async function getCustomerAccountOrderDetail");

  assert.match(orderHistory, /const where = customerVisibleOrderWhere\(account\)/);
  assert.match(orderHistory, /if \(!where\) return \[\]/);
  assert.match(security, /export function customerVisibleOrderWhere/);
  assert.match(security, /export function customerVisiblePosSaleWhere/);
  assert.match(security, /isTestOrder:\s*false/);
  assert.match(security, /customerAccountId: identity\.customerAccountId/);
  assert.match(security, /\{ customerAccountId: null, customerEmail: identity\.email \}/);
  assert.match(security, /customerAccountId: null,\s*\r?\n\s*customer: \{ is: \{ email: identity\.email \} \}/);
  assert.match(security, /platform: \{ notIn: \["website", "test", "smoke"\] \}/);
  assert.match(orderHistory, /const posWhere = customerVisiblePosSaleWhere\(account\)/);
  assert.match(orderHistory, /prisma\.inventorySale\.findMany/);
  assert.match(orderHistory, /select: customerVisiblePosSaleSelect/);
  assert.match(orderHistory, /groupCustomerPosSales\(posSales\)/);
  assert.match(orderHistory, /customerPosSaleHistoryItem/);
  assert.match(auth, /detailKey: `pos:\$\{key\}`/);
  assert.match(auth, /sourceLabel: customerPosSourceLabel\(sourceType\)/);
  assert.match(orderHistory, /rewardPointsByPosSaleKey\(account\.id/);
  assert.match(orderHistory, /select:\s*\{\s*\r?\n\s*publicTitle:\s*true,\s*\r?\n\s*imageUrl:\s*true,\s*\r?\n\s*quantity:\s*true/);
  assert.match(orderHistory, /imageUrl:\s*item\.imageUrl/);
  assert.match(orderHistory, /take:\s*100/);
  assert.match(ordersPage, /searchParams/);
  assert.match(ordersPage, /orderHistoryView\(params\.view\)/);
  assert.match(ordersPage, /view === "online" \|\| view === "in-store" \|\| view === "all"/);
  assert.match(accountComponents, /Online orders and linked in-store purchases tied to your verified account appear here/);
  assert.match(accountComponents, /Private payment references hidden/);
  assert.match(accountComponents, /No purchases found for this account yet/);
  assert.match(accountComponents, /Purchase History/);
  assert.match(auth, /In-Store Purchase/);
  assert.match(auth, /Local Purchase/);
  assert.match(accountComponents, /Guest order lookup remains available/);
  assert.match(accountComponents, /Tracking/);
  assert.match(accountComponents, /Pickup status/);
  assert.match(accountComponents, /Receipt/);
  assert.match(accountComponents, /Purchase type/);
  assert.match(accountComponents, /Rewards earned/);
  assert.match(accountComponents, /Refund\/cancel status/);
  assert.match(accountComponents, /orderHistoryFilters/);
  assert.match(accountComponents, /Online/);
  assert.match(accountComponents, /In-Store/);
  assert.match(accountComponents, /view=online/);
  assert.match(accountComponents, /view=in-store/);
  assert.match(accountComponents, /orderHistoryFiltered\(orders, view\)/);
  assert.match(accountComponents, /orderHistoryStatusCategory/);
  assert.match(accountComponents, /This order was refunded/);
  assert.match(accountComponents, /This order was canceled/);
  assert.match(accountComponents, /This checkout expired/);

  assert.doesNotMatch(orderHistory + accountComponents, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|customerLinkNote|customerLinkReason|paymentReference|costBasis|netProfit|profitLoss|roiPercent|supplier|private lot|billingAddress/i);
});

test("customer account purchase detail is verified scoped and customer safe", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const security = readProjectFile("src/lib/customer-account-security.ts");
  const detailPage = readProjectFile("src/app/account/orders/[orderNumber]/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderStatusRoute = readProjectFile("src/app/api/storefront/order-status/route.ts");
  const detailFunction = sourceSlice(auth, "export async function getCustomerAccountOrderDetail");
  const detailComponent = sourceSlice(accountComponents, "export function AccountOrderDetail", "export function AccountRewards");

  assert.match(detailPage, /customerAccountsEnabled\(\)/);
  assert.match(detailPage, /currentCustomerAccount\(\)/);
  assert.match(detailPage, /getCustomerAccountOrderDetail\(account, decodeURIComponent\(orderNumber\)\)/);
  assert.match(detailPage, /AccountOrderNotFound/);
  assert.match(detailPage, /robots:\s*\{\s*\r?\n\s*index:\s*false/);

  assert.match(detailPage, /noStore\(\)/);
  assert.match(detailFunction, /cleanOrderNumber\.startsWith\("pos:"\)/);
  assert.match(detailFunction, /const saleKey = cleanOrderNumber\.slice\(4\)\.trim\(\)/);
  assert.match(detailFunction, /const where = customerVisiblePosSaleWhere\(account, saleKey\)/);
  assert.match(detailFunction, /prisma\.inventorySale\.findMany/);
  assert.match(detailFunction, /return customerPosSaleDetail\(group\.key, group\.sales/);
  assert.match(detailFunction, /const where = customerVisibleOrderWhere\(account, cleanOrderNumber\)/);
  assert.match(detailFunction, /if \(!where\) return null/);
  assert.match(security, /orderNumber: cleanOrderNumber/);
  assert.match(security, /customerVisiblePosSaleWhere/);
  assert.match(security, /customerAccountId: identity\.customerAccountId/);
  assert.match(security, /saleReference: cleanSaleKey/);
  assert.match(security, /id: cleanSaleKey/);
  assert.match(security, /isTestOrder:\s*false/);
  assert.match(security, /customerAccountId: identity\.customerAccountId/);
  assert.match(detailFunction, /select:\s*\{/);
  assert.match(detailFunction, /shippingTrackingNumber:\s*true/);
  assert.match(detailFunction, /shippingTrackingUrl:\s*true/);
  assert.match(detailFunction, /shippingCarrier:\s*true/);
  assert.match(detailFunction, /shippingService:\s*true/);
  assert.match(detailFunction, /unitPrice:\s*true/);
  assert.match(detailFunction, /lineTotal:\s*true/);

  assert.match(detailComponent, /export function AccountOrderDetail/);
  assert.match(detailComponent, /safe customer-facing/);
  assert.match(detailComponent, /Private payment references, internal notes, cost basis, and profit details\s+are not shown/);
  assert.match(detailComponent, /Purchase Details/);
  assert.match(detailComponent, /Payment method/);
  assert.match(detailComponent, /Receipt reference/);
  assert.match(detailComponent, /Purchase Summary/);
  assert.match(detailComponent, /Rewards earned/);
  assert.match(detailComponent, /order\.tax === null \? "Not recorded" : money\(order\.tax\)/);
  assert.match(detailComponent, /Carrier \/ service/);
  assert.match(detailComponent, /Tracking number/);
  assert.match(detailComponent, /Pickup status/);
  assert.match(detailComponent, /Not required/);
  assert.match(detailComponent, /Refund\/cancel status/);
  assert.match(detailComponent, /Customer account pages do not provide\s*\r?\n\s*cancellation or refund actions/);
  assert.match(accountComponents, /Use Guest Order Lookup/);
  assert.match(accountComponents, /View Details/);
  assert.match(orderStatusRoute, /lookupPublicOrderStatus\(input\)/);

  assert.doesNotMatch(detailFunction + detailPage + detailComponent, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|stripeRefundId|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|notes:\s*true|customerLinkNote|customerLinkReason|paymentReference|costBasis|netProfit|profitLoss|roiPercent|supplier|private lot|billingLine|billingAddress/i);
});

test("saved address book is verified-account scoped and checkout-isolated", () => {
  const addressHelper = readProjectFile("src/lib/customer-addresses.ts");
  const addressRoute = readProjectFile("src/app/api/account/addresses/route.ts");
  const addressPage = readProjectFile("src/app/account/addresses/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const addressComponents = sourceSlice(accountComponents, "export function AccountAddresses");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const checkoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );

  assert.match(addressPage, /CustomerAccountsComingSoon/);
  assert.match(addressPage, /currentCustomerAccount/);
  assert.match(addressPage, /AccountAddresses account=\{account\} status=\{firstParam\(params\.addressStatus\)\}/);
  assert.match(addressRoute, /customerAccountsEnabled\(\)/);
  assert.match(addressRoute, /currentCustomerAccount\(\)/);
  assert.match(addressRoute, /privateJson\(\{ error: "Sign in required\." \}, 401\)/);
  assert.match(addressRoute, /createCustomerSavedAddress/);
  assert.match(addressRoute, /updateCustomerSavedAddress/);
  assert.match(addressRoute, /deleteCustomerSavedAddress/);
  assert.match(addressRoute, /setDefaultCustomerSavedAddress/);

  assert.match(addressHelper, /customerAccountId: account\.id/g);
  assert.match(addressHelper, /updateMany\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
  assert.match(addressHelper, /deleteMany\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
  assert.match(addressHelper, /findFirst\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
  assert.match(addressRoute, /addressActionSchema/);
  assert.match(addressRoute, /\.strict\(\)/);
  assert.match(addressRoute, /z\.enum\(\["create", "update", "delete", "default"\]\)/);
  assert.doesNotMatch(addressRoute, /Boolean\(json\.isDefault\)/);
  assert.match(addressHelper, /\^\\d\{5\}\(\?:-\\d\{4\}\)\?\$/);
  assert.match(addressHelper, /country.*\|\| "US"/);

  assert.match(addressComponents, /Save Address/);
  assert.match(addressComponents, /Save Changes/);
  assert.match(addressComponents, /Make Default/);
  assert.match(addressComponents, /Delete/);
  assert.match(addressComponents, /Checkout still collects shipping or pickup details normally and does not\s+prefill/);
  assert.doesNotMatch(checkoutSession, /CustomerSavedAddress|savedAddress|account\/addresses|customerSavedAddress/i);
  assert.doesNotMatch(addressHelper + addressRoute + addressComponents, /stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|webhook body|costBasis|netProfit|supplier|private lot|adminNotes/i);
});

test("guest order lookup and account surfaces do not expose POS customer capture data", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const lookup = sourceSlice(storefront, "export async function lookupPublicOrderStatus", "export async function storefrontSummary");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const rewardActivity = sourceSlice(rewards, "export async function listCustomerRewardActivity");

  assert.match(lookup, /const orderNumber = input\.orderNumber\.trim\(\)\.toUpperCase\(\)/);
  assert.match(lookup, /const email = normalizedCustomerEmail\(input\.email\)/);
  assert.match(lookup, /if \(!order\) return \{ found: false, message: publicOrderLookupMiss \}/);
  assert.match(lookup, /normalizedCustomerEmail\(order\.customerEmail \?\? order\.customer\?\.email\) !== email/);
  assert.match(lookup, /return \{ found: false, message: publicOrderLookupMiss \}/);
  assert.doesNotMatch(lookup, /customerAccountId|rewardBalance|rewardLedgerEntries|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|adminNotes|costBasis|netProfit|supplier|private lot/i);

  assert.match(rewardActivity, /where: \{ customerAccountId: account\.id \}/);
  assert.doesNotMatch(rewardActivity, /input\.customerAccountId|searchParams|params\.customerAccountId|query\.customerAccountId/i);
  assert.doesNotMatch(accountComponents, /customerMatchMethod|rewardsEligible|POS customer|POS receipt|InventorySale|refundNote|authenticityNotes/i);
});

test("paid webhook awards reward points once without changing checkout totals", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const checkoutSession = sourceSlice(
    storefront,
    "export async function createCheckoutSession",
    "export async function createInvoiceRequest"
  );
  const webhook = sourceSlice(
    storefront,
    "export async function handleStripeWebhook",
    "export async function updateInventoryStoreListing"
  );
  const onlineAward = sourceSlice(
    rewards,
    "export async function awardRewardsForPaidOrder",
    "export async function releasePendingRewardsForOrder"
  );

  assert.ok(
    webhook.indexOf("order = await loadFreshStorefrontOrder(order.id)") >= 0,
    "webhook must reload the order after sale finalization so rewards do not see stale pending state"
  );
  assert.ok(
    webhook.indexOf("order = await loadFreshStorefrontOrder(order.id)") < webhook.indexOf("await awardRewardsForPaidOrder(order)"),
    "reward awarding must run after the fresh paid order reload"
  );
  assert.match(webhook, /if \(!wasPaid && order\.paymentStatus === "paid"\) await awardRewardsForPaidOrder\(order\)/);
  assert.match(rewards, /export async function awardRewardsForPaidOrder/);
  assert.match(rewards, /config\.customerAccountsEnabled && config\.customerRewardsEnabled/);
  assert.match(onlineAward, /const persistedOrder = await loadRewardOrder\(tx, order\.id\)/);
  assert.match(onlineAward, /if \(persistedOrder\.isTestOrder\) return \{ status: "test_order" as const, points: 0 \}/);
  assert.match(onlineAward, /if \(persistedOrder\.paymentStatus !== "paid"\) return \{ status: "not_paid" as const, points: 0 \}/);
  assert.match(onlineAward, /idempotencyKey: `rewards:earn:\$\{persistedOrder\.id\}`/);
  assert.match(onlineAward, /shippingCentsExcluded/);
  assert.match(onlineAward, /taxCentsExcluded/);
  assert.match(onlineAward, /status: "pending"/);
  assert.match(onlineAward, /availableAt: rewardAvailableAt\(now\)/);
  assert.match(onlineAward, /pendingDelta: points/);
  assert.match(onlineAward, /lifetimeEarnedDelta: points/);
  assert.doesNotMatch(onlineAward, /availableDelta:\s*points[,}]/);
  assert.doesNotMatch(checkoutSession, /reward|points|coupon|discount|promotion_code|allow_promotion_codes|redeem/i);
});

test("pending rewards release after fulfillment without duplicate balance movement", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const updateOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");
  const release = sourceSlice(rewards, "export async function releasePendingRewardsForOrder", "export async function reverseRewardsForOrder");

  assert.match(updateOrder, /await releasePendingRewardsForOrder\(finalOrder\.id, nextFulfillmentStatus\)/);
  assert.match(updateOrder, /nextFulfillmentStatus === "shipped" \|\| nextFulfillmentStatus === "picked_up"/);
  assert.match(release, /normalizedRewardLedgerStatus\(entry\) !== "pending"/);
  assert.match(release, /reason !== "delay_elapsed"/);
  assert.match(release, /availableAt\.getTime\(\) <= now\.getTime\(\)/);
  assert.match(release, /let claimedReleasePoints = 0/);
  assert.match(release, /where: \{ id: entry\.id, status: "pending" \}/);
  assert.match(release, /status: entryReleasePoints > 0 \? "available" : "canceled"/);
  assert.match(release, /if \(claimed\.count !== 1\) continue/);
  assert.match(release, /pendingDelta: -claimedReleasePoints/);
  assert.match(release, /availableDelta: claimedReleasePoints/);
  assert.doesNotMatch(release, /metadataJson: undefined/);
});

test("refund cancellation and test markers reverse rewards without redemption", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const updateOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");

  assert.match(cancelOrRefund, /const updatedOrder = await runRewardSerializableTransaction\(async \(tx\) =>/);
  assert.match(cancelOrRefund, /await reverseRewardsForOrder\(\s*updated,/);
  assert.match(cancelOrRefund, /refundedAmount: moneyFromCents\(newRefundedCents\)[\s\S]*?tx\s*\)/);
  assert.match(cancelOrRefund, /reason: refundCents > 0 \? "refund" : "cancel"/);
  assert.match(cancelOrRefund, /idempotencyKey: input\.idempotencyKey/);
  assert.match(updateOrder, /await reverseRewardsForOrder\(finalOrder/);
  assert.match(updateOrder, /reason: "test_order"/);
  assert.match(rewards, /targetReversal/);
  assert.match(rewards, /cumulativeRefundedCents/);
  assert.match(rewards, /Math\.floor\(\(currentEarned \* cumulativeRefundedCents\) \/ eligibleSubtotalCents\)/);
  assert.match(rewards, /points: -actualPointsToReverse/);
  assert.match(rewards, /type: "reverse"/);
  assert.match(rewards, /pendingToReverse/);
  assert.match(rewards, /availableToReverse/);
  assert.match(rewards, /pendingDelta: pendingToReverse > 0 \? -pendingToReverse : 0/);
  assert.match(rewards, /availableDelta: availableToReverse > 0 \? -availableToReverse : 0/);
  assert.match(rewards, /partialRefundLimitation/);
  assert.doesNotMatch(rewards, /lifetimeEarnedDelta:\s*-[^,\n}]+|lifetimeEarnedPoints:\s*\{\s*decrement/i);
  assert.doesNotMatch(rewards + cancelOrRefund + updateOrder, /coupon|promotion_code|allow_promotion_codes|redeem|apply.*discount/i);
});

test("customer rewards page shows balance activity and redemption coming soon", () => {
  const rewardsPage = readProjectFile("src/app/account/rewards/page.tsx");
  const components = readProjectFile("src/components/CustomerAccountPages.tsx");
  const tiers = readProjectFile("src/lib/reward-tiers.ts");
  const css = readProjectFile("src/app/globals.css");
  const accountRewards = sourceSlice(components, "export function AccountRewards", "export function AccountAddresses");

  assert.match(rewardsPage, /listCustomerRewardActivity\(account\)/);
  assert.match(accountRewards, /Your collection\. Your level\./);
  assert.match(accountRewards, /GrabbyMascot variant="rewards" size="large"/);
  assert.match(accountRewards, /gdg-rewards-spotlight/);
  assert.match(accountRewards, /gdg-rewards-summary-grid/);
  assert.match(accountRewards, /gdg-rewards-main-grid/);
  assert.match(accountRewards, /gdg-rewards-secondary/);
  assert.match(accountRewards, /<details className="gdg-rewards-panel activity">/);
  assert.match(accountRewards, /<details className="gdg-rewards-panel rules">/);
  assert.match(accountRewards, /<details className="gdg-rewards-panel help">/);
  assert.match(accountRewards, /Available points/);
  assert.match(accountRewards, /availablePoints/);
  assert.match(accountRewards, /Points pending/);
  assert.match(accountRewards, /pendingPoints/);
  assert.match(accountRewards, /Lifetime earned/);
  assert.match(accountRewards, /lifetimeEarnedPoints/);
  assert.match(accountRewards, /Points reversed/);
  assert.match(accountRewards, /visibleReversedPoints/);
  assert.match(accountRewards, /Redemption coming soon/);
  assert.match(accountRewards, /Points are display-only and do not affect checkout totals yet/);
  assert.match(tiers, /Rookie Collector/);
  assert.match(tiers, /Card Hunter/);
  assert.match(tiers, /Pack Pro/);
  assert.match(tiers, /Master Collector/);
  assert.match(tiers, /Legend Collector/);
  assert.match(accountRewards, /gdg-rewards-progress-track/);
  assert.match(tiers, /Math\.max\(0, Math\.min\(100, \(intervalPoints \/ interval\) \* 100\)\)/);
  assert.match(accountRewards, /gdg-rewards-tier-grid/);
  assert.match(accountRewards, /rewardTierState\(index, progress\.currentIndex\)/);
  assert.match(accountRewards, /RewardTierBadge tier=\{progress\.currentTier\}/);
  assert.match(accountRewards, /\{pointsLabel\(progress\.points\)\} \/ \{pointsLabel\(progressMax\)\} points/);
  assert.match(accountRewards, /Earn 1 point per \$1 spent on eligible product purchases/);
  assert.match(accountRewards, /Earn 1 point per \$1 on eligible product purchases/);
  assert.match(accountRewards, /Points may remain pending until shipped, picked up, or cleared/);
  assert.match(accountRewards, /Shipping, tax, discounts, canceled\/refunded items, and test\/smoke orders do not earn points/);
  assert.match(accountRewards, /Refunds\/cancellations may reverse points/);
  assert.match(accountRewards, /Points have no cash value/);
  assert.match(accountRewards, /Open only what you need/);
  assert.match(accountRewards, /Activity, rules, and help/);
  assert.match(accountRewards, /Recent activity/);
  assert.match(accountRewards, /activity\.map/);
  assert.match(accountRewards, /entry\.orderNumber/);
  assert.match(components, /entry\.status === "pending"/);
  assert.match(accountRewards, /rewardActivityView\(entry\)/);
  assert.match(accountRewards, /Start earning points on your next eligible purchase/);
  assert.match(accountRewards, /Eligible paid orders and matched POS sales will appear here after points are recorded/);
  assert.match(accountRewards, /View orders/);
  assert.match(accountRewards, /Rewards rules/);
  assert.match(accountRewards, /Contact support/);
  assert.doesNotMatch(accountRewards, /gdg-account-card gdg-rewards-explainer/);
  assert.doesNotMatch(accountRewards, /gdg-rewards-bottom-grid/);
  assert.doesNotMatch(accountRewards, /gdg-rewards-links-card/);
  assert.match(css, /\.gdg-rewards-spotlight\s*\{[\s\S]*?grid-template-columns: 170px minmax\(0, 1fr\) minmax\(330px, 0\.72fr\);/);
  assert.match(css, /\.gdg-rewards-summary-card\s*\{[\s\S]*?grid-template-columns: 54px minmax\(0, 1fr\);/);
  assert.match(css, /\.gdg-rewards-main-grid\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.gdg-rewards-level-card\s*\{[\s\S]*?display: grid;[\s\S]*?gap: 11px;/);
  assert.match(css, /\.gdg-rewards-progress-track\s*\{[\s\S]*?height: 10px;/);
  assert.match(css, /\.gdg-rewards-milestones\s*\{[\s\S]*?height: 34px;/);
  assert.match(css, /\.gdg-rewards-secondary\s*\{[\s\S]*?display: grid;[\s\S]*?gap: 12px;/);
  assert.match(css, /\.gdg-rewards-panel > summary\s*\{[\s\S]*?grid-template-columns: 38px minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.gdg-rewards-panel:not\(\[open\]\) > \.gdg-rewards-panel-body\s*\{[\s\S]*?display: none;/);
  assert.match(css, /\.gdg-rewards-rules-list li\s*\{[\s\S]*?grid-template-columns: 22px minmax\(0, 1fr\);/);
  assert.match(css, /\.gdg-rewards-next-callout\s*\{[\s\S]*?grid-template-columns: 36px minmax\(0, 1fr\);/);
  assert.match(css, /\.gdg-reward-activity-list article\s*\{[\s\S]*?grid-template-columns: 38px minmax\(0, 1fr\) auto auto;/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.gdg-rewards-summary-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-rewards-summary-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.doesNotMatch(accountRewards, /redeem points|apply points|points discount|reward discount|coupon/i);
  assert.doesNotMatch(accountRewards, /metadataJson|adminNote|internalNote|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|cardNumber|cvc|raw Stripe|webhook body|costBasis|supplier|private lot/i);
});

test("success page and order confirmation include safe optional account rewards CTA", () => {
  const successPage = readProjectFile("src/app/checkout/success/page.tsx");
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const emailTemplates = readProjectFile("src/lib/storefront-email-templates.ts");
  const storefront = readProjectFile("src/lib/storefront.ts");

  assert.match(successPage, /customerAccountFeatureConfig/);
  assert.match(successPage, /accountCtaEnabled=\{customerAccountFeatures\.customerAccountsEnabled\}/);
  assert.match(client, /Create an account to track this order/);
  assert.match(client, /Rewards redemption coming soon/);
  assert.match(client, /No account required/);
  assert.match(emailTemplates, /Create your GameDayGrabs account to track orders and rewards/);
  assert.match(emailTemplates, /STOREFRONT_ACCOUNT_LOGIN_URL/);
  assert.match(storefront, /accountCtaEnabled: accountFeatures\.customerAccountsEnabled/);
  assert.match(storefront, /rewardsCtaEnabled: accountFeatures\.customerAccountsEnabled && accountFeatures\.customerRewardsEnabled/);
  assert.doesNotMatch(emailTemplates + client, /stripeCheckoutSessionId|stripePaymentIntentId|payment_method|raw Stripe|webhook body/i);
});

test("admin order detail displays rewards without redemption controls or private data", () => {
  const types = readProjectFile("src/types/radar.ts");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const app = readProjectFile("src/components/RadarApp.tsx");
  const config = readProjectFile("src/lib/customer-accounts.ts");
  const rewardPanel = sourceSlice(app, "<h3>Rewards Summary</h3>", "<h3>Profit Summary</h3>");
  const rewardMapper = sourceSlice(storefront, "function customerRewardSummaryForOrder", "function customerEmailEventStatusFromRecord");

  assert.match(types, /export type StorefrontRewardSummaryDTO/);
  assert.match(types, /export type StorefrontCustomerRewardSummaryDTO/);
  assert.match(types, /redemptionEnabled: false/);
  assert.match(types, /adminAdjustmentsEnabled: false/);
  assert.match(types, /pointsPending: number/);
  assert.match(types, /pointsAvailable: number/);
  assert.match(types, /status: string/);
  assert.match(types, /availableAt: string \| null/);
  assert.match(types, /settledAt: string \| null/);
  assert.match(storefront, /rewardSummary: rewardSummaryForOrder\(order\)/);
  assert.match(storefront, /customerRewardSummary: customerRewardSummaryForOrder\(order\)/);
  assert.match(storefront, /rewardBalance:\s*true/);
  assert.match(storefront, /rewardLedgerEntries:\s*\{/);
  assert.match(config, /CUSTOMER_POS_REWARDS_ENABLED/);
  assert.match(config, /customerPosRewardsEnabled/);
  assert.match(config, /CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED/);
  assert.match(config, /customerRewardAdminAdjustmentsEnabled/);
  assert.match(rewardPanel, /Rewards Summary/);
  assert.match(rewardPanel, /Points earned/);
  assert.match(rewardPanel, /Pending points/);
  assert.match(rewardPanel, /Available points/);
  assert.match(rewardPanel, /Points reversed/);
  assert.match(rewardPanel, /Customer available/);
  assert.match(rewardPanel, /Customer pending/);
  assert.match(rewardPanel, /Lifetime earned/);
  assert.match(rewardPanel, /formatStatus\(entry\.status\)/);
  assert.match(rewardPanel, /Recent customer reward ledger entries/);
  assert.match(rewardPanel, /Manual rewards adjustments disabled/);
  assert.match(rewardPanel, /disabled/);
  assert.match(rewardPanel, /Rewards redemption is not enabled/);
  assert.doesNotMatch(rewardPanel, /Redeem|Apply points|discount/i);
  assert.doesNotMatch(rewardMapper + rewardPanel, /metadataJson|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|raw Stripe|webhook body|cardNumber|cvc|costBasis|netProfit|supplier|private lot/i);
});
