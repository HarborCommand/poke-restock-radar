import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { logProductPurchase } from "@/lib/radar-service";
import { productBoughtSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;

  try {
    const { productId } = await params;
    const input = productBoughtSchema.parse(await readJson(request));
    const item = await logProductPurchase(user, productId, input);
    await logAudit({
      user,
      action: "inventory.product_bought",
      entityType: "PRODUCT",
      entityId: productId,
      summary: `${user.email} logged purchase of ${item.quantity} ${item.itemName}.`
    });
    return ok({ item }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
