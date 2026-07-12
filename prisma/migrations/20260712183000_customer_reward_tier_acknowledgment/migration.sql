ALTER TABLE "CustomerAccount" ADD COLUMN "highestAcknowledgedRewardTier" INTEGER NOT NULL DEFAULT 0;

UPDATE "CustomerAccount"
SET "highestAcknowledgedRewardTier" = COALESCE((
  SELECT CASE
    WHEN "RewardBalance"."lifetimeEarnedPoints" >= 5000 THEN 4
    WHEN "RewardBalance"."lifetimeEarnedPoints" >= 3000 THEN 3
    WHEN "RewardBalance"."lifetimeEarnedPoints" >= 1500 THEN 2
    WHEN "RewardBalance"."lifetimeEarnedPoints" >= 500 THEN 1
    ELSE 0
  END
  FROM "RewardBalance"
  WHERE "RewardBalance"."customerAccountId" = "CustomerAccount"."id"
), 0);
