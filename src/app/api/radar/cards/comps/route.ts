import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createCardCompSale } from "@/lib/radar-service";
import { cardCompCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddComps", "Add comps");
  if (permissionResponse) return permissionResponse;

  try {
    const input = cardCompCreateSchema.parse(await readJson(request));
    const result = await createCardCompSale(user, input);
    await logAudit({
      user,
      action: "card.comp.created",
      entityType: "CARD",
      entityId: result.card.id,
      summary: `${user.email} added a ${input.gradeType.replaceAll("_", " ")} comp for ${input.cardName}.`
    });
    return ok(result, 201);
  } catch (error) {
    return badRequest(error);
  }
}
