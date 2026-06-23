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
  assert.equal(config.accountProvider, "magic_link");
  assert.equal(config.rewardsProvider, "internal_ledger");
  assert.deepEqual(config.envVars, [
    "CUSTOMER_ACCOUNTS_ENABLED",
    "CUSTOMER_REWARDS_ENABLED",
    "CUSTOMER_REWARD_REDEMPTION_ENABLED"
  ]);
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
    "RewardLedgerEntry",
    "RewardBalance"
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`), `missing ${model}`);
  }

  assert.match(schema, /email\s+String\s+@unique/);
  assert.match(schema, /status\s+String\s+@default\("active"\)/);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /lastLoginAt\s+DateTime\?/);
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

test("customer account SQLite bootstrap stays aligned with the foundation schema", () => {
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");

  for (const table of ["CustomerAccount", "CustomerSavedAddress", "CustomerMagicLinkToken", "RewardLedgerEntry", "RewardBalance"]) {
    assert.match(sqliteInit, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  assert.match(sqliteInit, /ALTER TABLE "StorefrontOrder" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /ALTER TABLE "StorefrontCustomer" ADD COLUMN "customerAccountId" TEXT/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_email_key"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMagicLinkToken_tokenHash_key"/);
  assert.match(sqliteInit, /CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_customerAccountId_idx"/);
  assert.match(sqliteInit, /CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedgerEntry_idempotencyKey_key"/);
});

test("customer account routes are feature-flagged and keep guest checkout visible", () => {
  const accountPage = readProjectFile("src/app/account/page.tsx");
  const loginPage = readProjectFile("src/app/account/login/page.tsx");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");
  const rewardsPage = readProjectFile("src/app/account/rewards/page.tsx");
  const addressesPage = readProjectFile("src/app/account/addresses/page.tsx");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const magicLinkRequestRoute = readProjectFile("src/app/api/account/magic-link/request/route.ts");

  for (const source of [accountPage, ordersPage, rewardsPage, addressesPage]) {
    assert.match(source, /customerAccountsEnabled\(\)/);
    assert.match(source, /CustomerAccountsComingSoon/);
    assert.match(source, /currentCustomerAccount/);
  }

  assert.match(loginPage, /CustomerLoginPageContent/);
  assert.match(magicLinkRequestRoute, /customerAccountsEnabled\(\)/);
  assert.match(magicLinkRequestRoute, /status:\s*404/);
  assert.match(accountComponents, /Customer accounts coming soon/);
  assert.match(accountComponents, /Shop as Guest/);
  assert.match(accountComponents, /guest checkout remains available|You do not need an account to\s+place an order/i);
  assert.match(accountComponents, /action="\/api\/account\/magic-link\/request"/);
  assert.match(accountComponents, /type="email"/);
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

test("customer account dashboard and order pages require a verified customer session", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const accountPage = readProjectFile("src/app/account/page.tsx");
  const ordersPage = readProjectFile("src/app/account/orders/page.tsx");

  const currentAccountFunction = sourceSlice(auth, "export async function currentCustomerAccount", "function trackingUrlFor");
  assert.match(currentAccountFunction, /if \(!customerAccountsEnabled\(\)\) return null/);
  assert.match(currentAccountFunction, /verifyCustomerSessionToken/);
  assert.match(currentAccountFunction, /!account\.emailVerifiedAt/);
  assert.match(currentAccountFunction, /normalizeCustomerAccountEmail\(account\.email\)/);
  assert.match(accountPage, /account \? <AccountDashboard/);
  assert.match(accountPage, /<AccountSignInRequired/);
  assert.match(ordersPage, /listCustomerAccountOrders\(account\)/);
  assert.match(ordersPage, /<AccountSignInRequired title="Sign in to view your order history\."/);
});

test("customer order history is linked by verified email and exposes safe fields only", () => {
  const auth = readProjectFile("src/lib/customer-account-auth.ts");
  const accountComponents = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderHistory = sourceSlice(auth, "export async function listCustomerAccountOrders");

  assert.match(orderHistory, /if \(!email \|\| !account\.emailVerifiedAt\) return \[\]/);
  assert.match(orderHistory, /isTestOrder:\s*false/);
  assert.match(orderHistory, /customerEmail:\s*email/);
  assert.match(orderHistory, /customer:\s*\{\s*is:\s*\{\s*email\s*\}\s*\}/);
  assert.match(orderHistory, /select:\s*\{\s*\r?\n\s*publicTitle:\s*true,\s*\r?\n\s*quantity:\s*true/);
  assert.match(orderHistory, /take:\s*100/);
  assert.match(accountComponents, /No orders yet/);
  assert.match(accountComponents, /Guest order lookup remains available/);
  assert.match(accountComponents, /Tracking/);
  assert.match(accountComponents, /Pickup status/);
  assert.match(accountComponents, /Refund\/cancel status/);

  assert.doesNotMatch(orderHistory + accountComponents, /stripePaymentIntentId|stripeCheckoutSessionId|stripeCustomerId|payment_method|paymentMethod|cardNumber|cvc|raw Stripe|webhook body|adminNotes|internalNote|costBasis|netProfit|supplier|private lot|billingAddress/i);
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

  assert.match(types, /export type StorefrontRewardSummaryDTO/);
  assert.match(types, /redemptionEnabled: false/);
  assert.match(storefront, /rewardSummary: rewardSummaryForOrder\(order\)/);
  assert.match(app, /Rewards Summary/);
  assert.match(app, /Points earned/);
  assert.match(app, /Points reversed/);
  assert.match(app, /Rewards redemption is not enabled/);
  assert.doesNotMatch(app, /Redeem|Apply points|discount/i);
});
