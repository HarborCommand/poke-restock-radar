import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryItem, listDashboard } from "@/lib/radar-service";
import { inventoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  const format = new URL(request.url).searchParams.get("format");
  if (format === "spending-csv") {
    const headers = ["purchaseDate", "itemName", "category", "quantity", "pricePaidPerItem", "taxShipping", "totalCost", "source", "retailer", "receiptNumber"];
    const rows = dashboard.inventory.map((item) =>
      [
        item.purchasedAt,
        item.itemName,
        item.category,
        item.quantity,
        item.cost,
        item.purchaseExtraCost,
        item.totalCost,
        item.source,
        item.retailer,
        item.receiptNumber
      ]
        .map(csvCell)
        .join(",")
    );
    return new Response([headers.join(","), ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=poke-restock-spending.csv"
      }
    });
  }
  if (format === "sales-csv") {
    const headers = ["soldDate", "itemName", "quantitySold", "soldPricePerItem", "grossSale", "platform", "fees", "shippingCost", "netSale", "costBasis", "profitLoss", "roiPercent"];
    const rows = dashboard.inventory.flatMap((item) =>
      item.sales.map((sale) =>
        [
          sale.soldAt,
          item.itemName,
          sale.quantitySold,
          sale.soldPricePerItem,
          sale.grossSale,
          sale.platform,
          sale.fees,
          sale.shippingCost,
          sale.netSale,
          sale.costBasis,
          sale.profitLoss,
          sale.roiPercent
        ]
          .map(csvCell)
          .join(",")
      )
    );
    return new Response([headers.join(","), ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=poke-restock-sales.csv"
      }
    });
  }
  if (format === "csv") {
    const headers = [
      "itemName",
      "category",
      "setName",
      "quantity",
      "purchasePricePerUnit",
      "totalCost",
      "source",
      "retailer",
      "purchaseDate",
      "targetSellPrice",
      "currentMarketEstimate",
      "estimatedNetProfit",
      "roiPercent",
      "recommendedAction",
      "listingStatus"
    ];
    const rows = dashboard.inventory.map((item) =>
      [
        item.itemName,
        item.category,
        item.setName,
        item.quantity,
        item.cost,
        item.totalCost,
        item.source,
        item.retailer,
        item.purchasedAt,
        item.targetSellPrice,
        item.currentMarketEstimate,
        item.estimatedNetProfit,
        item.roiPercent,
        item.recommendedAction,
        item.listingStatus
      ]
        .map(csvCell)
        .join(",")
    );
    return new Response([headers.join(","), ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=poke-restock-inventory.csv"
      }
    });
  }
  return ok({ inventory: dashboard.inventory, summary: dashboard.inventorySummary });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = inventoryCreateSchema.parse(await readJson(request));
    const item = await createInventoryItem(user, input);
    await logAudit({
      user,
      action: "inventory.created",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} logged inventory item ${item.itemName}.`
    });
    return ok({ item }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
