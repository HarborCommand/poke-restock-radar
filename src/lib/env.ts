export type EnvironmentReport = {
  nodeEnv: string;
  appUrl: string | null;
  databaseProvider: "postgres" | "sqlite" | "unknown";
  isVercel: boolean;
  coreMissing: string[];
  featureMissing: string[];
  warnings: string[];
  providers: {
    cron: {
      monitorJobSecretConfigured: boolean;
      vercelCronSecretConfigured: boolean;
      requestDelayMs: number;
    };
    push: {
      configured: boolean;
      publicKeyConfigured: boolean;
      privateKeyConfigured: boolean;
      subjectConfigured: boolean;
    };
    email: {
      configured: boolean;
      smtpHostConfigured: boolean;
      smtpFromConfigured: boolean;
    };
    sms: {
      configured: boolean;
      accountSidConfigured: boolean;
      fromNumberConfigured: boolean;
    };
    upc: {
      configuredUpcProvider: boolean;
      publicUpcProvider: boolean;
      searchFallbackConfigured: boolean;
      searchProvider: string | null;
    };
    stripe: {
      configured: boolean;
      checkoutEnabled: boolean;
      publishableKeyConfigured: boolean;
      secretKeyConfigured: boolean;
      webhookSecretConfigured: boolean;
      storeBaseUrlConfigured: boolean;
      checkoutSessionReady: boolean;
      webhookReady: boolean;
      missing: string[];
    };
    market: {
      priceChartingConfigured: boolean;
      tcgplayerConfigured: boolean;
      tcgcsvEnabled: boolean;
      ebaySoldConfigured: boolean;
      activeProvider: string | null;
    };
  };
};

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function hasEnv(name: string) {
  return envValue(name) !== null;
}

function databaseProvider(databaseUrl: string | null): EnvironmentReport["databaseProvider"] {
  if (!databaseUrl) return "unknown";
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) return "postgres";
  if (databaseUrl.startsWith("file:")) return "sqlite";
  return "unknown";
}

function monitorRequestDelayMs() {
  const configured = Number(process.env.MONITOR_REQUEST_DELAY_MS || 1500);
  if (!Number.isFinite(configured)) return 1500;
  return Math.max(500, configured);
}

export function getEnvironmentReport(): EnvironmentReport {
  const nodeEnv = process.env.NODE_ENV || "development";
  const appUrl = envValue("APP_URL");
  const databaseUrl = envValue("DATABASE_URL");
  const dbProvider = databaseProvider(databaseUrl);
  const isProduction = nodeEnv === "production";
  const isVercel = hasEnv("VERCEL");
  const smtpHostConfigured = hasEnv("SMTP_HOST");
  const smtpFromConfigured = hasEnv("SMTP_FROM");
  const accountSidConfigured = hasEnv("TWILIO_ACCOUNT_SID");
  const authTokenConfigured = hasEnv("TWILIO_AUTH_TOKEN");
  const fromNumberConfigured = hasEnv("TWILIO_FROM_NUMBER");
  const publicKeyConfigured = hasEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const privateKeyConfigured = hasEnv("VAPID_PRIVATE_KEY");
  const subjectConfigured = hasEnv("VAPID_SUBJECT");
  const monitorJobSecretConfigured = hasEnv("MONITOR_JOB_SECRET");
  const vercelCronSecretConfigured = hasEnv("CRON_SECRET");
  const configuredUpcProvider = hasEnv("UPC_LOOKUP_API_URL");
  const searchProvider = envValue("PRODUCT_SEARCH_PROVIDER");
  const searchFallbackConfigured = Boolean(searchProvider && hasEnv("PRODUCT_SEARCH_API_URL") && hasEnv("PRODUCT_SEARCH_API_KEY"));
  const stripeCheckoutEnabled = envValue("STRIPE_CHECKOUT_ENABLED") === "true";
  const stripePublishableConfigured = hasEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const stripeSecretConfigured = hasEnv("STRIPE_SECRET_KEY");
  const stripeWebhookConfigured = hasEnv("STRIPE_WEBHOOK_SECRET");
  const storeBaseUrlConfigured = hasEnv("STORE_BASE_URL");
  const stripeMissing = [
    !stripeCheckoutEnabled ? "STRIPE_CHECKOUT_ENABLED" : null,
    !stripePublishableConfigured ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" : null,
    !stripeSecretConfigured ? "STRIPE_SECRET_KEY" : null,
    !stripeWebhookConfigured ? "STRIPE_WEBHOOK_SECRET" : null
  ].filter((name): name is string => Boolean(name));
  const tcgcsvEnabled = envValue("TCGCSV_ENABLED") === "true";
  const priceChartingConfigured = hasEnv("PRICECHARTING_API_TOKEN");
  const tcgplayerConfigured = hasEnv("TCGPLAYER_ACCESS_TOKEN") || (hasEnv("TCGPLAYER_PUBLIC_KEY") && hasEnv("TCGPLAYER_PRIVATE_KEY"));
  const ebaySoldConfigured = hasEnv("EBAY_CLIENT_ID") && hasEnv("EBAY_CLIENT_SECRET") && hasEnv("EBAY_MARKETPLACE_ID");

  const coreRequired = ["DATABASE_URL", "APP_URL"];
  if (isProduction || isVercel) {
    coreRequired.push(
      "AUTH_SECRET",
      "ADMIN_EMAIL",
      "ADMIN_PASSWORD_HASH",
      "ADMIN_INVITE_SECRET",
      "MONITOR_JOB_SECRET",
      "CRON_SECRET"
    );
  }
  const coreMissing = coreRequired.filter((name) => !hasEnv(name));

  const featureRequired = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const featureMissing = featureRequired.filter((name) => !hasEnv(name));
  const warnings: string[] = [];

  if (isProduction && dbProvider !== "postgres") {
    warnings.push("Production should use a managed Postgres DATABASE_URL. SQLite/file URLs are dev-only.");
  }
  if (isProduction && hasEnv("ADMIN_PASSWORD") && !hasEnv("ADMIN_PASSWORD_HASH")) {
    warnings.push("Use ADMIN_PASSWORD_HASH in production instead of ADMIN_PASSWORD.");
  }
  if (isVercel && !vercelCronSecretConfigured) {
    warnings.push("Set CRON_SECRET on Vercel so scheduled cron invocations include a bearer token.");
  }
  if (isVercel && monitorJobSecretConfigured && vercelCronSecretConfigured) {
    const monitorSecret = envValue("MONITOR_JOB_SECRET");
    const cronSecret = envValue("CRON_SECRET");
    if (monitorSecret !== cronSecret) {
      warnings.push("For Vercel Cron, keep CRON_SECRET equal to MONITOR_JOB_SECRET.");
    }
  }
  if (featureMissing.length > 0) {
    warnings.push("Browser push is not fully configured until VAPID env vars are set.");
  }
  if (!smtpHostConfigured || !smtpFromConfigured) {
    warnings.push("SMTP email alerts are disabled until SMTP_HOST and SMTP_FROM are set.");
  }
  if (!accountSidConfigured || !authTokenConfigured || !fromNumberConfigured) {
    warnings.push("Twilio SMS alerts are disabled until Twilio credentials and from number are set.");
  }
  if (!searchFallbackConfigured) {
    warnings.push("Search fallback is not configured. Set PRODUCT_SEARCH_PROVIDER, PRODUCT_SEARCH_API_URL, and PRODUCT_SEARCH_API_KEY so UPC provider misses can fall through to product search.");
  }
  if (stripeMissing.length > 0) {
    warnings.push(`Storefront Stripe Checkout is disabled until ${stripeMissing.join(", ")} ${stripeMissing.length === 1 ? "is" : "are"} set.`);
  }
  if (!storeBaseUrlConfigured) {
    warnings.push("STORE_BASE_URL is not set; Stripe success/cancel URLs will use the current storefront request origin when checkout starts.");
  }
  if (!tcgcsvEnabled) {
    warnings.push("TCGCSV market estimates are disabled. Set TCGCSV_ENABLED=true to use automatic inventory pricing.");
  }
  const activeProvider = tcgcsvEnabled
    ? "TCGCSV"
    : priceChartingConfigured
      ? "PRICECHARTING"
      : tcgplayerConfigured
        ? "TCGPLAYER"
        : ebaySoldConfigured
          ? "EBAY_SOLD"
          : null;

  return {
    nodeEnv,
    appUrl,
    databaseProvider: dbProvider,
    isVercel,
    coreMissing,
    featureMissing,
    warnings,
    providers: {
      cron: {
        monitorJobSecretConfigured,
        vercelCronSecretConfigured,
        requestDelayMs: monitorRequestDelayMs()
      },
      push: {
        configured: publicKeyConfigured && privateKeyConfigured && subjectConfigured,
        publicKeyConfigured,
        privateKeyConfigured,
        subjectConfigured
      },
      email: {
        configured: smtpHostConfigured && smtpFromConfigured,
        smtpHostConfigured,
        smtpFromConfigured
      },
      sms: {
        configured: accountSidConfigured && authTokenConfigured && fromNumberConfigured,
        accountSidConfigured,
        fromNumberConfigured
      },
      upc: {
        configuredUpcProvider,
        publicUpcProvider: true,
        searchFallbackConfigured,
        searchProvider
      },
      stripe: {
        configured: stripeMissing.length === 0,
        checkoutEnabled: stripeCheckoutEnabled,
        publishableKeyConfigured: stripePublishableConfigured,
        secretKeyConfigured: stripeSecretConfigured,
        webhookSecretConfigured: stripeWebhookConfigured,
        storeBaseUrlConfigured,
        checkoutSessionReady: stripeCheckoutEnabled && stripePublishableConfigured && stripeSecretConfigured,
        webhookReady: stripeWebhookConfigured,
        missing: stripeMissing
      },
      market: {
        priceChartingConfigured,
        tcgplayerConfigured,
        tcgcsvEnabled,
        ebaySoldConfigured,
        activeProvider
      }
    }
  };
}
