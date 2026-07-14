import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, runWithRequestContext, safeEntityRef } from "@/lib/observability";
import { cancelOrRefundStorefrontOrder } from "@/lib/storefront";
import { storefrontOrderCancelRefundSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return withRequestId(authorizationResponse, requestId);
  return runWithRequestContext(requestId, async () => {
    let orderId: string | null = null;
    try {
      ({ orderId } = await params);
      const input = storefrontOrderCancelRefundSchema.parse(await readJson(request));
      const order = await cancelOrRefundStorefrontOrder(user, orderId, input);
      await logAudit({
        user,
        requestId,
        action: "storefront.order.cancel_refund",
        entityType: "ORDER",
        entityId: order.id,
        summary: `${user.email} processed refund workflow for storefront order ${order.orderNumber}.`
      });
      return withRequestId(privateOk({ order }), requestId);
    } catch (error) {
      logServerEvent({
        requestId,
        route: "/api/radar/storefront/orders/[orderId]/cancel-refund",
        operation: "storefront_order.cancel_refund",
        status: 400,
        durationMs: Date.now() - startedAt,
        entityType: "ORDER",
        entityRef: safeEntityRef(orderId),
        error
      });
      return safeMutationError(error, requestId, "The cancel or refund operation could not be completed.");
    }
  });
}
