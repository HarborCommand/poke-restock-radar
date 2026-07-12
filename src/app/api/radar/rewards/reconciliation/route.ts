import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, privateOk } from "@/lib/http";
import { calculateRewardBalanceAudit } from "@/lib/reward-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reconciliationQuerySchema = z.object({
  customerAccountId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
});

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const url = new URL(request.url);
    const query = reconciliationQuerySchema.parse({
      customerAccountId: url.searchParams.get("customerAccountId")
    });
    return privateOk(await calculateRewardBalanceAudit(query.customerAccountId));
  } catch (error) {
    return badRequest(error);
  }
}
