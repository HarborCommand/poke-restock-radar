import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { cancelOrRefundStorefrontOrder } from "@/lib/storefront";
import { storefrontOrderCancelRefundSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { orderId } = await params;
    const input = storefrontOrderCancelRefundSchema.parse(await readJson(request));
    const order = await cancelOrRefundStorefrontOrder(user, orderId, input);
    await logAudit({
      user,
      action: "storefront.order.cancel_refund",
      entityType: "ORDER",
      entityId: order.id,
      summary: `${user.email} processed refund workflow for storefront order ${order.orderNumber}.`
    });
    return ok({ order });
  } catch (error) {
    return badRequest(error);
  }
}
