import { prisma } from "@/lib/db";
import { getEnvironmentReport } from "@/lib/env";
import type { AppHealthDTO } from "@/types/radar";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function getAppHealth(): Promise<AppHealthDTO> {
  const env = getEnvironmentReport();
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

  if (database.ok) {
    try {
      const now = new Date();
      const [lastMonitorRun, dueProductCount, lastAlert, unreadCount] = await Promise.all([
        prisma.monitorLog.findFirst({ orderBy: { startedAt: "desc" } }),
        prisma.product.count({
          where: { monitorEnabled: true, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }
        }),
        prisma.alert.findFirst({ orderBy: { timestamp: "desc" } }),
        prisma.alert.count({ where: { read: false } })
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
    } catch (error) {
      monitor = {
        ...monitor,
        lastError: errorMessage(error).slice(0, 240)
      };
    }
  }

  const status: AppHealthDTO["status"] =
    !database.ok || env.coreMissing.length > 0 ? "ERROR" : env.warnings.length > 0 ? "WARN" : "OK";

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
    monitor,
    alerts,
    providers: env.providers
  };
}
