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
