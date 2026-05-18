import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { reviewCardCompSale } from "@/lib/radar-service";
import { cardCompReviewSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ compId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canAddComps", "Review comps");
  if (permissionResponse) return permissionResponse;

  try {
    const { compId } = await params;
    const input = cardCompReviewSchema.parse(await readJson(request));
    const result = await reviewCardCompSale(user, compId, input);
    await logAudit({
      user,
      action: `card.comp.${input.action}`,
      entityType: "CARD",
      entityId: result.card.id,
      summary: `${user.email} ${input.action === "reject" ? "rejected" : "accepted"} a comp for ${result.card.cardName}.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
