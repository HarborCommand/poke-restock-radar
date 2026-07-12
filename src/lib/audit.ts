import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types/radar";
import { currentRequestId, logMutationBreadcrumb, logServerEvent, requestCorrelationId, safeEntityRef } from "@/lib/observability";

type AuditInput = {
  user?: SessionUser | null;
  userId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
};

export async function logAudit(input: AuditInput) {
  const requestId = input.requestId ?? currentRequestId() ?? requestCorrelationId();
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? input.user?.id ?? null,
        actorEmail: input.actorEmail ?? input.user?.email ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: input.metadata ? JSON.stringify({ ...input.metadata, requestId }) : JSON.stringify({ requestId })
      }
    });
    logMutationBreadcrumb({
      requestId,
      route: "internal:audit",
      operation: input.action,
      entityType: input.entityType,
      entityRef: safeEntityRef(input.entityId),
      result: "audit_recorded"
    });
  } catch (error) {
    logServerEvent({
      requestId,
      route: "internal:audit",
      operation: "audit.write",
      status: 500,
      entityType: input.entityType,
      entityRef: safeEntityRef(input.entityId),
      error
    });
  }
}
