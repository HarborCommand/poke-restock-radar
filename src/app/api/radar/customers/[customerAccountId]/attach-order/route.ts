import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { badRequest, privateJson, privateOk, readJson } from "@/lib/http";
import { attachAdminCustomerOrder, searchAdminCustomerAttachCandidates } from "@/lib/admin-customer-order-links";
import { getAdminCustomerRewardDetail } from "@/lib/rewards-admin";
import { adminCustomerAttachOrderSchema, adminCustomerAttachOrderSearchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { customerAccountId } = await context.params;
    const url = new URL(request.url);
    const input = adminCustomerAttachOrderSearchSchema.parse({
      query: url.searchParams.get("query") ?? undefined
    });
    const result = await searchAdminCustomerAttachCandidates(customerAccountId, input.query);
    return privateOk(result);
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const { customerAccountId } = await context.params;
    const input = adminCustomerAttachOrderSchema.parse(await readJson(request));
    const result = await attachAdminCustomerOrder(user, customerAccountId, input, getAdminCustomerRewardDetail);
    return privateOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not attach order.";
    if (/not found/i.test(message)) return privateJson({ error: message }, 404);
    return badRequest(error);
  }
}
