import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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

const storefrontClient = readProjectFile("src/components/StorefrontClient.tsx");
const accountPages = readProjectFile("src/components/CustomerAccountPages.tsx");
const policiesPage = readProjectFile("src/app/policies/page.tsx");
const rewardsPage = readProjectFile("src/app/account/rewards/page.tsx");
const emails = readProjectFile("src/lib/storefront-email-templates.ts");
const rewardHelper = sourceSlice(storefrontClient, "function storefrontRewardsProgramCopy", "function storefrontRewardEstimateLabel");
const rewardEstimateHelper = sourceSlice(storefrontClient, "function storefrontRewardEstimateLabel", "function storefrontCalmAvailabilityLabel");
const accountRewardsCopy = sourceSlice(accountPages, "function accountRewardsCopy", "function AccountHeroGrabby");
const homepageAccountCta = sourceSlice(storefrontClient, "function HomepageAccountCta", "function HomepageGrabbyTip");
const checkoutSuccessClient = sourceSlice(storefrontClient, "export function CheckoutSuccessClient");
const orderConfirmationSender = sourceSlice(readProjectFile("src/lib/storefront.ts"), "async function sendStorefrontOrderConfirmationEmail", "function storefrontOrderReceiptRecipient");
const productCard = sourceSlice(storefrontClient, "function ProductCard", "function HomepageProductSection");
const productDetail = sourceSlice(storefrontClient, "export function ProductDetail", "function cartStockState");
const cartClient = sourceSlice(storefrontClient, "export function CartClient", "export function CheckoutSuccessClient");

test("customer-facing tax copy is plain and keeps historical unknown display unchanged", () => {
  assert.match(storefrontClient, /STOREFRONT_TAX_PAYMENT_COPY = "Any required taxes are shown before payment\."/);
  assert.match(productDetail, /STOREFRONT_TAX_PAYMENT_COPY/);
  assert.match(cartClient, /STOREFRONT_TAX_PAYMENT_COPY/);
  assert.match(cartClient, /Any required Local Pickup taxes are shown before payment\./);
  assert.match(accountPages, /order\.tax === null \? "Not recorded" : money\(order\.tax\)/);
  assert.doesNotMatch(storefrontClient, /browser cart|always zero|no tax will be charged|Stripe shows final tax|configured pickup location|feature flag/i);
});

test("rewards messaging is flag-driven and does not imply redemption while disabled", () => {
  assert.match(rewardHelper, /!settings\.customerAccounts\.enabled \|\| !settings\.customerAccounts\.rewardsEnabled\) return null/);
  assert.match(rewardHelper, /settings\.customerAccounts\.redemptionEnabled[\s\S]*?"Earn points on eligible purchases\. Manage rewards from your account\."/);
  assert.match(rewardHelper, /"Earn points on eligible purchases\. Redemption coming soon\."/);
  assert.doesNotMatch(rewardHelper, /Reward earning is currently paused/);
  assert.match(rewardEstimateHelper, /if \(isSoldOutProduct\(product\)\) return null/);
  assert.match(productCard, /const rewardProgramCopy = storefrontRewardsProgramCopy\(settings\)/);
  assert.match(productDetail, /Estimated from merchandise subtotal only; excludes shipping and tax\./);
  assert.match(cartClient, /const customerRewardsEnabled = settings\.customerAccounts\.enabled && settings\.customerAccounts\.rewardsEnabled/);
  assert.match(cartClient, /const estimatedRewardPoints = customerRewardsEnabled \? Math\.floor\(Math\.max\(0, subtotal\)\) : 0/);
  assert.match(cartClient, /Rewards apply to eligible merchandise\. Redemption coming soon\./);
  assert.match([storefrontClient, accountPages, policiesPage, rewardsPage, emails].join("\n"), /Reward earning is currently paused\. Redemption coming soon\./);
  assert.doesNotMatch([storefrontClient, accountPages, policiesPage, rewardsPage, emails].join("\n"), /Earn points now\. Redemption coming soon\./);
  assert.match(accountRewardsCopy, /const rewardsEnabled = config\.customerAccountsEnabled && config\.customerRewardsEnabled/);
  assert.match(accountRewardsCopy, /const redemptionEnabled = rewardsEnabled && config\.customerRewardRedemptionEnabled/);
  assert.match(accountRewardsCopy, /loginPillCopy: rewardsEnabled[\s\S]*"Earn points on eligible purchases\. Redemption coming soon\."[\s\S]*: "Reward earning is currently paused\."/);
  assert.match(accountRewardsCopy, /spotlightStatus: redemptionEnabled \? "Rewards active" : "Redemption coming soon"/);
  assert.match(accountRewardsCopy, /emptyActivityCopy: rewardsEnabled[\s\S]*"Eligible reward activity will appear here after qualifying purchases\."[\s\S]*: "Reward earning is currently paused\. Eligible activity will appear here when earning resumes\."/);
  assert.match(policiesPage, /const rewardsEnabled = accountFeatures\.customerAccountsEnabled && accountFeatures\.customerRewardsEnabled/);
  assert.match(policiesPage, /redemptionEnabled \? "Reward use is managed from your account\." : "Redemption is coming soon\. Points cannot be used at checkout yet\."/);
  assert.match(policiesPage, /Points have no cash value/);
  assert.doesNotMatch([storefrontClient, accountPages, policiesPage, rewardsPage, emails].join("\n"), /redeem points|apply points|cash equivalent|launch date|use points at checkout/i);
});

test("account, storefront, checkout, and email reward copy agree with feature state", () => {
  assert.match(homepageAccountCta, /const rewardsEnabled = accountsEnabled && settings\.customerAccounts\.rewardsEnabled/);
  assert.match(homepageAccountCta, /rewardsEnabled[\s\S]*\? storefrontRewardsProgramCopy\(settings\)[\s\S]*: accountsEnabled[\s\S]*\? "Reward earning is currently paused\. Redemption coming soon\."/);
  assert.match(homepageAccountCta, /: "Track your order anytime\."/);
  assert.match(homepageAccountCta, /rewardStatusCopy \?\? "No account required to buy\."/);
  assert.match(homepageAccountCta, /`Create an account to track orders\$\{rewardsEnabled \? " and rewards" : " and future rewards"\}\.`/);

  assert.match(checkoutSuccessClient, /rewardsCtaEnabled \? "Track earned and pending points in your account\. Earn points on eligible purchases\. Redemption coming soon\."/);
  assert.doesNotMatch(checkoutSuccessClient, /Reward earning is currently paused/);
  assert.match(checkoutSuccessClient, /rewardsCtaEnabled \? " and rewards" : ""/);
  assert.match(checkoutSuccessClient, /"Account creation is optional and guest checkout remains available\."/);

  assert.match(emails, /input\.rewardsCtaEnabled[\s\S]*\? "Create your GameDayGrabs account to track orders and rewards\. Earn points on eligible purchases\. Redemption coming soon\."/);
  assert.match(emails, /input\.accountCtaEnabled && input\.rewardsCtaEnabled \? "Earn points on eligible purchases\. Redemption coming soon\." : null/);
  assert.doesNotMatch(sourceSlice(emails, "function accountRewardsCtaCard", "function detailRows"), /Reward earning is currently paused/);

  assert.match(orderConfirmationSender, /accountFeatures\.customerRewardsEnabled[\s\S]*\? "Create your GameDayGrabs account to track orders and rewards\."/);
  assert.match(orderConfirmationSender, /accountFeatures\.customerRewardsEnabled \? "Earn points on eligible purchases\. Redemption coming soon\." : "Guest checkout remains available\."/);
  assert.match(orderConfirmationSender, /accountFeatures\.customerRewardsEnabled \? "Create your GameDayGrabs account to track orders and rewards\. Earn points on eligible purchases\. Redemption coming soon\." : "Create your GameDayGrabs account to track orders\. Guest checkout remains available\."/);
  assert.doesNotMatch(orderConfirmationSender, /Reward earning is currently paused/);
});

test("shop filters expose explicit labels dialog semantics and announced result state", () => {
  const productGrid = sourceSlice(storefrontClient, "export function ProductGrid", "export function StorefrontCollectionLanding");
  assert.match(productGrid, /id="gdg-shop-search-input"[\s\S]*?type="search"/);
  assert.match(productGrid, /htmlFor="gdg-shop-search-input"/);
  assert.match(productGrid, /htmlFor="gdg-shop-sort-filter"/);
  assert.match(productGrid, /role=\{filterSheetOpen \? "dialog" : undefined\}/);
  assert.match(productGrid, /aria-labelledby="gdg-shop-filters-title"/);
  assert.match(productGrid, /aria-describedby="gdg-shop-filter-summary"/);
  assert.match(productGrid, /id="gdg-shop-filter-summary" role="status" aria-live="polite"/);
  assert.match(productGrid, /aria-label=\{`Open shop filters/);
  assert.match(productGrid, /restoreTarget\?\.focus\(\)/);
  assert.match(productGrid, /event\.key === "Escape"/);
  assert.match(productGrid, /role="status" aria-live="polite" aria-busy=\{shopLoading \|\| undefined\}/);
});
