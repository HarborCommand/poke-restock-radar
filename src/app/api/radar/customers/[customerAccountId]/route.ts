import { requireAdmin, requireUser } from "@/lib/auth";
import { privateJson, privateOk } from "@/lib/http";
import { getAdminCustomerRewardDetail } from "@/lib/rewards-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  const { customerAccountId } = await context.params;
  const customer = await getAdminCustomerRewardDetail(customerAccountId);
  if (!customer) return privateJson({ error: "Customer account was not found." }, 404);
  return privateOk({ customer });
}
