import { emailProviderConfig, type EmailProviderKind } from "@/lib/email-provider";
import { shippingRateProviderConfig } from "@/lib/shipping-rate-provider";

export type ProviderHealthStatus = "configured" | "optional_not_configured" | "misconfigured" | "disabled";

type ProviderHealthMetadata = {
  healthStatus: ProviderHealthStatus;
  envVars: string[];
  message: string;
};

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
    push: ProviderHealthMetadata & {
      configured: boolean;
      publicKeyConfigured: boolean;
      privateKeyConfigured: boolean;
      subjectConfigured: boolean;
    };
    email: ProviderHealthMetadata & {
      configured: boolean;
      provider: EmailProviderKind;
      resendConfigured: boolean;
      resendApiKeyConfigured: boolean;
      emailFromConfigured: boolean;
      emailReplyToConfigured: boolean;
      smtpConfigured: boolean;
      smtpHostConfigured: boolean;
      smtpFromConfigured: boolean;
      deliverability: {
        domainAuthenticationStatus: "manual_check_required" | "not_applicable";
        dmarcStatus: "unknown_manual";
        customHeaders: string[];
        tags: string[];
        message: string;
      };
    };
    sms: ProviderHealthMetadata & {
      configured: boolean;
      accountSidConfigured: boolean;
      authTokenConfigured: boolean;
      fromNumberConfigured: boolean;
    };
    upc: {
      configuredUpcProvider: boolean;
      publicUpcProvider: boolean;
      searchFallbackConfigured: boolean;
      searchFallbackHealthStatus: ProviderHealthStatus;
      searchFallbackEnvVars: string[];
      searchFallbackMessage: string;
      searchProvider: string | null;
    };
    stripe: ProviderHealthMetadata & {
      configured: boolean;
      checkoutEnabled: boolean;
      publishableKeyConfigured: boolean;
      secretKeyConfigured: boolean;
      webhookSecretConfigured: boolean;
      storeBaseUrlConfigured: boolean;
      storeBaseUrlHealthStatus: ProviderHealthStatus;
      storeBaseUrl: string | null;
      publishableKeyMode: "test" | "live" | "missing" | "unknown";
      secretKeyMode: "test" | "live" | "missing" | "unknown";
      testMode: boolean;
      checkoutSessionReady: boolean;
      webhookReady: boolean;
      missing: string[];
    };
    shippingRates: ProviderHealthMetadata & {
      configured: boolean;
      calculatedUspsEnabled: boolean;
      provider: "shippo" | "none";
      shippoConfigured: boolean;
      shipFromZipConfigured: boolean;
      shipFromConfigured: boolean;
      fallbackEnabled: boolean;
      quoteTtlMinutes: number;
    };
    blob: ProviderHealthMetadata & {
      configured: boolean;
      readWriteTokenConfigured: boolean;
      maxUploadSizeMb: number;
    };
    market: ProviderHealthMetadata & {
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

function anyEnv(names: string[]) {
  return names.some((name) => hasEnv(name));
}

function optionalProviderHealth(configured: boolean, partiallyConfigured: boolean): ProviderHealthStatus {
  if (configured) return "configured";
  return partiallyConfigured ? "misconfigured" : "optional_not_configured";
}

function stripeKeyMode(value: string | null, keyType: "pk" | "sk") {
  if (!value) return "missing";
  if (value.startsWith(`${keyType}_test_`)) return "test";
  if (value.startsWith(`${keyType}_live_`)) return "live";
  return "unknown";
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
  const pushEnvVars = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const emailEnvVars = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "SMTP_HOST", "SMTP_FROM", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS"];
  const smsEnvVars = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
  const searchEnvVars = ["PRODUCT_SEARCH_PROVIDER", "PRODUCT_SEARCH_API_URL", "PRODUCT_SEARCH_API_KEY"];
  const stripeEnvVars = ["STRIPE_CHECKOUT_ENABLED", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STORE_BASE_URL"];
  const shippingRateProvider = shippingRateProviderConfig();
  const blobEnvVars = ["BLOB_READ_WRITE_TOKEN"];
  const marketEnvVars = [
    "TCGCSV_ENABLED",
    "PRICECHARTING_API_TOKEN",
    "TCGPLAYER_ACCESS_TOKEN",
    "TCGPLAYER_PUBLIC_KEY",
    "TCGPLAYER_PRIVATE_KEY",
    "EBAY_CLIENT_ID",
    "EBAY_CLIENT_SECRET",
    "EBAY_MARKETPLACE_ID"
  ];
  const emailProvider = emailProviderConfig();
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
  const supportedSearchProvider = !searchProvider || ["serpapi", "google_shopping", "custom"].includes(searchProvider.toLowerCase());
  const stripeCheckoutEnabled = envValue("STRIPE_CHECKOUT_ENABLED") === "true";
  const stripePublishableKey = envValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const stripeSecretKey = envValue("STRIPE_SECRET_KEY");
  const stripePublishableConfigured = Boolean(stripePublishableKey);
  const stripeSecretConfigured = Boolean(stripeSecretKey);
  const stripeWebhookConfigured = hasEnv("STRIPE_WEBHOOK_SECRET");
  const blobReadWriteTokenConfigured = hasEnv("BLOB_READ_WRITE_TOKEN");
  const storeBaseUrl = envValue("STORE_BASE_URL");
  const storeBaseUrlConfigured = Boolean(storeBaseUrl);
  const stripePublishableKeyMode = stripeKeyMode(stripePublishableKey, "pk");
  const stripeSecretKeyMode = stripeKeyMode(stripeSecretKey, "sk");
  const stripeTestMode = stripePublishableKeyMode === "test" || stripeSecretKeyMode === "test";
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
  const pushConfigured = publicKeyConfigured && privateKeyConfigured && subjectConfigured;
  const emailConfigured = emailProvider.configured;
  const smsConfigured = accountSidConfigured && authTokenConfigured && fromNumberConfigured;
  const pushHealthStatus = optionalProviderHealth(pushConfigured, anyEnv(pushEnvVars));
  const emailHealthStatus = optionalProviderHealth(emailConfigured, emailProvider.partiallyConfigured);
  const smsHealthStatus = optionalProviderHealth(smsConfigured, anyEnv(smsEnvVars));
  const searchFallbackHealthStatus =
    searchFallbackConfigured && supportedSearchProvider
      ? "configured"
      : anyEnv(searchEnvVars)
        ? "misconfigured"
        : "optional_not_configured";
  const stripePartiallyConfigured = stripeCheckoutEnabled || stripePublishableConfigured || stripeSecretConfigured || stripeWebhookConfigured;
  const stripeHealthStatus: ProviderHealthStatus =
    stripeMissing.length === 0
      ? "configured"
      : stripePartiallyConfigured
        ? "misconfigured"
        : "disabled";
  const storeBaseUrlHealthStatus: ProviderHealthStatus = storeBaseUrlConfigured ? "configured" : "optional_not_configured";
  const shippingRateHealthStatus: ProviderHealthStatus =
    shippingRateProvider.calculatedUspsEnabled && shippingRateProvider.shippoConfigured
      ? "configured"
      : shippingRateProvider.calculatedUspsEnabled
        ? "misconfigured"
        : "disabled";
  const blobHealthStatus = optionalProviderHealth(blobReadWriteTokenConfigured, anyEnv(blobEnvVars));
  const marketPartiallyConfigured =
    anyEnv(marketEnvVars.filter((name) => name !== "TCGCSV_ENABLED")) ||
    (hasEnv("TCGCSV_ENABLED") && envValue("TCGCSV_ENABLED") !== "false");
  const marketConfigured = tcgcsvEnabled || priceChartingConfigured || tcgplayerConfigured || ebaySoldConfigured;
  const marketHealthStatus = optionalProviderHealth(marketConfigured, marketPartiallyConfigured);

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
  const missingPushFeatureEnv = featureRequired.filter((name) => !hasEnv(name));
  const featureMissing = pushHealthStatus === "misconfigured" ? missingPushFeatureEnv : [];
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
  if (pushHealthStatus === "misconfigured") {
    warnings.push("Browser push env vars are partially configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together or leave browser push disabled.");
  }
  if (emailHealthStatus === "misconfigured") {
    warnings.push("Email provider is partially configured. Set RESEND_API_KEY and EMAIL_FROM together, configure SMTP_HOST and SMTP_FROM fallback together, or leave email disabled.");
  }
  if (smsHealthStatus === "misconfigured") {
    warnings.push("Twilio SMS is partially configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER together or leave SMS disabled.");
  }
  if (searchFallbackHealthStatus === "misconfigured") {
    warnings.push(
      supportedSearchProvider
        ? "Product search fallback is partially configured. Set PRODUCT_SEARCH_PROVIDER, PRODUCT_SEARCH_API_URL, and PRODUCT_SEARCH_API_KEY together or leave it disabled."
        : "PRODUCT_SEARCH_PROVIDER is not supported. Use serpapi, google_shopping, or custom."
    );
  }
  if (stripeHealthStatus === "misconfigured") {
    warnings.push(`Storefront Stripe Checkout is disabled until ${stripeMissing.join(", ")} ${stripeMissing.length === 1 ? "is" : "are"} set.`);
  }
  if (shippingRateHealthStatus === "misconfigured") {
    warnings.push("Calculated USPS shipping is enabled but Shippo or ship-from env vars are incomplete. Disable CALCULATED_USPS_SHIPPING_ENABLED or finish Shippo setup.");
  }
  if (marketHealthStatus === "misconfigured") {
    warnings.push("Market pricing providers are partially configured. Complete the selected provider env vars or leave automatic pricing disabled.");
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
        configured: pushConfigured,
        healthStatus: pushHealthStatus,
        envVars: pushEnvVars,
        message:
          pushHealthStatus === "configured"
            ? "Browser push can deliver notifications."
            : pushHealthStatus === "misconfigured"
              ? "Browser push is partially configured."
              : "Browser push is optional and not configured.",
        publicKeyConfigured,
        privateKeyConfigured,
        subjectConfigured
      },
      email: {
        configured: emailConfigured,
        provider: emailProvider.provider,
        healthStatus: emailHealthStatus,
        envVars: emailEnvVars,
        message:
          emailHealthStatus === "configured"
            ? emailProvider.provider === "resend"
              ? "Resend email is configured for customer notifications."
              : "SMTP email fallback is configured for email notifications."
            : emailHealthStatus === "misconfigured"
              ? "Email provider has partial configuration."
              : "Email provider is optional and not configured.",
        resendConfigured: emailProvider.resendConfigured,
        resendApiKeyConfigured: emailProvider.resendApiKeyConfigured,
        emailFromConfigured: emailProvider.emailFromConfigured,
        emailReplyToConfigured: emailProvider.emailReplyToConfigured,
        smtpConfigured: emailProvider.smtpConfigured,
        smtpHostConfigured: emailProvider.smtpHostConfigured,
        smtpFromConfigured: emailProvider.smtpFromConfigured,
        deliverability: {
          domainAuthenticationStatus: emailProvider.provider === "resend" ? "manual_check_required" : "not_applicable",
          dmarcStatus: "unknown_manual",
          customHeaders: ["X-Entity-Ref-ID", "X-GDD-Notification-Type", "X-GDD-Order-Number"],
          tags: ["orderNumber", "notificationType", "environment"],
          message:
            emailProvider.provider === "resend"
              ? "Resend is configured. Domain authentication and DMARC are DNS/provider checks and should be verified manually."
              : "Resend is not the active provider. DMARC is a manual DNS check."
        }
      },
      sms: {
        configured: smsConfigured,
        healthStatus: smsHealthStatus,
        envVars: smsEnvVars,
        message:
          smsHealthStatus === "configured"
            ? "Twilio SMS is configured for SMS notifications."
            : smsHealthStatus === "misconfigured"
              ? "Twilio SMS has partial configuration."
              : "Twilio SMS is optional and not configured.",
        accountSidConfigured,
        authTokenConfigured,
        fromNumberConfigured
      },
      upc: {
        configuredUpcProvider,
        publicUpcProvider: true,
        searchFallbackConfigured,
        searchFallbackHealthStatus,
        searchFallbackEnvVars: searchEnvVars,
        searchFallbackMessage:
          searchFallbackHealthStatus === "configured"
            ? "Product search fallback is configured for UPC provider misses."
            : searchFallbackHealthStatus === "misconfigured"
              ? "Product search fallback has partial or unsupported configuration."
              : "Product search fallback is optional and not configured.",
        searchProvider
      },
      stripe: {
        configured: stripeMissing.length === 0,
        healthStatus: stripeHealthStatus,
        envVars: stripeEnvVars,
        message:
          stripeHealthStatus === "configured"
            ? "Stripe Checkout and webhook secrets are configured."
            : stripeHealthStatus === "misconfigured"
              ? "Stripe Checkout is enabled or partially configured but missing required env vars."
              : "Stripe Checkout is disabled; Request Invoice fallback remains available.",
        checkoutEnabled: stripeCheckoutEnabled,
        publishableKeyConfigured: stripePublishableConfigured,
        secretKeyConfigured: stripeSecretConfigured,
        webhookSecretConfigured: stripeWebhookConfigured,
        storeBaseUrlConfigured,
        storeBaseUrlHealthStatus,
        storeBaseUrl,
        publishableKeyMode: stripePublishableKeyMode,
        secretKeyMode: stripeSecretKeyMode,
        testMode: stripeTestMode,
        checkoutSessionReady: stripeCheckoutEnabled && stripePublishableConfigured && stripeSecretConfigured,
        webhookReady: stripeWebhookConfigured,
        missing: stripeMissing
      },
      shippingRates: {
        configured: shippingRateHealthStatus === "configured",
        healthStatus: shippingRateHealthStatus,
        envVars: shippingRateProvider.envVars,
        message:
          shippingRateHealthStatus === "configured"
            ? "Calculated USPS shipping is enabled through Shippo."
            : shippingRateHealthStatus === "misconfigured"
              ? "Calculated USPS shipping is enabled but Shippo or ship-from configuration is incomplete."
              : "Calculated USPS shipping is disabled; internal smart shipping fallback remains available.",
        calculatedUspsEnabled: shippingRateProvider.calculatedUspsEnabled,
        provider: shippingRateProvider.provider,
        shippoConfigured: shippingRateProvider.shippoConfigured,
        shipFromZipConfigured: shippingRateProvider.shipFromZipConfigured,
        shipFromConfigured: shippingRateProvider.shipFromConfigured,
        fallbackEnabled: shippingRateProvider.fallbackEnabled,
        quoteTtlMinutes: shippingRateProvider.quoteTtlMinutes
      },
      blob: {
        configured: blobReadWriteTokenConfigured,
        healthStatus: blobHealthStatus,
        envVars: blobEnvVars,
        message:
          blobHealthStatus === "configured"
            ? "Vercel Blob uploads are configured for product gallery images."
            : blobHealthStatus === "misconfigured"
              ? "Vercel Blob upload configuration is incomplete."
              : "Vercel Blob uploads are optional and not configured.",
        readWriteTokenConfigured: blobReadWriteTokenConfigured,
        maxUploadSizeMb: 10
      },
      market: {
        healthStatus: marketHealthStatus,
        envVars: marketEnvVars,
        message:
          marketHealthStatus === "configured"
            ? "At least one market pricing provider is configured."
            : marketHealthStatus === "misconfigured"
              ? "Market pricing provider configuration is incomplete."
              : "Market pricing providers are optional and not configured.",
        priceChartingConfigured,
        tcgplayerConfigured,
        tcgcsvEnabled,
        ebaySoldConfigured,
        activeProvider
      }
    }
  };
}
