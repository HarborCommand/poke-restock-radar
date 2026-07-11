import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryMarketComp } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsv(csv: string) {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function moneyValue(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function intValue(value: string | undefined) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sourceQuality(value: string | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["EBAY_SOLD", "PRICECHARTING", "TCGPLAYER", "MANUAL_ESTIMATE", "ACTIVE_ASKING"].includes(normalized)) return normalized;
  if (normalized.includes("ASKING") || normalized.includes("ACTIVE")) return "ACTIVE_ASKING";
  if (normalized.includes("PRICE")) return "PRICECHARTING";
  if (normalized.includes("TCG")) return "TCGPLAYER";
  if (normalized.includes("EBAY")) return "EBAY_SOLD";
  return "MANUAL_ESTIMATE";
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const body = (await readJson(request)) as { csv?: string };
    const rows = parseCsv(body.csv ?? "");
    if (!rows.length) throw new Error("CSV needs a header row and at least one comp row.");

    const items = await prisma.inventoryItem.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, itemName: true, upc: true, sku: true, dpci: true, asin: true }
    });
    const byKey = new Map<string, string>();
    for (const item of items) {
      byKey.set(item.id.toLowerCase(), item.id);
      byKey.set(item.itemName.toLowerCase(), item.id);
      for (const key of [item.upc, item.sku, item.dpci, item.asin]) {
        if (key) byKey.set(key.replace(/\D/g, "") || key.toLowerCase(), item.id);
      }
    }

    const results: Array<{ row: number; status: "imported" | "skipped"; reason?: string; itemId?: string }> = [];
    for (const [index, row] of rows.entries()) {
      const lookupKey = row.inventoryitemid || row.inventory_item_id || row.itemid || row.id || row.upc || row.sku || row.productname || row.product || row.name || "";
      const normalizedLookup = lookupKey.replace(/\D/g, "") || lookupKey.toLowerCase();
      const itemId = byKey.get(normalizedLookup);
      const salePrice = moneyValue(row.soldprice || row.saleprice || row.price || row.sold_price);
      const soldAt = new Date(row.solddate || row.soldat || row.date || row.sold_date || "");
      if (!itemId) {
        results.push({ row: index + 2, status: "skipped", reason: "inventory item not found" });
        continue;
      }
      if (salePrice === null || Number.isNaN(soldAt.getTime())) {
        results.push({ row: index + 2, status: "skipped", reason: "sale price or sold date missing" });
        continue;
      }
      await createInventoryMarketComp(user, {
        inventoryItemId: itemId,
        saleTitle: row.title || row.saletitle || row.sale_title || "Imported sold comp",
        salePrice,
        soldAt,
        sourceUrl: row.url || row.sourceurl || row.source_url || undefined,
        sourceQuality: sourceQuality(row.source || row.sourcequality || row.source_quality),
        platform: row.platform || undefined,
        condition: row.condition || undefined,
        quantity: intValue(row.quantity || row.qty),
        shippingCharged: moneyValue(row.shipping || row.shippingcharged || row.shipping_charged) ?? undefined,
        matchScore: intValue(row.confidence || row.matchscore || row.match_score) ?? 85,
        notes: row.notes || undefined
      });
      results.push({ row: index + 2, status: "imported", itemId });
    }

    await logAudit({
      user,
      action: "inventory.comp.imported",
      entityType: "INVENTORY",
      entityId: null,
      summary: `${user.email} imported ${results.filter((result) => result.status === "imported").length} inventory market comp(s).`
    });
    return ok({ results, imported: results.filter((result) => result.status === "imported").length });
  } catch (error) {
    return badRequest(error);
  }
}
