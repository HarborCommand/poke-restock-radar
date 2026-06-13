import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryItem, listDashboard } from "@/lib/radar-service";
import { inventoryCreateSchema, inventoryImageSanitizationMessage, sanitizeInventoryImagePayload } from "@/lib/validation";

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
    const headers = ["purchaseDate", "itemName", "category", "quantity", "pricePaidPerItem", "taxShipping", "totalCost", "source", "sourceStore", "retailer", "receiptNumber", "orderNumber", "transactionId", "paymentMethod", "receiptImageAttached"];
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
        item.sourceStore,
        item.retailer,
        item.receiptNumber,
        item.orderNumber,
        item.transactionId,
        item.paymentMethod,
        Boolean(item.receiptImageUrl)
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
    const headers = [
      "soldDate",
      "itemName",
      "quantitySold",
      "activeQuantitySold",
      "actualSalePrice",
      "originalSaleAmount",
      "refundedAmount",
      "netRevenueAfterRefund",
      "platform",
      "fees",
      "shippingCost",
      "activeNetSale",
      "costBasis",
      "activeProfitLoss",
      "netProfitAfterRefund",
      "roiPercent",
      "saleStatus",
      "storefrontOrderNumber"
    ];
    const rows = dashboard.inventory.flatMap((item) =>
      item.sales.map((sale) =>
        [
          sale.soldAt,
          item.itemName,
          sale.quantitySold,
          sale.activeQuantitySold,
          sale.actualSalePrice,
          sale.grossSale,
          sale.refundedAmount,
          sale.netRevenueAfterRefund,
          sale.platform,
          sale.fees,
          sale.shippingCost,
          sale.activeNetSale,
          sale.costBasis,
          sale.activeProfitLoss,
          sale.activeProfitLoss,
          sale.roiPercent,
          sale.saleStatus,
          sale.storefrontOrderNumber
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
  if (format === "stock-lots-csv") {
    const headers = [
      "itemName",
      "lotId",
      "purchasedAt",
      "source",
      "quantity",
      "costPerUnit",
      "taxShipping",
      "totalCost",
      "remainingQuantity",
      "receiptNumber",
      "orderNumber",
      "transactionId",
      "sourceStore",
      "paymentMethod",
      "receiptImageAttached",
      "notes"
    ];
    const rows = dashboard.inventory.flatMap((item) =>
      item.stockLots.map((lot) =>
        [
          item.itemName,
          lot.id,
          lot.purchasedAt,
          lot.source,
          lot.quantity,
          lot.costPerUnit,
          lot.purchaseExtraCost,
          lot.totalCost,
          lot.remainingQuantity,
          lot.receiptNumber,
          lot.orderNumber,
          lot.transactionId,
          lot.sourceStore,
          lot.paymentMethod,
          Boolean(lot.receiptImageUrl),
          lot.notes
        ]
          .map(csvCell)
          .join(",")
      )
    );
    return new Response([headers.join(","), ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=poke-restock-stock-lots.csv"
      }
    });
  }
  if (format === "profit-loss-summary-csv") {
    const headers = [
      "itemName",
      "quantityOwned",
      "quantitySold",
      "totalCostBasis",
      "marketEstimatePerUnit",
      "grossMarketValue",
      "estimatedFees",
      "estimatedShipping",
      "netMarketValue",
      "marketProfitLoss",
      "marketRoiPercent",
      "totalSalesGross",
      "totalSalesNet",
      "realizedProfitLoss",
      "businessProfitLoss",
      "recommendation",
      "marketConfidence",
      "marketCompCount",
      "lastRefreshed"
    ];
    const rows = dashboard.inventory.map((item) =>
      [
        item.itemName,
        item.quantityOwned,
        item.quantitySold,
        item.averageCost * item.quantityOwned,
        item.currentMarketEstimate,
        item.grossMarketValue,
        item.estimatedEbayFee,
        item.estimatedShippingCost,
        item.netMarketValue,
        item.marketProfitLoss,
        item.marketRoiPercent,
        item.totalSalesGross,
        item.totalSalesNet,
        item.realizedProfitLoss,
        item.businessProfitLoss,
        item.recommendedAction,
        item.marketConfidence,
        item.marketCompCount,
        item.marketLastRefreshedAt
      ]
        .map(csvCell)
        .join(",")
    );
    return new Response([headers.join(","), ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=poke-restock-profit-loss-summary.csv"
      }
    });
  }
  if (format === "csv" || format === "product-catalog-csv") {
    const headers = [
      "itemName",
      "category",
      "setName",
      "quantity",
      "purchasePricePerUnit",
      "totalCost",
      "source",
      "sourceStore",
      "retailer",
      "purchaseDate",
      "receiptNumber",
      "orderNumber",
      "transactionId",
      "paymentMethod",
      "receiptImageAttached",
      "targetSellPrice",
      "currentMarketEstimate",
      "marketCompCount",
      "marketConfidence",
      "grossMarketValue",
      "netMarketValue",
      "marketProfitLoss",
      "marketRoiPercent",
      "estimatedNetProfit",
      "roiPercent",
      "recommendedAction",
      "listingStatus",
      "linkedProductName",
      "linkedProductRetailer"
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
        item.sourceStore,
        item.retailer,
        item.purchasedAt,
        item.receiptNumber,
        item.orderNumber,
        item.transactionId,
        item.paymentMethod,
        Boolean(item.receiptImageUrl),
        item.targetSellPrice,
        item.currentMarketEstimate,
        item.marketCompCount,
        item.marketConfidence,
        item.grossMarketValue,
        item.netMarketValue,
        item.marketProfitLoss,
        item.marketRoiPercent,
        item.estimatedNetProfit,
        item.roiPercent,
        item.recommendedAction,
        item.listingStatus,
        item.linkedProductName,
        item.linkedProductRetailer
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
    const { payload, warnings } = sanitizeInventoryImagePayload(await readJson(request));
    const input = inventoryCreateSchema.parse(payload);
    const item = await createInventoryItem(user, input);
    await logAudit({
      user,
      action: "inventory.created",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} logged inventory item ${item.itemName}.`
    });
    const warning = inventoryImageSanitizationMessage(warnings);
    return ok(warning ? { item, warning, warnings } : { item }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
