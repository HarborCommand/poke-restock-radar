import { del } from "@vercel/blob";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { deleteInventoryProductImage, updateInventoryProductImage } from "@/lib/radar-service";
import { inventoryProductImageUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string; imageId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { itemId, imageId } = await params;
    const input = inventoryProductImageUpdateSchema.parse(await readJson(request));
    const item = await updateInventoryProductImage(user, itemId, imageId, input);
    await logAudit({
      user,
      action: "inventory.image.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated a product image for ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string; imageId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { itemId, imageId } = await params;
    const result = await deleteInventoryProductImage(user, itemId, imageId);
    if (result.deletedImage.source === "uploaded" && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(result.deletedImage.url).catch(() => null);
    }
    await logAudit({
      user,
      action: "inventory.image.deleted",
      entityType: "INVENTORY",
      entityId: result.item.id,
      summary: `${user.email} deleted a product image from ${result.item.itemName}.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
