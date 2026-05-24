import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { lookupInventoryUpc } from "@/lib/radar-service";
import { upcLookupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = upcLookupSchema.parse(await readJson(request));
    const result = await lookupInventoryUpc(user, input);
    await logAudit({
      user,
      action: "inventory.upc.lookup",
      entityType: "INVENTORY",
      entityId: result.matchedInventoryItem?.id ?? result.matchedProduct?.id ?? null,
      summary: `${user.email} looked up UPC ${result.upc}: ${result.status}.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
