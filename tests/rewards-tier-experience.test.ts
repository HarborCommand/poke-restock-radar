import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { REWARD_TIERS, rewardTierIndex, rewardTierProgress, rewardTierState } from "../src/lib/reward-tiers";

function read(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("canonical reward tiers and boundary calculations remain unchanged", () => {
  assert.deepEqual(
    REWARD_TIERS.map(({ name, threshold }) => [name, threshold]),
    [
      ["Rookie Collector", 0],
      ["Card Hunter", 500],
      ["Pack Pro", 1_500],
      ["Master Collector", 3_000],
      ["Legend Collector", 5_000]
    ]
  );

  assert.deepEqual(REWARD_TIERS.map((tier) => tier.key), [
    "rookie_collector",
    "card_hunter",
    "pack_pro",
    "master_collector",
    "legend_collector"
  ]);

  for (const [points, tier] of [[0, 0], [499, 0], [500, 1], [1_499, 1], [1_500, 2], [2_999, 2], [3_000, 3], [4_999, 3], [5_000, 4], [Number.MAX_SAFE_INTEGER, 4]] as const) {
    assert.equal(rewardTierIndex(points), tier, `${points} points`);
  }
});

test("every tier has a distinct production badge and visual state", () => {
  assert.equal(new Set(REWARD_TIERS.map((tier) => tier.asset)).size, REWARD_TIERS.length);
  for (const tier of REWARD_TIERS) {
    assert.match(tier.asset, /^\/rewards\/tiers\/[a-z-]+\.webp$/);
    assert.equal(fs.existsSync(new URL(`../public${tier.asset}`, import.meta.url)), true, tier.asset);
  }
  assert.deepEqual(REWARD_TIERS.map((_, index) => rewardTierState(index, 2)), ["completed", "completed", "current", "next", "locked"]);
});

test("tier progress is interval-based, bounded, and never mutates balances", () => {
  assert.deepEqual(rewardTierProgress(500), {
    points: 500,
    currentIndex: 1,
    currentTier: REWARD_TIERS[1],
    nextTier: REWARD_TIERS[2],
    pointsToNext: 1_000,
    progressPercent: 0
  });
  assert.equal(Math.round(rewardTierProgress(1_000).progressPercent), 50);
  assert.equal(rewardTierProgress(5_000).progressPercent, 100);
  assert.equal(rewardTierProgress(Number.MAX_SAFE_INTEGER).nextTier, null);
  assert.equal(rewardTierProgress(Number.MAX_SAFE_INTEGER).pointsToNext, 0);
  assert.equal(rewardTierProgress(-100).points, 0);
});

test("level-up acknowledgment is same-origin, authenticated, customer-scoped, and points-free", () => {
  const route = read("src/app/api/account/rewards/tier-acknowledgment/route.ts");
  const page = read("src/app/account/rewards/page.tsx");
  assert.match(route, /assertCustomerSameOriginRequest\(request\)/);
  assert.match(route, /currentCustomerAccount\(\)/);
  assert.match(route, /id: account\.id/);
  assert.match(route, /highestAcknowledgedRewardTier: \{ lt: currentTier \}/);
  assert.doesNotMatch(route, /availablePoints\s*:|pendingPoints\s*:|lifetimeEarnedPoints\s*:/);
  assert.doesNotMatch(route, /customerAccountId/);
  assert.doesNotMatch(page, /update|upsert|create|delete|POST\(/);
});

test("level-up modal includes focus, Escape, live-region, and reduced-motion safeguards", () => {
  const component = read("src/components/RewardsLevelUp.tsx");
  const css = read("src/app/globals.css");
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key !== "Tab"/);
  assert.match(component, /aria-live="assertive"/);
  assert.match(component, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /max-height: min\(92dvh, 760px\)/);
});

test("redemption remains visibly and structurally disabled", () => {
  const account = read("src/components/CustomerAccountPages.tsx");
  const modal = read("src/components/RewardsLevelUp.tsx");
  assert.match(account, /Redemption coming soon/);
  assert.match(account, /Points are display-only/);
  assert.match(modal, /Redemptions remain unavailable/);
  assert.doesNotMatch(modal, /redeem|checkout/i);
});
