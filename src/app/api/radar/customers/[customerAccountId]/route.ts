import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, privateJson, privateOk, readJson } from "@/lib/http";
import { getAdminCustomerRewardDetail, updateAdminCustomerProfile } from "@/lib/rewards-admin";
import { adminCustomerProfileUpdateSchema } from "@/lib/validation";

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

export async function PATCH(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const { customerAccountId } = await context.params;
    const input = adminCustomerProfileUpdateSchema.parse(await readJson(request));
    const result = await updateAdminCustomerProfile(customerAccountId, input);
    await logAudit({
      user,
      action: "customer.profile.updated",
      entityType: "CUSTOMER_ACCOUNT",
      entityId: customerAccountId,
      summary: `${user.email} updated customer profile fields.`,
      metadata: {
        customerAccountId,
        status: input.status,
        hasPhone: Boolean(input.phone),
        hasAdminNote: Boolean(input.adminNote)
      }
    });
    return privateOk(result);
  } catch (error) {
    return badRequest(error);
  }
}
