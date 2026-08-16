import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { privateOk } from "@/lib/http";
import { listInventoryPhysicalLocationBalances } from "@/lib/inventory-physical-location";
import { posUnitPrice } from "@/lib/pos";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) {
    return NextResponse.json({ error: "POS access required" }, { status: 403 });
  }

  const storeUser = await resolvePosStoreUser(user);
  const dashboard = await listDashboard(storeUser);
  const balances = await listInventoryPhysicalLocationBalances(
    dashboard.inventory.map((item) => ({ id: item.id, onHandQuantity: item.quantityOwned }))
  );
  const balanceById = new Map(balances.map((balance) => [balance.inventoryItemId, balance]));

  const products = dashboard.inventory
    .map((item) => {
      const balance = balanceById.get(item.id) ?? {
        inStoreQuantity: item.quantityOwned,
        warehouseQuantity: 0
      };
      const price = posUnitPrice(item);
      return {
        id: item.id,
        title: item.publicTitle || item.itemName,
        itemName: item.itemName,
        category: item.category,
        setName: item.setName,
        imageUrl: item.imageUrl,
        upc: item.upc,
        sku: item.sku,
        price,
        onHandQuantity: item.quantityOwned,
        inStoreQuantity: balance.inStoreQuantity,
        warehouseQuantity: balance.warehouseQuantity,
        posReady: price !== null && balance.inStoreQuantity > 0
      };
    })
    .filter((item) => item.onHandQuantity > 0)
    .sort((left, right) => left.title.localeCompare(right.title));

  return privateOk({
    products,
    summary: {
      productCount: products.length,
      inStoreUnits: products.reduce((sum, item) => sum + item.inStoreQuantity, 0),
      warehouseUnits: products.reduce((sum, item) => sum + item.warehouseQuantity, 0),
      readyToSellCount: products.filter((item) => item.posReady).length
    }
  });
}
