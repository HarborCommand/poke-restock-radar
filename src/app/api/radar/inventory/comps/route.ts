import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createInventoryMarketComp } from "@/lib/radar-service";
import { inventoryCompCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const input = inventoryCompCreateSchema.parse(await readJson(request));
    const item = await createInventoryMarketComp(user, input);
    await logAudit({
      user,
      action: "inventory.comp.created",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} added inventory market comp for ${item.itemName}.`
    });
    return ok({ item }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
