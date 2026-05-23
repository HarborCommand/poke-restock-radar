import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/db";
import { updateInventoryItem } from "@/lib/radar-service";
import { inventoryUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const { itemId } = await params;
    const input = inventoryUpdateSchema.parse(await readJson(request));
    const item = await updateInventoryItem(user, itemId, input);
    await logAudit({
      user,
      action: "inventory.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated inventory item ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
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
