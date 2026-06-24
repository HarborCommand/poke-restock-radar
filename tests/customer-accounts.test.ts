import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { customerAccountFeatureConfig } from "../src/lib/customer-accounts";

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

test("customer account and rewards feature flags default disabled", () => {
  const config = customerAccountFeatureConfig({});

  assert.equal(config.customerAccountsEnabled, false);
  assert.equal(config.customerRewardsEnabled, false);
  assert.equal(config.customerRewardRedemptionEnabled, false);
  assert.equal(config.accountProvider, "password_magic_link");
  assert.equal(config.rewardsProvider, "internal_ledger");
  assert.deepEqual(config.envVars, [
    "CUSTOMER_ACCOUNTS_ENABLED",
    "CUSTOMER_REWARDS_ENABLED",
    "CUSTOMER_REWARD_REDEMPTION_ENABLED",
    "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED"
  ]);
  assert.equal(config.customerRewardAdminAdjustmentsEnabled, false);
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

test("reward ledger idempotency migration is additive", () => {
  const migration = readProjectFile("prisma/migrations/20260623043000_reward_ledger_idempotency/migration.sql");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  assert.match(migration, /ALTER TABLE "RewardLedgerEntry" ADD COLUMN "idempotencyKey" TEXT/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.match(sqliteInit, /"idempotencyKey" TEXT/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
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

  for (const table of ["CustomerAccount", "CustomerSavedAddress", "CustomerMagicLinkToken", "CustomerPasswordResetToken", "RewardLedgerEntry", "RewardBalance"]) {
    assert.match(sqliteInit, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  assert.match(sqliteInit, /ALTER TABLE "StorefrontOrder" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "StorefrontCustomer" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_email_key"/);
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
  assert.match(magicLinkRequestRoute, /customerAccountsEnabled\(\)/);
  assert.match(magicLinkRequestRoute, /status:\s*404/);
  for (const route of [passwordLoginRoute, registerRoute, forgotPasswordRoute, resetPasswordRoute]) {
    assert.match(route, /customerAccountsEnabled\(\)/);
    assert.match(route, /status:\s*404/);
  }
  assert.match(accountComponents, /Customer accounts coming soon/);
  assert.match(accountComponents, /Shop as Guest/);
  assert.match(accountComponents, /guest checkout remains available|You do not need an account to\s+place an order/i);
  assert.match(accountComponents, /action="\/api\/account\/magic-link\/request"/);
  assert.match(accountComponents, /action="\/api\/account\/login"/);
  assert.match(accountComponents, /action="\/api\/account\/register"/);
  assert.match(accountComponents, /type="email"/);
});

test("customer account UI polish keeps account creation optional and mobile-safe", () => {
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const css = readProjectFile("src/app/globals.css");
  const cartClient = readProjectFile("src/components/StorefrontClient.tsx");

  assert.match(accountComponents, /Sign in or create an account/);
  assert.match(accountComponents, /No password needed if you prefer email login\. We'll send a secure sign-in link to your email\./);
  assert.match(accountComponents, /Forgot Password\?/);
  assert.match(accountComponents, /Create Account/);
  assert.match(accountComponents, /Email sign-in link/);
  assert.match(accountComponents, /Guest checkout is always available\./);
  assert.match(accountComponents, /Collector Dashboard/);
  assert.match(accountComponents, /Welcome back/);
  assert.match(accountComponents, /Signed in as <strong>\{account\.email\}<\/strong>/);
  assert.match(accountComponents, /Track orders, rewards, saved addresses, and support in one\s+place/);
  assert.match(accountComponents, /Guest checkout stays available\. No account required to buy\./);
  assert.match(accountComponents, /Track your collection orders/);
  for (const label of ["My Orders", "Rewards", "Saved Addresses", "Order Status", "Support"]) {
    assert.match(accountComponents, new RegExp(label));
  }
  for (const label of ["Orders", "Points", "Saved Addresses", "Support / Order Status"]) {
    assert.match(accountComponents, new RegExp(label));
  }
  assert.match(accountComponents, /Earn points on eligible purchases/);
  assert.match(accountComponents, /Redemption coming soon/);
  assert.match(accountComponents, /Rewards redemption coming soon/);
  assert.match(accountComponents, /Display only/);
  assert.match(accountComponents, /Orders placed with this verified email, including guest checkout orders, appear here/);
  assert.match(accountComponents, /Manage addresses/);
  assert.doesNotMatch(accountComponents, /Redeem points|Apply points|reward discount|points discount/i);
  assert.match(css, /\.gdg-address-form/);
  assert.match(css, /\.gdg-account-tabs/);
  assert.match(css, /\.gdg-account-magic-option/);
  assert.match(css, /\.gdg-account-hero-dashboard/);
  assert.match(css, /\.gdg-account-stat-grid/);
  assert.match(css, /\.gdg-account-dashboard-layout/);
  assert.match(css, /\.gdg-account-preview-row/);
  assert.match(css, /\.gdg-account-card-fan/);
  assert.match(css, /\.gdg-account-nav/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.gdg-account-hero-actions,\s*\r?\n\s*\.gdg-account-hero-actions form,\s*\r?\n\s*\.gdg-account-hero-actions \.gdg-primary-button,\s*\r?\n\s*\.gdg-account-hero-actions \.gdg-secondary-button\s*\{\s*\r?\n\s*width: 100%/);
  assert.match(css, /\.gdg-address-form,\s*\r?\n\s*\.gdg-address-actions\s*\{\s*\r?\n\s*grid-template-columns: 1fr/);
  assert.match(cartClient, /No account required/);
  assert.match(cartClient, /Guest checkout available/);
  assert.doesNotMatch(accountComponents, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|payment_method|paymentMethod|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|costBasis|netProfit|supplier|private lot|passwordHash|magic-link token|reset token/i);
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
  assert.match(client, /<Link href=\{accountHref\}>My Account<\/Link>/);
  assert.match(client, /Create an account to track orders\{settings\.customerAccounts\.rewardsEnabled \? " and rewards" : ""\}/);
  assert.match(client, /Proceed to Secure Checkout/);
  assert.match(client, /No account required/);
  assert.match(client, /Guest checkout available/);
  assert.doesNotMatch(client, /redeem points|apply points|points discount|reward discount/i);
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

  const verifyFunction = sourceSlice(auth, "export async function verifyCustomerMagicLink", "export function setCustomerSessionCookie");
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
  assert.match(loginFunction, /bcrypt\.compare\(input\.password, account\.passwordHash\)/);
  assert.match(registerFunction, /select:\s*\{\s*id:\s*true,\s*status:\s*true,\s*passwordHash:\s*true,\s*displayName:\s*true\s*\}/);
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
  assert.match(registerRoute, /registerCustomerAccountWithPassword/);
  assert.match(forgotRoute, /sent_if_eligible/);
  assert.match(accountComponents, /No password needed if you prefer email login/);
  assert.match(accountComponents, /Guest checkout is always available/);
  assert.match(accountComponents, /Redemption coming soon/);
  assert.doesNotMatch(checkoutSession, /CustomerPasswordResetToken|passwordHash|passwordSetAt|customerPassword|redeem|points discount|reward discount/i);
  assert.doesNotMatch(auth + loginRoute + registerRoute + forgotRoute + resetRoute + accountComponents, /plainTextPassword|rawPassword|token:\s*token\b|cardNumber|cvc|payment_method_details|raw Stripe|webhook body|costBasis|supplier/i);
});

test("password registration repairs magic-link accounts without replacing existing passwords", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const registerFunction = sourceSlice(auth, "export async function registerCustomerAccountWithPassword", "export async function authenticateCustomerPassword");
  const verifyFunction = sourceSlice(auth, "export async function verifyCustomerMagicLink", "export function setCustomerSessionCookie");
  const resetFunction = sourceSlice(auth, "export async function resetCustomerPassword", "export async function verifyCustomerMagicLink");
  const addressRoute = readProjectFile("src/app/api/account/addresses/route.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");

  assert.match(registerFunction, /const existingAccount = await prisma\.customerAccount\.findUnique/);
  assert.match(registerFunction, /passwordHash:\s*true/);
  assert.match(registerFunction, /const passwordHash = await hashCustomerPassword\(input\.password\)/);
  assert.match(registerFunction, /const passwordSetAt = new Date\(\)/);
  assert.match(registerFunction, /if \(!existingAccount\) \{/);
  assert.match(registerFunction, /else if \(existingAccount\.status === "active" && !existingAccount\.passwordHash\) \{/);
  assert.match(registerFunction, /passwordHash,\s*\r?\n\s*passwordSetAt/);
  assert.match(registerFunction, /\.\.\.\(displayName && !existingAccount\.displayName \? \{ displayName \} : \{\}\)/);
  assert.doesNotMatch(registerFunction, /where:\s*\{\s*email\s*\},\s*\r?\n\s*data:\s*\{\s*passwordHash/);
  assert.doesNotMatch(registerFunction, /passwordHash:\s*null|passwordSetAt:\s*null/);

  assert.match(verifyFunction, /emailVerifiedAt: account\.emailVerifiedAt \?\? now/);
  assert.match(verifyFunction, /lastLoginAt:\s*now/);
  assert.doesNotMatch(verifyFunction, /passwordHash|passwordSetAt/);

  assert.match(resetFunction, /passwordHash,\s*\r?\n\s*passwordSetAt:\s*now/);
  assert.match(resetFunction, /emailVerifiedAt: record\.customerAccount\.emailVerifiedAt \?\? now/);
  assert.match(addressRoute, /currentCustomerAccount\(\)/);
  assert.match(addressRoute, /createCustomerSavedAddress\(account, input\.input\)/);
  assert.match(accountComponents, /Use the email sign-in link or reset your password if needed/);
});

test("customer account dashboard and order pages require a verified customer session", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const accountPage = readProjectFile("src/app/account/page.tsx");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");

  const currentAccountFunction = sourceSlice(auth, "export async function currentCustomerAccount", "function trackingUrlFor");
  assert.match(currentAccountFunction, /if \(!customerAccountsEnabled\(\)\) return null/);
  assert.match(currentAccountFunction, /verifyCustomerSessionToken/);
  assert.match(currentAccountFunction, /!account\.emailVerifiedAt/);
  assert.match(currentAccountFunction, /normalizeCustomerAccountEmail\(account\.email\)/);
  assert.match(accountPage, /listCustomerAccountOrders\(account\)/);
  assert.match(accountPage, /account \? <AccountDashboard/);
  assert.match(accountPage, /recentOrders=\{recentOrders\}/);
  assert.match(accountPage, /<AccountSignInRequired/);
  assert.match(ordersPage, /listCustomerAccountOrders\(account\)/);
  assert.match(ordersPage, /<AccountSignInRequired title="Sign in to view your order history\."/);
});

test("customer order history is linked by verified email and exposes safe fields only", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderHistory = sourceSlice(auth, "export async function listCustomerAccountOrders", "export async function getCustomerAccountOrderDetail");

  assert.match(orderHistory, /if \(!email \|\| !account\.emailVerifiedAt\) return \[\]/);
  assert.match(orderHistory, /isTestOrder:\s*false/);
  assert.match(orderHistory, /customerEmail:\s*email/);
  assert.match(orderHistory, /customer:\s*\{\s*is:\s*\{\s*email\s*\}\s*\}/);
  assert.match(orderHistory, /select:\s*\{\s*\r?\n\s*publicTitle:\s*true,\s*\r?\n\s*quantity:\s*true/);
  assert.match(orderHistory, /take:\s*100/);
  assert.match(ordersPage, /searchParams/);
  assert.match(ordersPage, /orderHistoryView\(params\.view\)/);
  assert.match(accountComponents, /These orders were placed with your verified email, including guest checkout orders/);
  assert.match(accountComponents, /No payment method details\s+are shown/);
  assert.match(accountComponents, /Test orders hidden/);
  assert.match(accountComponents, /No orders found for this verified email yet/);
  assert.match(accountComponents, /Guest order lookup remains available/);
  assert.match(accountComponents, /Tracking/);
  assert.match(accountComponents, /Pickup status/);
  assert.match(accountComponents, /Refund\/cancel status/);
  assert.match(accountComponents, /orderHistoryFilters/);
  assert.match(accountComponents, /Active/);
  assert.match(accountComponents, /Completed/);
  assert.match(accountComponents, /Refunded \/ Canceled/);
  assert.match(accountComponents, /view=completed/);
  assert.match(accountComponents, /view=refunded-canceled/);
  assert.match(accountComponents, /orderHistoryFiltered\(orders, view\)/);
  assert.match(accountComponents, /orderHistoryCategory/);
  assert.match(accountComponents, /This order was refunded/);
  assert.match(accountComponents, /This order was canceled/);
  assert.match(accountComponents, /This checkout expired/);

  assert.doesNotMatch(orderHistory + accountComponents, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|payment_method|paymentMethod|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|costBasis|netProfit|supplier|private lot|billingAddress/i);
});

test("customer account order detail is verified-email scoped and customer safe", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
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

  assert.match(detailFunction, /if \(!email \|\| !account\.emailVerifiedAt \|\| !cleanOrderNumber\) return null/);
  assert.match(detailFunction, /orderNumber:\s*cleanOrderNumber/);
  assert.match(detailFunction, /isTestOrder:\s*false/);
  assert.match(detailFunction, /customerEmail:\s*email/);
  assert.match(detailFunction, /customer:\s*\{\s*is:\s*\{\s*email\s*\}\s*\}/);
  assert.match(detailFunction, /select:\s*\{/);
  assert.match(detailFunction, /shippingTrackingNumber:\s*true/);
  assert.match(detailFunction, /shippingTrackingUrl:\s*true/);
  assert.match(detailFunction, /shippingCarrier:\s*true/);
  assert.match(detailFunction, /shippingService:\s*true/);
  assert.match(detailFunction, /unitPrice:\s*true/);
  assert.match(detailFunction, /lineTotal:\s*true/);

  assert.match(detailComponent, /export function AccountOrderDetail/);
  assert.match(detailComponent, /safe customer-facing details/);
  assert.match(detailComponent, /Carrier \/ service/);
  assert.match(detailComponent, /Tracking number/);
  assert.match(detailComponent, /Pickup status/);
  assert.match(detailComponent, /Not required/);
  assert.match(detailComponent, /Refund\/cancel status/);
  assert.match(detailComponent, /Customer account pages do not provide\s*\r?\n\s*cancellation or refund actions/);
  assert.match(accountComponents, /Use Guest Order Lookup/);
  assert.match(accountComponents, /View Details/);
  assert.match(orderStatusRoute, /lookupPublicOrderStatus\(input\)/);

  assert.doesNotMatch(detailFunction + detailPage + detailComponent, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|stripeRefundId|payment_method|paymentMethod|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|notes:\s*true|costBasis|netProfit|profitLoss|supplier|private lot|billingLine|billingAddress/i);
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
  assert.match(addressRoute, /status:\s*401/);
  assert.match(addressRoute, /createCustomerSavedAddress/);
  assert.match(addressRoute, /updateCustomerSavedAddress/);
  assert.match(addressRoute, /deleteCustomerSavedAddress/);
  assert.match(addressRoute, /setDefaultCustomerSavedAddress/);

  assert.match(addressHelper, /customerAccountId: account\.id/g);
  assert.match(addressHelper, /updateMany\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
  assert.match(addressHelper, /deleteMany\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
  assert.match(addressHelper, /findFirst\(\{\s*\r?\n\s*where: \{ id: addressId, customerAccountId: account\.id \}/);
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

  assert.match(webhook, /if \(!wasPaid && order\.paymentStatus === "paid"\) await awardRewardsForPaidOrder\(order\)/);
  assert.match(rewards, /export async function awardRewardsForPaidOrder/);
  assert.match(rewards, /config\.customerAccountsEnabled && config\.customerRewardsEnabled/);
  assert.match(rewards, /if \(order\.isTestOrder\) return \{ status: "test_order" as const, points: 0 \}/);
  assert.match(rewards, /if \(order\.paymentStatus !== "paid"\) return \{ status: "not_paid" as const, points: 0 \}/);
  assert.match(rewards, /idempotencyKey: `rewards:earn:\$\{order\.id\}`/);
  assert.match(rewards, /shippingCentsExcluded/);
  assert.match(rewards, /taxCentsExcluded/);
  assert.match(rewards, /availablePoints: \{ increment: points \}/);
  assert.match(rewards, /lifetimeEarnedPoints: points > 0/);
  assert.doesNotMatch(checkoutSession, /reward|points|coupon|discount|promotion_code|allow_promotion_codes|redeem/i);
});

test("refund cancellation and test markers reverse rewards without redemption", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const rewards = readProjectFile("src/lib/customer-rewards.ts");
  const cancelOrRefund = sourceSlice(storefront, "export async function cancelOrRefundStorefrontOrder", "export async function updateStorefrontOrder");
  const updateOrder = sourceSlice(storefront, "export async function updateStorefrontOrder", "return storefrontOrderToDTO(finalOrder);");

  assert.match(cancelOrRefund, /await reverseRewardsForOrder\(updatedOrder/);
  assert.match(cancelOrRefund, /reason: refundCents > 0 \? "refund" : "cancel"/);
  assert.match(cancelOrRefund, /idempotencyKey: input\.idempotencyKey/);
  assert.match(updateOrder, /await reverseRewardsForOrder\(finalOrder/);
  assert.match(updateOrder, /reason: "test_order"/);
  assert.match(rewards, /targetReversal/);
  assert.match(rewards, /cumulativeRefundedCents/);
  assert.match(rewards, /Math\.floor\(\(earnedPoints \* cumulativeRefundedCents\) \/ eligibleSubtotalCents\)/);
  assert.match(rewards, /points: -currentPointsToReverse/);
  assert.match(rewards, /type: "reverse"/);
  assert.doesNotMatch(rewards + cancelOrRefund + updateOrder, /coupon|promotion_code|allow_promotion_codes|redeem|apply.*discount/i);
});

test("customer rewards page shows balance activity and redemption coming soon", () => {
  const rewardsPage = readProjectFile("src/app/account/rewards/page.tsx");
  const components = readProjectFile("src/components/CustomerAccountPages.tsx");

  assert.match(rewardsPage, /listCustomerRewardActivity\(account\)/);
  assert.match(components, /Track your GameDayGrabs points/);
  assert.match(components, /Available points/);
  assert.match(components, /Lifetime earned/);
  assert.match(components, /Recent activity/);
  assert.match(components, /Redemption coming soon/);
  assert.match(components, /Points are display-only and do not affect checkout totals yet/);
  assert.doesNotMatch(components, /redeem points|apply points|discount/i);
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
  assert.match(storefront, /rewardSummary: rewardSummaryForOrder\(order\)/);
  assert.match(storefront, /customerRewardSummary: customerRewardSummaryForOrder\(order\)/);
  assert.match(storefront, /rewardBalance:\s*true/);
  assert.match(storefront, /rewardLedgerEntries:\s*\{/);
  assert.match(config, /CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED/);
  assert.match(config, /customerRewardAdminAdjustmentsEnabled/);
  assert.match(rewardPanel, /Rewards Summary/);
  assert.match(rewardPanel, /Points earned/);
  assert.match(rewardPanel, /Points reversed/);
  assert.match(rewardPanel, /Customer available/);
  assert.match(rewardPanel, /Lifetime earned/);
  assert.match(rewardPanel, /Recent customer reward ledger entries/);
  assert.match(rewardPanel, /Manual rewards adjustments disabled/);
  assert.match(rewardPanel, /disabled/);
  assert.match(rewardPanel, /Rewards redemption is not enabled/);
  assert.doesNotMatch(rewardPanel, /Redeem|Apply points|discount/i);
  assert.doesNotMatch(rewardMapper + rewardPanel, /metadataJson|stripePaymentIntentId|stripeCheckoutSessionId|payment_method|raw Stripe|webhook body|cardNumber|cvc|costBasis|netProfit|supplier|private lot/i);
});
