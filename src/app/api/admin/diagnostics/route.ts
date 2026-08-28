import { requireAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppHealth, publicHealthFromAppHealth } from "@/lib/health";
import { privateOk, safeMutationError, withRequestId } from "@/lib/http";
import { logServerEvent, observabilitySnapshot, requestCorrelationId } from "@/lib/observability";
import { storefrontDataDiagnostics } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeAction(value: string) {
  return /^[a-z0-9_.:-]{1,100}$/i.test(value) ? value : "other";
}

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  try {
    const [health, auditRows, storefront] = await Promise.all([
      getAppHealth(user),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { action: true, entityType: true, createdAt: true }
      }),
      storefrontDataDiagnostics()
    ]);
    const auditCounts = auditRows.reduce<Record<string, number>>((result, row) => {
      const action = safeAction(row.action);
      result[action] = (result[action] ?? 0) + 1;
      return result;
    }, {});
    return withRequestId(
      privateOk({
        health: publicHealthFromAppHealth(health),
        deployment: {
          commit: health.build.commitShort,
          environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"
        },
        storefront,
        events: observabilitySnapshot(25),
        audit: {
          counts: auditCounts,
          recent: auditRows.slice(0, 20).map((row) => ({
            action: safeAction(row.action),
            entityType: safeAction(row.entityType),
            timestamp: row.createdAt.toISOString()
          }))
        }
      }),
      requestId
    );
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/admin/diagnostics",
      operation: "admin.diagnostics.load",
      status: 500,
      durationMs: Date.now() - startedAt,
      error
    });
    return safeMutationError(error, requestId, "Diagnostics are temporarily unavailable.");
  }
}
