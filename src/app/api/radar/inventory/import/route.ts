import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryItem } from "@/lib/radar-service";
import { bulkImportSchema, inventoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCsv(data: string) {
  const [headerLine, ...lines] = data.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim());
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const input = bulkImportSchema.parse(await readJson(request));
    const rawRows = input.format === "json" ? JSON.parse(input.data) : parseCsv(input.data);
    const rows = Array.isArray(rawRows) ? rawRows : [];
    let created = 0;
    const errors: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const normalized = {
          ...row,
          cost: row.cost ?? row.purchasePricePerUnit,
          purchasedAt: row.purchasedAt ?? row.purchaseDate,
          itemType: row.itemType ?? (String(row.category || "").includes("card") ? "card" : "product")
        };
        const parsed = inventoryCreateSchema.parse(normalized);
        await createInventoryItem(user, parsed);
        created += 1;
      } catch (error) {
        errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : "Invalid inventory row"}`);
      }
    }
    return ok({ created, failed: errors.length, errors });
  } catch (error) {
    return badRequest(error);
  }
}
