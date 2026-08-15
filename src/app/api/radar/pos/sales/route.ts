import { requireUser } from "@/lib/auth";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import {
  consumeInventoryPhysicalQuantity,
  listInventoryPhysicalLocationBalances
} from "@/lib/inventory-physical-location";
import { requestCorrelationId } from "@/lib/observability";
import { createPosSale, listDashboard } from "@/lib/radar-service";
import { posSaleCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizePosMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));

  try {
    const input = posSaleCreateSchema.parse(await readJson(request));
    const storeUser = await resolvePosStoreUser(user);
    const beforeDashboard = await listDashboard(storeUser);
    const beforeById = new Map(beforeDashboard.inventory.map((item) => [item.id, item]));
    const balances = await listInventoryPhysicalLocationBalances(
      beforeDashboard.inventory.map((item) => ({ id: item.id, onHandQuantity: item.quantityOwned }))
    );
    const balanceById = new Map(balances.map((balance) => [balance.inventoryItemId, balance]));

    for (const line of input.items) {
      const inventoryItem = beforeById.get(line.inventoryItemId);
      if (!inventoryItem) throw new Error("One or more POS cart items could not be found.");
      const inStoreQuantity = balanceById.get(line.inventoryItemId)?.inStoreQuantity ?? inventoryItem.quantityOwned;
      if (line.quantity > inStoreQuantity) {
        throw new Error(
          `${inventoryItem.publicTitle || inventoryItem.itemName} only has ${inStoreQuantity} unit${inStoreQuantity === 1 ? "" : "s"} assigned In Store. Move more stock to In Store before completing this sale.`
        );
      }
    }

    const sale = await createPosSale(storeUser, { ...input, requestId });

    const afterDashboard = await listDashboard(storeUser);
    const afterById = new Map(afterDashboard.inventory.map((item) => [item.id, item]));
    for (const line of input.items) {
      const beforeItem = beforeById.get(line.inventoryItemId);
      if (!beforeItem) continue;
      const afterOnHand = afterById.get(line.inventoryItemId)?.quantityOwned ?? 0;
      const actualInventoryReduction = Math.max(0, beforeItem.quantityOwned - afterOnHand);
      const locationReduction = Math.min(line.quantity, actualInventoryReduction);
      if (locationReduction > 0) {
        await consumeInventoryPhysicalQuantity(
          line.inventoryItemId,
          "IN_STORE",
          locationReduction,
          beforeItem.quantityOwned
        );
      }
    }

    const actorLabel = String(user.role) === "CASHIER" ? "cashier" : "admin";
    await logAudit({
      user,
      requestId,
      action: "pos.sale.completed",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `Authenticated ${actorLabel} completed POS sale ${sale.saleReference} for ${sale.itemCount} item${sale.itemCount === 1 ? "" : "s"}.`,
      metadata: {
        saleReference: sale.saleReference,
        paymentMethod: sale.paymentMethod,
        subtotal: sale.subtotal,
        tax: sale.tax,
        total: sale.total,
        itemCount: sale.itemCount,
        actorRole: String(user.role),
        storeOwnerUserId: storeUser.id
      }
    });
    if (sale.taxExempt) {
      await logAudit({
        user,
        requestId,
        action: "pos.sale.tax_exemption_applied",
        entityType: "POS_SALE",
        entityId: sale.saleReference,
        summary: `Authenticated ${actorLabel} applied an approved tax exemption to POS sale ${sale.saleReference}.`,
        metadata: { saleReference: sale.saleReference, taxStatus: sale.taxStatus, actorRole: String(user.role), storeOwnerUserId: storeUser.id }
      });
    }
    return withRequestId(privateOk({ sale }, 201), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "The POS sale could not be completed.");
  }
}
