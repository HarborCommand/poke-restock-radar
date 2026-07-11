import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, privateOk, readJson } from "@/lib/http";
import { createAdminRewardAdjustment } from "@/lib/rewards-admin";
import { rewardAdminAdjustmentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const input = rewardAdminAdjustmentSchema.parse(await readJson(request));
    const result = await createAdminRewardAdjustment(user, input);
    await logAudit({
      user,
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
    return privateOk(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return badRequest(error);
  }
}
