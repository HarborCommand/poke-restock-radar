import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateInventoryStoreListing } from "@/lib/storefront";
import { inventoryStoreListingSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const { itemId } = await params;
    const input = inventoryStoreListingSchema.parse(await readJson(request));
    const item = await updateInventoryStoreListing(user, itemId, input);
    await logAudit({
      user,
      action: "storefront.listing.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated store listing ${item.publicTitle || item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}
