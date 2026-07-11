import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventorySale } from "@/lib/radar-service";
import { inventorySaleCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { itemId } = await params;
    const input = inventorySaleCreateSchema.parse(await readJson(request));
    const item = await createInventorySale(user, itemId, input);
    await logAudit({
      user,
      action: "inventory.sale.created",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} recorded an inventory sale for ${item.itemName}.`
    });
    return ok({ item }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
