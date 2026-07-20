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
const rewardEstimateHelper = sourceSlice(storefrontClient, "function storefrontRewardEstimateLabel", "function storefrontFulfillmentBadges");
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
  assert.match(rewardHelper, /settings\.customerAccounts\.redemptionEnabled[\s\S]*?"Earn points on eligible purchases\."/);
  assert.match(rewardHelper, /"Earn points now\. Redemption coming soon\."/);
  assert.match(rewardEstimateHelper, /if \(isSoldOutProduct\(product\)\) return null/);
  assert.match(productCard, /const rewardProgramCopy = storefrontRewardsProgramCopy\(settings\)/);
  assert.match(productDetail, /Estimated from merchandise subtotal only; excludes shipping and tax\./);
  assert.match(cartClient, /const estimatedRewardPoints = settings\.customerAccounts\.enabled && settings\.customerAccounts\.rewardsEnabled \? Math\.floor\(Math\.max\(0, subtotal\)\) : 0/);
  assert.match(cartClient, /on merchandise only\. \{rewardProgramCopy\}/);
  assert.match([storefrontClient, accountPages, policiesPage, rewardsPage, emails].join("\n"), /Earn points now\. Redemption coming soon\./);
  assert.match(policiesPage, /Points have no cash value/);
  assert.doesNotMatch([storefrontClient, accountPages, policiesPage, rewardsPage, emails].join("\n"), /redeem points|apply points|cash equivalent|launch date|use points at checkout/i);
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
