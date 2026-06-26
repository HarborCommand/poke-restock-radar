export type CustomerAccountFeatureConfig = {
  customerAccountsEnabled: boolean;
  customerRewardsEnabled: boolean;
  customerRewardRedemptionEnabled: boolean;
  customerRewardAdminAdjustmentsEnabled: boolean;
  customerAuthRateLimitEnabled: boolean;
  customerSecurityCenterEnabled: boolean;
  customerLoginAlertsEnabled: boolean;
  customerSessionTimeoutsEnabled: boolean;
  customerSessionIdleTimeoutMinutes: number;
  customerSessionAbsoluteTimeoutHours: number;
  customerSessionWarningSeconds: number;
  customerSessionActivityTouchIntervalSeconds: number;
  accountProvider: "password_magic_link";
  rewardsProvider: "internal_ledger";
  envVars: string[];
};

const customerAccountEnvVars = [
  "CUSTOMER_ACCOUNTS_ENABLED",
  "CUSTOMER_REWARDS_ENABLED",
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
];

function envFlag(env: Record<string, string | undefined>, name: string) {
  return env[name]?.trim().toLowerCase() === "true";
}

function envNumber(env: Record<string, string | undefined>, name: string, fallback: number, min: number) {
  const raw = env[name]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export function customerAccountFeatureConfig(env: Record<string, string | undefined> = process.env): CustomerAccountFeatureConfig {
  return {
    customerAccountsEnabled: envFlag(env, "CUSTOMER_ACCOUNTS_ENABLED"),
    customerRewardsEnabled: envFlag(env, "CUSTOMER_REWARDS_ENABLED"),
    customerRewardRedemptionEnabled: envFlag(env, "CUSTOMER_REWARD_REDEMPTION_ENABLED"),
    customerRewardAdminAdjustmentsEnabled: envFlag(env, "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED"),
    customerAuthRateLimitEnabled: envFlag(env, "CUSTOMER_AUTH_RATE_LIMIT_ENABLED"),
    customerSecurityCenterEnabled: envFlag(env, "CUSTOMER_SECURITY_CENTER_ENABLED"),
    customerLoginAlertsEnabled: envFlag(env, "CUSTOMER_LOGIN_ALERTS_ENABLED"),
    customerSessionTimeoutsEnabled: envFlag(env, "CUSTOMER_SESSION_TIMEOUTS_ENABLED"),
    customerSessionIdleTimeoutMinutes: envNumber(env, "CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES", 10, 1),
    customerSessionAbsoluteTimeoutHours: envNumber(env, "CUSTOMER_SESSION_ABSOLUTE_TIMEOUT_HOURS", 12, 1),
    customerSessionWarningSeconds: envNumber(env, "CUSTOMER_SESSION_WARNING_SECONDS", 60, 10),
    customerSessionActivityTouchIntervalSeconds: envNumber(
      env,
      "CUSTOMER_SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS",
      60,
      10
    ),
    accountProvider: "password_magic_link",
    rewardsProvider: "internal_ledger",
    envVars: customerAccountEnvVars
  };
}
