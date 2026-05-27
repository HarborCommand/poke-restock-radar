import { requireUser } from "@/lib/auth";
import { inventoryPdfFilename, renderInventoryPdf, type InventoryPdfMode } from "@/lib/inventory-pdf";
import { listDashboard } from "@/lib/radar-service";
import type { InventoryItemDTO } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMode(value: string | null): InventoryPdfMode | null {
  if (!value || value === "client") return "client";
  if (value === "internal") return "internal";
  return null;
}

function matchesSearch(item: InventoryItemDTO, search: string) {
  if (!search) return true;
  const haystack = [item.itemName, item.upc, item.sku, item.dpci, item.asin, item.category, item.setName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

function filterInventory(items: InventoryItemDTO[], request: Request, mode: InventoryPdfMode) {
  const params = new URL(request.url).searchParams;
  const stock = params.get("stock") || (mode === "client" ? "in-stock" : "all");
  const category = params.get("category") || "ALL";
  const listingStatus = params.get("listingStatus") || "ALL";
  const source = (params.get("source") || "").trim().toLowerCase();
  const search = (params.get("q") || "").trim().toLowerCase();

  return items
    .filter((item) => (stock === "in-stock" ? item.quantityOwned > 0 : true))
    .filter((item) => category === "ALL" || item.category === category)
    .filter((item) => listingStatus === "ALL" || item.listingStatus === listingStatus)
    .filter((item) => !source || item.source.toLowerCase().includes(source) || (item.sourceStore || "").toLowerCase().includes(source))
    .filter((item) => matchesSearch(item, search))
    .sort((a, b) => {
      if (a.quantityOwned !== b.quantityOwned) return b.quantityOwned - a.quantityOwned;
      return a.itemName.localeCompare(b.itemName);
    });
}

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const mode = normalizeMode(new URL(request.url).searchParams.get("mode"));
  if (!mode) {
    return new Response(JSON.stringify({ error: "Invalid PDF export mode." }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const dashboard = await listDashboard(user);
  const items = filterInventory(dashboard.inventory, request, mode);
  const generatedAt = new Date();
  const pdf = await renderInventoryPdf({
    mode,
    items,
    summary: dashboard.inventorySummary,
    generatedAt
  });

  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${inventoryPdfFilename(mode, generatedAt)}"`,
      "cache-control": "no-store"
    }
  });
}
