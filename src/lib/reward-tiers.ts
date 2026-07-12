export const REWARD_TIERS = [
  {
    key: "rookie_collector",
    name: "Rookie Collector",
    threshold: 0,
    asset: "/rewards/tiers/rookie-collector.webp",
    message: "The collecting journey begins."
  },
  {
    key: "card_hunter",
    name: "Card Hunter",
    threshold: 500,
    asset: "/rewards/tiers/card-hunter.webp",
    message: "Hunting for the next great pull."
  },
  {
    key: "pack_pro",
    name: "Pack Pro",
    threshold: 1_500,
    asset: "/rewards/tiers/pack-pro.webp",
    message: "Opening. Upgrading. Winning."
  },
  {
    key: "master_collector",
    name: "Master Collector",
    threshold: 3_000,
    asset: "/rewards/tiers/master-collector.webp",
    message: "Elite collector status unlocked."
  },
  {
    key: "legend_collector",
    name: "Legend Collector",
    threshold: 5_000,
    asset: "/rewards/tiers/legend-collector.webp",
    message: "Legends never stop collecting."
  }
] as const;

export type RewardTier = (typeof REWARD_TIERS)[number];
export type RewardTierState = "completed" | "current" | "next" | "locked";

export function rewardTierIndex(lifetimeEarnedPoints: number) {
  const points = Math.max(0, Math.floor(lifetimeEarnedPoints));
  return REWARD_TIERS.reduce(
    (selected, tier, index) => (points >= tier.threshold ? index : selected),
    0
  );
}

export function rewardTierState(index: number, currentIndex: number): RewardTierState {
  if (index < currentIndex) return "completed";
  if (index === currentIndex) return "current";
  if (index === currentIndex + 1) return "next";
  return "locked";
}

export function rewardTierProgress(lifetimeEarnedPoints: number) {
  const points = Math.max(0, Math.floor(lifetimeEarnedPoints));
  const currentIndex = rewardTierIndex(points);
  const currentTier = REWARD_TIERS[currentIndex] ?? REWARD_TIERS[0];
  const nextTier = REWARD_TIERS[currentIndex + 1] ?? null;
  const interval = nextTier ? nextTier.threshold - currentTier.threshold : 0;
  const intervalPoints = nextTier ? points - currentTier.threshold : 0;
  const progressPercent = nextTier
    ? Math.max(0, Math.min(100, (intervalPoints / interval) * 100))
    : 100;

  return {
    points,
    currentIndex,
    currentTier,
    nextTier,
    pointsToNext: nextTier ? Math.max(0, nextTier.threshold - points) : 0,
    progressPercent
  };
}
