import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listInventoryPhysicalLocationBalances } from "@/lib/inventory-physical-location";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) return NextResponse.json({ error: "POS access required" }, { status: 403 });

  const storeUser = await resolvePosStoreUser(user);
  const scopedUser = String(user.role) === "CASHIER" ? { ...storeUser, role: user.role } : storeUser;
  const dashboard = await listDashboard(scopedUser);
  const balances = await listInventoryPhysicalLocationBalances(
    dashboard.inventory.map((item) => ({ id: item.id, onHandQuantity: item.quantityOwned }))
  );
  const balanceById = new Map(balances.map((balance) => [balance.inventoryItemId, balance]));
  const inventory = dashboard.inventory
    .map((item) => {
      const inStoreQuantity = balanceById.get(item.id)?.inStoreQuantity ?? item.quantityOwned;
      return {
        ...item,
        quantity: inStoreQuantity,
        quantityOwned: inStoreQuantity
      };
    })
    .filter((item) => item.quantityOwned > 0);

  return ok({ ...dashboard, inventory, currentUser: user });
}
