import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
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
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const { itemId, lotId } = await params;
    const { payload, warnings } = sanitizeInventoryImagePayload(await readJson(request));
    const input = inventoryStockLotUpdateSchema.parse(payload);
    const { item, adjustment } = await updateInventoryStockLot(user, itemId, lotId, input);
    await logAudit({
      user,
      action: "inventory.stock_lot.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} adjusted a stock lot for ${item.itemName}. Reason: ${adjustmentReasonLabel(input.adjustmentReason)}. On hand ${adjustment.previousOnHand} -> ${adjustment.nextOnHand}.`,
      metadata: {
        actionType: "adjust_stock",
        reason: input.adjustmentReason,
        note: input.adjustmentNote ?? null,
        previousOnHand: adjustment.previousOnHand,
        newOnHand: adjustment.nextOnHand,
        previousLotQuantity: adjustment.previousLotQuantity,
        newLotQuantity: adjustment.nextLotQuantity,
        previousLotRemaining: adjustment.previousLotRemaining,
        newLotRemaining: adjustment.nextLotRemaining,
        soldFromLot: adjustment.soldFromLot,
        stockQuantityChanged: adjustment.stockQuantityChanged
      }
    });
    const warning = [
      inventoryImageSanitizationMessage(warnings),
      adjustment.stockQuantityChanged ? `Stock updated. On hand is now ${adjustment.nextOnHand}.` : "No stock quantity changed."
    ].filter(Boolean).join(" ");
    return ok(warning ? { item, warning, warnings } : { item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ itemId: string; lotId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
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
