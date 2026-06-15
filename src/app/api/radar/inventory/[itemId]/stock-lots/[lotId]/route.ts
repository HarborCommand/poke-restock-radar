import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { deleteInventoryStockLot, updateInventoryStockLot } from "@/lib/radar-service";
import { inventoryImageSanitizationMessage, inventoryStockLotUpdateSchema, sanitizeInventoryImagePayload } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adjustmentReasonLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string; lotId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const { itemId, lotId } = await params;
    const { payload, warnings } = sanitizeInventoryImagePayload(await readJson(request));
    const input = inventoryStockLotUpdateSchema.parse(payload);
    const item = await updateInventoryStockLot(user, itemId, lotId, input);
    await logAudit({
      user,
      action: "inventory.stock_lot.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} adjusted a stock lot for ${item.itemName}. Reason: ${adjustmentReasonLabel(input.adjustmentReason)}.`
    });
    const warning = inventoryImageSanitizationMessage(warnings);
    return ok(warning ? { item, warning, warnings } : { item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string; lotId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const { itemId, lotId } = await params;
    const item = await deleteInventoryStockLot(user, itemId, lotId);
    await logAudit({
      user,
      action: "inventory.stock_lot.deleted",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} removed a stock lot from ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}
