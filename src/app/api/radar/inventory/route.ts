import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryItem } from "@/lib/radar-service";
import { inventoryCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
