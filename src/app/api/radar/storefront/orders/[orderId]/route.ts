import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { updateStorefrontOrder } from "@/lib/storefront";
import { orderFulfillmentUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));
  try {
    const { orderId } = await params;
    const input = orderFulfillmentUpdateSchema.parse(await readJson(request));
    const order = await updateStorefrontOrder(user, orderId, input);
    await logAudit({
      user,
      action: "storefront.order.updated",
      entityType: "ORDER",
      entityId: order.id,
      summary: `${user.email} updated storefront order ${order.orderNumber}.`
    });
    return withRequestId(privateOk({ order }), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "The order could not be updated.");
  }
}
