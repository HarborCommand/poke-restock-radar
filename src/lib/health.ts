import { prisma } from "@/lib/db";
import { getEnvironmentReport } from "@/lib/env";
import { authRuntimeConfig } from "@/lib/auth";
import { getBuildInfo } from "@/lib/build-info";
import type { AppHealthDTO, SessionUser } from "@/types/radar";

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
    database.error = errorMessage(error).slice(0, 240);
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
    passwordResetEmailConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM)
  };

  if (database.ok) {
    try {
      const now = new Date();
      const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const [lastMonitorRun, dueProductCount, lastAlert, unreadCount, adminUserCount, configuredAdminRows, lastAdminLogin] = await Promise.all([
        prisma.monitorLog.findFirst({ orderBy: { startedAt: "desc" } }),
        prisma.product.count({
          where: { monitorEnabled: true, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }
        }),
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

      monitor = {
        ...monitor,
        lastRunAt: lastMonitorRun?.startedAt.toISOString() ?? null,
        lastStatus: lastMonitorRun?.status ?? null,
        lastSummary: lastMonitorRun?.changeSummary ?? null,
        lastError: lastMonitorRun?.error ?? null,
        dueProductCount
      };
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
        lastError: errorMessage(error).slice(0, 240)
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
