import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateStorefrontOrder } from "@/lib/storefront";
import { orderFulfillmentUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
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
    return ok({ order });
  } catch (error) {
    return badRequest(error);
  }
}
