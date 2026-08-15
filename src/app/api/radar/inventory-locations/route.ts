import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { badRequest, ok, readJson } from "@/lib/http";
import {
  getInventoryPhysicalLocationBalance,
  listInventoryPhysicalLocationBalances,
  normalizeInventoryPhysicalLocation,
  transferInventoryPhysicalQuantity
} from "@/lib/inventory-physical-location";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function locationFromBalance(inStoreQuantity: number, warehouseQuantity: number) {
  return warehouseQuantity > 0 && inStoreQuantity <= 0 ? "WAREHOUSE" : "IN_STORE";
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) return NextResponse.json({ error: "POS access required" }, { status: 403 });

  const storeUser = await resolvePosStoreUser(user);
  const dashboard = await listDashboard(storeUser);
  const balances = await listInventoryPhysicalLocationBalances(
    dashboard.inventory.map((item) => ({ id: item.id, onHandQuantity: item.quantityOwned }))
  );
  const balanceById = new Map(balances.map((balance) => [balance.inventoryItemId, balance]));

  return ok({
    items: dashboard.inventory
      .map((item) => {
        const balance = balanceById.get(item.id) ?? {
          inventoryItemId: item.id,
          onHandQuantity: item.quantityOwned,
          inStoreQuantity: item.quantityOwned,
          warehouseQuantity: 0
        };
        return {
          id: item.id,
          itemName: item.itemName,
          publicTitle: item.publicTitle,
          quantity: item.quantityOwned,
          onHandQuantity: item.quantityOwned,
          inStoreQuantity: balance.inStoreQuantity,
          warehouseQuantity: balance.warehouseQuantity,
          category: item.category,
          setName: item.setName,
          imageUrl: item.imageUrl,
          upc: item.upc,
          sku: item.sku,
          location: locationFromBalance(balance.inStoreQuantity, balance.warehouseQuantity)
        };
      })
      .sort((a, b) => a.itemName.localeCompare(b.itemName))
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;

  try {
    const payload = await readJson(request);
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    if (!inventoryItemId) throw new Error("Inventory item is required.");

    const storeUser = await resolvePosStoreUser(user);
    const dashboard = await listDashboard(storeUser);
    const item = dashboard.inventory.find((candidate) => candidate.id === inventoryItemId);
    if (!item) throw new Error("Inventory item was not found.");

    const requestedFrom = normalizeInventoryPhysicalLocation(body.fromLocation);
    const requestedTo = normalizeInventoryPhysicalLocation(body.toLocation);
    const requestedQuantity = Math.floor(Number(body.quantity) || 0);

    let balance;
    if (requestedFrom && requestedTo) {
      balance = await transferInventoryPhysicalQuantity(
        item.id,
        requestedFrom,
        requestedTo,
        requestedQuantity,
        item.quantityOwned
      );
    } else {
      const legacyLocation = normalizeInventoryPhysicalLocation(body.location);
      if (!legacyLocation) throw new Error("Choose where the inventory should be moved.");
      const current = await getInventoryPhysicalLocationBalance(item.id, item.quantityOwned);
      const fromLocation = legacyLocation === "IN_STORE" ? "WAREHOUSE" : "IN_STORE";
      const quantityToMove = fromLocation === "IN_STORE" ? current.inStoreQuantity : current.warehouseQuantity;
      balance = quantityToMove > 0
        ? await transferInventoryPhysicalQuantity(item.id, fromLocation, legacyLocation, quantityToMove, item.quantityOwned)
        : current;
    }

    return ok({
      item: {
        id: item.id,
        itemName: item.itemName,
        publicTitle: item.publicTitle,
        onHandQuantity: item.quantityOwned,
        quantity: item.quantityOwned,
        inStoreQuantity: balance.inStoreQuantity,
        warehouseQuantity: balance.warehouseQuantity,
        location: locationFromBalance(balance.inStoreQuantity, balance.warehouseQuantity)
      }
    });
  } catch (error) {
    return badRequest(error);
  }
}
