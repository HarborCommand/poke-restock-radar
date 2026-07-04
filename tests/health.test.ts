import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getEnvironmentReport } from "../src/lib/env";
import { appHealthStatusFromChecks, publicHealthFromAppHealth } from "../src/lib/health";
import type { AppHealthDTO } from "../src/types/radar";

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
  "PRODUCT_SEARCH_FALLBACK_ENABLED",
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
  "CUSTOMER_AUTH_RATE_LIMIT_ENABLED",
  "CUSTOMER_SECURITY_CENTER_ENABLED",
  "CUSTOMER_LOGIN_ALERTS_ENABLED",
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

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("health stays OK when required systems pass and optional providers are disabled", () => {
  withEnv({}, () => {
    const report = getEnvironmentReport();

    assert.deepEqual(report.coreMissing, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.providers.push.healthStatus, "optional_not_configured");
    assert.equal(report.providers.email.healthStatus, "optional_not_configured");
    assert.equal(report.providers.sms.healthStatus, "optional_not_configured");
    assert.equal(report.providers.upc.searchFallbackEnabled, false);
    assert.equal(report.providers.upc.searchFallbackHealthStatus, "disabled");
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
    assert.equal(report.providers.customerAccounts.customerAuthRateLimitEnabled, false);
    assert.equal(report.providers.customerAccounts.accountProvider, "password_magic_link");
    assert.equal(report.providers.customerAccounts.rewardsProvider, "internal_ledger");
    assert.match(report.providers.customerAccounts.message, /guest checkout remains available/);
    assert.equal(statusForReport(report.warnings), "OK");
  });
});

test("product search fallback stays disabled without warning when only a provider placeholder is set", () => {
  withEnv({ PRODUCT_SEARCH_PROVIDER: "serpapi" }, () => {
    const report = getEnvironmentReport();

    assert.equal(report.providers.upc.searchProvider, "serpapi");
    assert.equal(report.providers.upc.searchFallbackEnabled, false);
    assert.equal(report.providers.upc.searchFallbackConfigured, false);
    assert.equal(report.providers.upc.searchFallbackHealthStatus, "disabled");
    assert.equal(report.warnings.some((warning) => warning.includes("Product search fallback")), false);
    assert.equal(statusForReport(report.warnings), "OK");
  });
});

test("product search fallback warns only when explicitly enabled with incomplete configuration", () => {
  withEnv({ PRODUCT_SEARCH_FALLBACK_ENABLED: "true", PRODUCT_SEARCH_PROVIDER: "serpapi" }, () => {
    const report = getEnvironmentReport();

    assert.equal(report.providers.upc.searchFallbackEnabled, true);
    assert.equal(report.providers.upc.searchFallbackConfigured, false);
    assert.equal(report.providers.upc.searchFallbackHealthStatus, "misconfigured");
    assert.match(report.warnings.join("\n"), /Product search fallback is enabled but incomplete/);
    assert.equal(statusForReport(report.warnings), "WARN");
  });
});

test("product search fallback is healthy when explicitly enabled with complete supported config", () => {
  withEnv(
    {
      PRODUCT_SEARCH_FALLBACK_ENABLED: "true",
      PRODUCT_SEARCH_PROVIDER: "serpapi",
      PRODUCT_SEARCH_API_URL: "https://serpapi.com/search.json",
      PRODUCT_SEARCH_API_KEY: "test-key"
    },
    () => {
      const report = getEnvironmentReport();
      const serialized = JSON.stringify(report);

      assert.equal(report.providers.upc.searchFallbackEnabled, true);
      assert.equal(report.providers.upc.searchFallbackConfigured, true);
      assert.equal(report.providers.upc.searchFallbackHealthStatus, "configured");
      assert.equal(report.warnings.some((warning) => warning.includes("Product search fallback")), false);
      assert.doesNotMatch(serialized, /test-key/);
      assert.equal(statusForReport(report.warnings), "OK");
    }
  );
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

test("product search fallback warning remains available in detailed health data", () => {
  withEnv({ PRODUCT_SEARCH_FALLBACK_ENABLED: "true", PRODUCT_SEARCH_PROVIDER: "serpapi" }, () => {
    const report = getEnvironmentReport();
    const serialized = JSON.stringify(report);

    assert.equal(report.providers.upc.searchFallbackEnabled, true);
    assert.equal(report.providers.upc.searchFallbackConfigured, false);
    assert.equal(report.providers.upc.searchFallbackHealthStatus, "misconfigured");
    assert.deepEqual(report.providers.upc.searchFallbackEnvVars, [
      "PRODUCT_SEARCH_FALLBACK_ENABLED",
      "PRODUCT_SEARCH_PROVIDER",
      "PRODUCT_SEARCH_API_URL",
      "PRODUCT_SEARCH_API_KEY"
    ]);
    assert.match(report.providers.upc.searchFallbackMessage, /enabled but has partial or unsupported configuration/);
    assert.match(report.warnings.join("\n"), /Product search fallback is enabled but incomplete/);

    const publicHealth = publicHealthFromAppHealth({
      status: statusForReport(report.warnings),
      checkedAt: "2026-07-04T12:00:00.000Z",
      environment: {
        nodeEnv: report.nodeEnv,
        appUrl: report.appUrl,
        isVercel: report.isVercel,
        coreMissing: report.coreMissing,
        featureMissing: report.featureMissing,
        warnings: report.warnings
      },
      database: {
        ok: true,
        provider: report.databaseProvider,
        urlConfigured: true,
        productionSafe: true
      },
      auth: {
        authSecretConfigured: true,
        authSecretStrong: true,
        authReady: true,
        sessionCookieName: "__Host-poke_radar_session",
        secureCookie: true,
        sameSite: "lax",
        sessionDays: 14,
        currentSessionValid: false,
        currentSessionEmail: null,
        currentSessionRole: null,
        adminUserCount: 1,
        configuredAdminEmailPresent: true,
        configuredAdminEmailExists: true,
        lastAdminLoginAt: null,
        passwordResetEmailConfigured: false
      },
      monitor: {
        lastRunAt: null,
        lastStatus: null,
        lastSummary: null,
        lastError: null,
        dueProductCount: 0,
        requestDelayMs: report.providers.cron.requestDelayMs,
        monitorJobSecretConfigured: true,
        vercelCronSecretConfigured: true
      },
      alerts: {
        lastAlertAt: null,
        lastAlertTitle: null,
        lastAlertPriority: null,
        unreadCount: 0
      },
      build: {
        commitSha: "abcdef1234567890",
        commitShort: "abcdef123456",
        deployId: "dpl_internal",
        buildTimestamp: "2026-07-04T11:59:00.000Z",
        serviceWorkerVersion: "poke-radar-sw-test"
      },
      providers: report.providers
    });
    const publicSerialized = JSON.stringify(publicHealth);

    assert.match(serialized, /PRODUCT_SEARCH_PROVIDER/);
    assert.equal(publicHealth.warningCount, 1);
    assert.deepEqual(publicHealth.warningCategories, ["configuration"]);
    assert.doesNotMatch(publicSerialized, /PRODUCT_SEARCH_FALLBACK_ENABLED|PRODUCT_SEARCH_PROVIDER|PRODUCT_SEARCH_API_URL|PRODUCT_SEARCH_API_KEY|serpapi/);
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
      assert.equal(report.providers.customerAccounts.customerAuthRateLimitEnabled, false);
      assert.equal(report.providers.customerAccounts.customerSecurityCenterEnabled, false);
      assert.equal(report.providers.customerAccounts.customerLoginAlertsEnabled, false);
      assert.equal(report.providers.customerAccounts.customerSessionTimeoutsEnabled, false);
      assert.equal(report.providers.customerAccounts.customerSessionIdleTimeoutMinutes, 10);
      assert.equal(report.providers.customerAccounts.customerSessionAbsoluteTimeoutHours, 12);
      assert.equal(report.providers.customerAccounts.rewardsReady, true);
      assert.equal(report.providers.customerAccounts.redemptionReady, false);
      assert.equal(report.providers.customerAccounts.adminAdjustmentsReady, false);
      assert.deepEqual(report.providers.customerAccounts.envVars, [
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
    assert.match(report.warnings.join("\n"), /Customer account flags are inconsistent/);
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

test("public health projection exposes only minimal safe fields", () => {
  const detailed = {
    status: "ERROR",
    checkedAt: "2026-07-04T12:00:00.000Z",
    environment: {
      nodeEnv: "production",
      appUrl: "https://www.gamedaygrabs.com",
      isVercel: true,
      coreMissing: ["DATABASE_URL", "AUTH_SECRET"],
      featureMissing: ["PRODUCT_SEARCH_API_KEY"],
      warnings: ["Production should use a managed Postgres DATABASE_URL."]
    },
    database: {
      ok: false,
      provider: "unknown",
      urlConfigured: false,
      productionSafe: false,
      error: "Environment variable not found: DATABASE_URL."
    },
    auth: {
      authSecretConfigured: false,
      authSecretStrong: false,
      authReady: false,
      sessionCookieName: "__Host-poke_radar_session",
      secureCookie: true,
      sameSite: "lax",
      sessionDays: 14,
      currentSessionValid: false,
      currentSessionEmail: "owner@example.com",
      currentSessionRole: null,
      adminUserCount: 0,
      configuredAdminEmailPresent: true,
      configuredAdminEmailExists: false,
      lastAdminLoginAt: null,
      passwordResetEmailConfigured: true
    },
    monitor: {
      lastRunAt: null,
      lastStatus: null,
      lastSummary: null,
      lastError: "Monitor job failed with provider details.",
      dueProductCount: 0,
      requestDelayMs: 1500,
      monitorJobSecretConfigured: false,
      vercelCronSecretConfigured: false
    },
    alerts: {
      lastAlertAt: null,
      lastAlertTitle: "Private alert title",
      lastAlertPriority: "HIGH",
      unreadCount: 10
    },
    build: {
      commitSha: "abc123456789",
      commitShort: "abc123",
      deployId: "dpl_safe_public_id",
      buildTimestamp: "2026-07-04T11:59:00.000Z",
      serviceWorkerVersion: "poke-radar-sw-test"
    },
    providers: {
      email: { healthStatus: "misconfigured", envVars: ["RESEND_API_KEY"], message: "Email config missing." },
      stripe: { healthStatus: "configured", envVars: ["STRIPE_SECRET_KEY"], message: "Stripe configured." }
    }
  } as unknown as AppHealthDTO;

  const publicHealth = publicHealthFromAppHealth(detailed);
  const serialized = JSON.stringify(publicHealth);

  assert.deepEqual(Object.keys(publicHealth).sort(), ["buildCommit", "databaseOk", "status", "timestamp", "warningCategories", "warningCount"].sort());
  assert.equal(publicHealth.status, "ERROR");
  assert.equal(publicHealth.timestamp, "2026-07-04T12:00:00.000Z");
  assert.equal(publicHealth.databaseOk, false);
  assert.equal(publicHealth.warningCount, 10);
  assert.deepEqual(publicHealth.warningCategories, ["database", "configuration", "auth", "providers", "monitor"]);
  assert.equal(publicHealth.buildCommit, "abc123");

  for (const forbidden of [
    "environment",
    "alerts",
    "DATABASE_URL",
    "AUTH_SECRET",
    "PRODUCT_SEARCH_API_KEY",
    "__Host-poke_radar_session",
    "owner@example.com",
    "Private alert title",
    "Monitor job failed",
    "STRIPE_SECRET_KEY",
    "RESEND_API_KEY",
    "dpl_safe_public_id",
    "abc123456789"
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("public and admin health routes split minimal and detailed diagnostics", () => {
  const publicRoute = readProjectFile("src/app/api/health/route.ts");
  const adminRoute = readProjectFile("src/app/api/admin/health/route.ts");
  const finalSmoke = readProjectFile("scripts/final-production-smoke.ts");

  assert.match(publicRoute, /publicHealthFromAppHealth/);
  assert.match(publicRoute, /getAppHealth\(\)/);
  assert.match(publicRoute, /ok\(publicHealthFromAppHealth\(health\), health\.status === "ERROR" \? 503 : 200\)/);
  assert.doesNotMatch(publicRoute, /ok\(health,/);
  assert.doesNotMatch(publicRoute, /requireUser|requireAdmin/);

  assert.match(adminRoute, /requireUser\(\)/);
  assert.match(adminRoute, /requireAdmin\(user\)/);
  assert.match(adminRoute, /getAppHealth\(user\)/);
  assert.match(adminRoute, /privateOk\(health, health\.status === "ERROR" \? 503 : 200\)/);

  assert.match(finalSmoke, /health\.databaseOk !== true/);
  assert.match(finalSmoke, /dashboardBody\.health\?\.database\?\.provider !== "postgres"/);
  assert.doesNotMatch(finalSmoke, /health\.environment|health\.database\?\.provider/);
});
