export type CustomerAccountFeatureConfig = {
  customerAccountsEnabled: boolean;
  customerRewardsEnabled: boolean;
  customerRewardRedemptionEnabled: boolean;
  customerRewardAdminAdjustmentsEnabled: boolean;
  accountProvider: "magic_link";
  rewardsProvider: "internal_ledger";
  envVars: string[];
};

const customerAccountEnvVars = [
  "CUSTOMER_ACCOUNTS_ENABLED",
  "CUSTOMER_REWARDS_ENABLED",
  "CUSTOMER_REWARD_REDEMPTION_ENABLED",
  "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED"
];

function envFlag(env: Record<string, string | undefined>, name: string) {
  return env[name]?.trim().toLowerCase() === "true";
}

export function customerAccountFeatureConfig(env: Record<string, string | undefined> = process.env): CustomerAccountFeatureConfig {
  return {
    customerAccountsEnabled: envFlag(env, "CUSTOMER_ACCOUNTS_ENABLED"),
    customerRewardsEnabled: envFlag(env, "CUSTOMER_REWARDS_ENABLED"),
    customerRewardRedemptionEnabled: envFlag(env, "CUSTOMER_REWARD_REDEMPTION_ENABLED"),
    customerRewardAdminAdjustmentsEnabled: envFlag(env, "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED"),
    accountProvider: "magic_link",
    rewardsProvider: "internal_ledger",
    envVars: customerAccountEnvVars
  };
}
