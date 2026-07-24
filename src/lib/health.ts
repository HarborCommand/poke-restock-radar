import { prisma } from "@/lib/db";
import { emailProviderConfigured } from "@/lib/email-provider";
import { getEnvironmentReport } from "@/lib/env";
import { authRuntimeConfig } from "@/lib/auth";
import { getBuildInfo } from "@/lib/build-info";
import type { AppHealthDTO, PublicAppHealthDTO, SessionUser } from "@/types/radar";
import { sanitizeLogText } from "@/lib/observability";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function appHealthStatusFromChecks(input: {
  databaseOk: boolean;
  coreMissing: string[];
  authReady: boolean;
  adminUserCount: number;
  configuredAdminEmailExists: boolean;
  warnings: string[];
}): AppHealthDTO["status"] {
  if (!input.databaseOk || input.coreMissing.length > 0 || !input.authReady || input.adminUserCount === 0) return "ERROR";
  if (input.warnings.length > 0 || !input.configuredAdminEmailExists) return "WARN";
  return "OK";
}

export function publicHealthFromAppHealth(health: AppHealthDTO): PublicAppHealthDTO {
  const warningCategories = new Set<PublicAppHealthDTO["warningCategories"][number]>();
  let warningCount = 0;

  if (!health.database.ok) {
    warningCategories.add("database");
    warningCount += 1;
  }

  const configurationWarningCount =
    health.environment.coreMissing.length + health.environment.featureMissing.length + health.environment.warnings.length;
  if (configurationWarningCount > 0) {
    warningCategories.add("configuration");
    warningCount += configurationWarningCount;
  }

  const authWarningCount =
    Number(!health.auth.authReady) + Number(health.auth.adminUserCount === 0) + Number(!health.auth.configuredAdminEmailExists);
  if (authWarningCount > 0) {
    warningCategories.add("auth");
    warningCount += authWarningCount;
  }

  const providerWarningCount = Object.values(health.providers).filter(
    (provider) =>
      typeof provider === "object" &&
      provider !== null &&
      "healthStatus" in provider &&
      (provider as { healthStatus?: string }).healthStatus === "misconfigured"
  ).length;
  if (providerWarningCount > 0) {
    warningCategories.add("providers");
    warningCount += providerWarningCount;
  }

  if (health.monitor.lastError) {
    warningCategories.add("monitor");
    warningCount += 1;
  }

  return {
    status: health.status,
    timestamp: health.checkedAt,
    databaseOk: health.database.ok,
    warningCount,
    warningCategories: Array.from(warningCategories),
    buildCommit: health.build.commitShort
  };
}

export async function getAppHealth(currentUser?: SessionUser): Promise<AppHealthDTO> {
  const env = getEnvironmentReport();
  const authConfig = authRuntimeConfig();
  const checkedAt = new Date().toISOString();
  const database: AppHealthDTO["database"] = {
    ok: false,
    provider: env.databaseProvider,
    urlConfigured: env.databaseProvider !== "unknown",
    productionSafe: env.nodeEnv !== "production" || env.databaseProvider === "postgres"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    database.ok = true;
  } catch (error) {
    database.error = sanitizeLogText(errorMessage(error)).slice(0, 240);
  }

  let monitor: AppHealthDTO["monitor"] = {
    lastRunAt: null,
    lastStatus: null,
    lastSummary: null,
    lastError: null,
    dueProductCount: 0,
    requestDelayMs: env.providers.cron.requestDelayMs,
    monitorJobSecretConfigured: env.providers.cron.monitorJobSecretConfigured,
    vercelCronSecretConfigured: env.providers.cron.vercelCronSecretConfigured
  };
  let alerts: AppHealthDTO["alerts"] = {
    lastAlertAt: null,
    lastAlertTitle: null,
    lastAlertPriority: null,
    unreadCount: 0
  };
  let auth: AppHealthDTO["auth"] = {
    authSecretConfigured: authConfig.authSecretConfigured,
    authSecretStrong: authConfig.authSecretStrong,
    authReady: authConfig.authReady,
    sessionCookieName: authConfig.sessionCookieName,
    secureCookie: authConfig.secureCookie,
    sameSite: authConfig.sameSite,
    sessionDays: authConfig.sessionDays,
    currentSessionValid: Boolean(currentUser),
    currentSessionEmail: currentUser?.email ?? null,
    currentSessionRole: currentUser?.role ?? null,
    adminUserCount: 0,
    configuredAdminEmailPresent: Boolean(process.env.ADMIN_EMAIL?.trim()),
    configuredAdminEmailExists: false,
    lastAdminLoginAt: null,
    passwordResetEmailConfigured: emailProviderConfigured()
  };

  if (database.ok) {
    try {
      const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const [lastAlert, unreadCount, adminUserCount, configuredAdminRows, lastAdminLogin] = await Promise.all([
        prisma.alert.findFirst({ orderBy: { timestamp: "desc" } }),
        prisma.alert.count({ where: { read: false } }),
        prisma.user.count({ where: { role: "ADMIN" } }),
        configuredAdminEmail
          ? prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "User" WHERE lower("email") = ${configuredAdminEmail} AND "role" = 'ADMIN' LIMIT 1
            `
          : Promise.resolve([]),
        prisma.user.findFirst({
          where: { role: "ADMIN", lastLoginAt: { not: null } },
          orderBy: { lastLoginAt: "desc" },
          select: { lastLoginAt: true }
        })
      ]);

      alerts = {
        lastAlertAt: lastAlert?.timestamp.toISOString() ?? null,
        lastAlertTitle: lastAlert?.title ?? null,
        lastAlertPriority: lastAlert?.priority ?? null,
        unreadCount
      };
      auth = {
        ...auth,
        adminUserCount,
        configuredAdminEmailExists: configuredAdminRows.length > 0,
        lastAdminLoginAt: lastAdminLogin?.lastLoginAt?.toISOString() ?? null
      };
    } catch (error) {
      monitor = {
        ...monitor,
        lastError: sanitizeLogText(errorMessage(error)).slice(0, 240)
      };
    }
  }

  const status = appHealthStatusFromChecks({
    databaseOk: database.ok,
    coreMissing: env.coreMissing,
    authReady: auth.authReady,
    adminUserCount: auth.adminUserCount,
    configuredAdminEmailExists: auth.configuredAdminEmailExists,
    warnings: env.warnings
  });

  return {
    status,
    checkedAt,
    environment: {
      nodeEnv: env.nodeEnv,
      appUrl: env.appUrl,
      isVercel: env.isVercel,
      coreMissing: env.coreMissing,
      featureMissing: env.featureMissing,
      warnings: env.warnings
    },
    database,
    auth,
    monitor,
    alerts,
    build: getBuildInfo(),
    providers: env.providers
  };
}
