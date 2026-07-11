import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateInventorySale } from "@/lib/radar-service";
import { inventorySaleUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string; saleId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { itemId, saleId } = await params;
    const input = inventorySaleUpdateSchema.parse(await readJson(request));
    const item = await updateInventorySale(user, itemId, saleId, input);
    await logAudit({
      user,
      action: "inventory.sale.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated an inventory sale for ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}
