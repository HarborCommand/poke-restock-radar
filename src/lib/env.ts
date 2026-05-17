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
      }
    }
  };
}
