import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/db";
import { updateInventoryItem } from "@/lib/radar-service";
import { inventoryImageSanitizationMessage, inventoryUpdateSchema, sanitizeInventoryImagePayload } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { itemId } = await params;
    const { payload, warnings } = sanitizeInventoryImagePayload(await readJson(request));
    const input = inventoryUpdateSchema.parse(payload);
    const item = await updateInventoryItem(user, itemId, input);
    await logAudit({
      user,
      action: "inventory.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated inventory item ${item.itemName}.`
    });
    const warning = inventoryImageSanitizationMessage(warnings);
    return ok(warning ? { item, warning, warnings } : { item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { itemId } = await params;
    const existing = await prisma.inventoryItem.findFirst({
      where: { id: itemId, OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, itemName: true }
    });
    if (!existing) throw new Error("Inventory item not found");
    await prisma.inventoryItem.delete({ where: { id: itemId } });
    await logAudit({
      user,
      action: "inventory.deleted",
      entityType: "INVENTORY",
      entityId: itemId,
      summary: `${user.email} deleted inventory item ${existing.itemName}.`
    });
    return ok({ ok: true });
  } catch (error) {
    return badRequest(error);
  }
}
