import assert from "node:assert/strict";
import test from "node:test";
import { getEnvironmentReport } from "../src/lib/env";
import { appHealthStatusFromChecks } from "../src/lib/health";

const controlledEnvKeys = [
  "NODE_ENV",
  "VERCEL",
  "DATABASE_URL",
  "APP_URL",
  "AUTH_SECRET",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_INVITE_SECRET",
  "MONITOR_JOB_SECRET",
  "CRON_SECRET",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "SMTP_HOST",
  "SMTP_FROM",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "UPC_LOOKUP_API_URL",
  "PRODUCT_SEARCH_PROVIDER",
  "PRODUCT_SEARCH_API_URL",
  "PRODUCT_SEARCH_API_KEY",
  "STRIPE_CHECKOUT_ENABLED",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STORE_BASE_URL",
  "CALCULATED_USPS_SHIPPING_ENABLED",
  "SHIPPING_FALLBACK_ENABLED",
  "SHIPPING_RATE_PROVIDER",
  "SHIPPING_QUOTE_TTL_MINUTES",
  "SHIPPO_LABEL_PURCHASE_ENABLED",
  "SHIPPING_LABELS_ENABLED",
  "CUSTOMER_ACCOUNTS_ENABLED",
  "CUSTOMER_REWARDS_ENABLED",
  "CUSTOMER_REWARD_REDEMPTION_ENABLED",
  "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED",
  "SHIPPO_API_TOKEN",
  "SHIP_FROM_NAME",
  "SHIP_FROM_STREET1",
  "SHIP_FROM_STREET2",
  "SHIP_FROM_CITY",
  "SHIP_FROM_STATE",
  "SHIP_FROM_ZIP",
  "SHIP_FROM_COUNTRY",
  "BLOB_READ_WRITE_TOKEN",
  "TCGCSV_ENABLED",
  "PRICECHARTING_API_TOKEN",
  "TCGPLAYER_ACCESS_TOKEN",
  "TCGPLAYER_PUBLIC_KEY",
  "TCGPLAYER_PRIVATE_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_MARKETPLACE_ID"
];

const requiredProductionEnv: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL: "1",
  DATABASE_URL: "postgresql://example.invalid/gamedaygrabs",
  APP_URL: "https://www.gamedaygrabs.com",
  AUTH_SECRET: "test-auth-secret-with-enough-length-for-health-checks",
  ADMIN_EMAIL: "owner@example.com",
  ADMIN_PASSWORD_HASH: "test-password-hash",
  ADMIN_INVITE_SECRET: "test-admin-invite-secret",
  MONITOR_JOB_SECRET: "same-cron-secret",
  CRON_SECRET: "same-cron-secret",
  STRIPE_CHECKOUT_ENABLED: "false",
  TCGCSV_ENABLED: "false"
};

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(controlledEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of controlledEnvKeys) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...requiredProductionEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const key of controlledEnvKeys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function statusForReport(warnings: string[]) {
  return appHealthStatusFromChecks({
    databaseOk: true,
    coreMissing: [],
    authReady: true,
    adminUserCount: 1,
    configuredAdminEmailExists: true,
    warnings
  });
}

test("health stays OK when required systems pass and optional providers are disabled", () => {
  withEnv({}, () => {
    const report = getEnvironmentReport();

    assert.deepEqual(report.coreMissing, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.providers.push.healthStatus, "optional_not_configured");
    assert.equal(report.providers.email.healthStatus, "optional_not_configured");
    assert.equal(report.providers.sms.healthStatus, "optional_not_configured");
    assert.equal(report.providers.upc.searchFallbackHealthStatus, "optional_not_configured");
    assert.equal(report.providers.blob.healthStatus, "optional_not_configured");
    assert.equal(report.providers.stripe.healthStatus, "disabled");
    assert.equal(report.providers.shippingLabels.healthStatus, "disabled");
    assert.equal(report.providers.shippingLabels.shippoLabelPurchaseEnabled, false);
    assert.equal(report.providers.shippingLabels.purchaseReady, false);
    assert.equal(report.providers.customerAccounts.healthStatus, "disabled");
    assert.equal(report.providers.customerAccounts.customerAccountsEnabled, false);
    assert.equal(report.providers.customerAccounts.customerRewardsEnabled, false);
    assert.equal(report.providers.customerAccounts.customerRewardRedemptionEnabled, false);
    assert.equal(report.providers.customerAccounts.customerRewardAdminAdjustmentsEnabled, false);
    assert.equal(report.providers.customerAccounts.accountProvider, "password_magic_link");
    assert.equal(report.providers.customerAccounts.rewardsProvider, "internal_ledger");
    assert.match(report.providers.customerAccounts.message, /guest checkout remains available/);
    assert.equal(statusForReport(report.warnings), "OK");
  });
});

test("health warns when an optional provider is partially configured", () => {
  withEnv({ RESEND_API_KEY: "re_test_secret" }, () => {
    const report = getEnvironmentReport();

    assert.equal(report.providers.email.healthStatus, "misconfigured");
    assert.equal(report.providers.email.provider, "none");
    assert.equal(report.providers.email.resendApiKeyConfigured, true);
    assert.equal(report.providers.email.emailFromConfigured, false);
    assert.match(report.warnings.join("\n"), /Email provider is partially configured/);
    assert.equal(statusForReport(report.warnings), "WARN");
  });
});

test("health reports Resend as the preferred configured email provider without exposing values", () => {
  withEnv(
    {
      RESEND_API_KEY: "re_private_health_value",
      EMAIL_FROM: "GameDayGrabs Orders <orders@example.com>",
      EMAIL_REPLY_TO: "support@example.com",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "smtp@example.com"
    },
    () => {
      const report = getEnvironmentReport();
      const serialized = JSON.stringify(report);

      assert.equal(report.providers.email.healthStatus, "configured");
      assert.equal(report.providers.email.provider, "resend");
      assert.equal(report.providers.email.resendConfigured, true);
      assert.equal(report.providers.email.smtpConfigured, true);
      assert.equal(report.providers.email.emailReplyToConfigured, true);
      assert.equal(report.providers.email.deliverability.domainAuthenticationStatus, "manual_check_required");
      assert.equal(report.providers.email.deliverability.dmarcStatus, "unknown_manual");
      assert.deepEqual(report.providers.email.deliverability.customHeaders, ["X-Entity-Ref-ID", "X-GDD-Notification-Type", "X-GDD-Order-Number"]);
      assert.deepEqual(report.providers.email.deliverability.tags, ["orderNumber", "notificationType", "environment"]);
      assert.match(report.providers.email.deliverability.message, /DMARC/);
      assert.match(report.providers.email.envVars.join(","), /RESEND_API_KEY/);
      assert.doesNotMatch(serialized, /re_private_health_value/);
      assert.doesNotMatch(serialized, /orders@example\.com/);
      assert.doesNotMatch(serialized, /support@example\.com/);
      assert.doesNotMatch(serialized, /orders@gamedaygrabs\.com|gamedaygrabs@outlook\.com/);
    }
  );
});

test("health warns only when Shippo label purchase is enabled without provider setup", () => {
  withEnv({ SHIPPO_LABEL_PURCHASE_ENABLED: "true" }, () => {
    const report = getEnvironmentReport();

    assert.equal(report.providers.shippingLabels.healthStatus, "misconfigured");
    assert.equal(report.providers.shippingLabels.shippoLabelPurchaseEnabled, true);
    assert.equal(report.providers.shippingLabels.labelProviderConfigured, false);
    assert.equal(report.providers.shippingLabels.purchaseReady, false);
    assert.match(report.warnings.join("\n"), /Shippo label purchase is enabled/);
    assert.equal(statusForReport(report.warnings), "WARN");
  });
});

test("health reports configured Shippo labels without exposing Shippo secrets", () => {
  withEnv(
    {
      SHIPPO_LABEL_PURCHASE_ENABLED: "true",
      SHIPPO_API_TOKEN: "shippo_private_health_value",
      SHIP_FROM_NAME: "GameDayGrabs",
      SHIP_FROM_STREET1: "123 Test St",
      SHIP_FROM_CITY: "Miami",
      SHIP_FROM_STATE: "FL",
      SHIP_FROM_ZIP: "33101",
      SHIP_FROM_COUNTRY: "US"
    },
    () => {
      const report = getEnvironmentReport();
      const serialized = JSON.stringify(report);

      assert.equal(report.providers.shippingLabels.healthStatus, "configured");
      assert.equal(report.providers.shippingLabels.provider, "shippo");
      assert.equal(report.providers.shippingLabels.labelProviderConfigured, true);
      assert.equal(report.providers.shippingLabels.purchaseReady, true);
      assert.match(report.providers.shippingLabels.envVars.join(","), /SHIPPO_LABEL_PURCHASE_ENABLED/);
      assert.doesNotMatch(serialized, /shippo_private_health_value/);
      assert.doesNotMatch(serialized, /123 Test St/);
    }
  );
});

test("health reports customer account reward flags without exposing values or affecting checkout", () => {
  withEnv(
    {
      CUSTOMER_ACCOUNTS_ENABLED: "true",
      CUSTOMER_REWARDS_ENABLED: "true",
      CUSTOMER_REWARD_REDEMPTION_ENABLED: "false"
    },
    () => {
      const report = getEnvironmentReport();
      const serialized = JSON.stringify(report);

      assert.equal(report.providers.customerAccounts.healthStatus, "configured");
      assert.equal(report.providers.customerAccounts.customerAccountsEnabled, true);
      assert.equal(report.providers.customerAccounts.customerRewardsEnabled, true);
      assert.equal(report.providers.customerAccounts.customerRewardRedemptionEnabled, false);
      assert.equal(report.providers.customerAccounts.customerRewardAdminAdjustmentsEnabled, false);
      assert.equal(report.providers.customerAccounts.rewardsReady, true);
      assert.equal(report.providers.customerAccounts.redemptionReady, false);
      assert.equal(report.providers.customerAccounts.adminAdjustmentsReady, false);
      assert.deepEqual(report.providers.customerAccounts.envVars, [
        "CUSTOMER_ACCOUNTS_ENABLED",
        "CUSTOMER_REWARDS_ENABLED",
        "CUSTOMER_REWARD_REDEMPTION_ENABLED",
        "CUSTOMER_REWARD_ADMIN_ADJUSTMENTS_ENABLED"
      ]);
      assert.doesNotMatch(serialized, /card_number|cardNumber|cvc|cvv|payment_method_details|raw Stripe/i);
      assert.equal(statusForReport(report.warnings), "OK");
    }
  );
});

test("health warns when reward redemption is enabled without the required account flags", () => {
  withEnv({ CUSTOMER_REWARD_REDEMPTION_ENABLED: "true" }, () => {
    const report = getEnvironmentReport();

    assert.equal(report.providers.customerAccounts.healthStatus, "misconfigured");
    assert.equal(report.providers.customerAccounts.customerAccountsEnabled, false);
    assert.equal(report.providers.customerAccounts.customerRewardsEnabled, false);
    assert.equal(report.providers.customerAccounts.customerRewardRedemptionEnabled, true);
    assert.match(report.warnings.join("\n"), /Customer account rewards flags are inconsistent/);
    assert.equal(statusForReport(report.warnings), "WARN");
  });
});

test("health is ERROR when a required database check fails", () => {
  assert.equal(
    appHealthStatusFromChecks({
      databaseOk: false,
      coreMissing: [],
      authReady: true,
      adminUserCount: 1,
      configuredAdminEmailExists: true,
      warnings: []
    }),
    "ERROR"
  );
});

test("health provider report does not serialize secret values", () => {
  withEnv(
    {
      STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_public_health_value",
      STRIPE_SECRET_KEY: "sk_test_private_health_value",
      STRIPE_WEBHOOK_SECRET: "whsec_private_health_value"
    },
    () => {
      const report = getEnvironmentReport();
      const serialized = JSON.stringify(report);

      assert.equal(report.providers.stripe.healthStatus, "configured");
      assert.equal(report.providers.stripe.publishableKeyMode, "test");
      assert.equal(report.providers.stripe.secretKeyMode, "test");
      assert.equal(report.providers.stripe.testMode, true);
      assert.doesNotMatch(serialized, /pk_test_public_health_value/);
      assert.doesNotMatch(serialized, /sk_test_private_health_value/);
      assert.doesNotMatch(serialized, /whsec_private_health_value/);
      assert.doesNotMatch(serialized, /re_private/);
      assert.doesNotMatch(serialized, /postgresql:\/\/example\.invalid/);
    }
  );
});
