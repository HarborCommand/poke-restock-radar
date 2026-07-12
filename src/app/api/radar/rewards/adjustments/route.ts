import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, runWithRequestContext, safeEntityRef } from "@/lib/observability";
import { createAdminRewardAdjustment } from "@/lib/rewards-admin";
import { rewardAdminAdjustmentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  return runWithRequestContext(requestId, async () => {
    let customerAccountId: string | null = null;
    try {
      const input = rewardAdminAdjustmentSchema.parse(await readJson(request));
      customerAccountId = input.customerAccountId;
      const result = await createAdminRewardAdjustment(user, input);
      await logAudit({
        user,
        requestId,
        action: "customer.reward.adjusted",
        entityType: "CUSTOMER_ACCOUNT",
        entityId: input.customerAccountId,
        summary: `${user.email} ${input.action === "add" ? "added" : "deducted"} ${input.points} reward points.`,
        metadata: {
          customerAccountId: input.customerAccountId,
          points: input.action === "add" ? input.points : -input.points,
          reason: input.reason,
          duplicate: result.duplicate,
          hasAdminNote: Boolean(input.note)
        }
      });
      return withRequestId(privateOk(result, result.duplicate ? 200 : 201), requestId);
    } catch (error) {
      logServerEvent({
        requestId,
        route: "/api/radar/rewards/adjustments",
        operation: "reward.adjustment",
        status: 400,
        durationMs: Date.now() - startedAt,
        entityType: "CUSTOMER_ACCOUNT",
        entityRef: safeEntityRef(customerAccountId),
        error
      });
      return safeMutationError(error, requestId, "The reward adjustment could not be completed.");
    }
  });
}
