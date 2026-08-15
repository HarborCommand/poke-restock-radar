import { requireUser } from "@/lib/auth";
import { internalServerError, ok, withRequestId } from "@/lib/http";
import { listInventoryPhysicalLocationBalances } from "@/lib/inventory-physical-location";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestComesFromStoreMode(request: Request) {
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).pathname === "/pos";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  try {
    const dashboard = await listDashboard(user);
    if (!requestComesFromStoreMode(request)) return withRequestId(ok(dashboard), requestId);

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

    return withRequestId(ok({ ...dashboard, inventory }), requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/dashboard",
      operation: "dashboard.load",
      status: 500,
      durationMs: Date.now() - startedAt,
      error
    });
    return internalServerError(requestId, "Private dashboard failed to load after sign-in.");
  }
}
