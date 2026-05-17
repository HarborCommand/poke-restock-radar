import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { markProductCheckedToday } from "@/lib/radar-service";
import { markCheckedTodaySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canRunChecks", "Run checks");
  if (permissionResponse) return permissionResponse;

  try {
    const { productId } = await params;
    const input = markCheckedTodaySchema.parse(await readJson(request));
    const product = await markProductCheckedToday(user, productId, input);
    await logAudit({
      user,
      action: "product.checked_today",
      entityType: "PRODUCT",
      entityId: productId,
      summary: `${user.email} marked ${product.name} checked today.`
    });
    return ok({ product });
  } catch (error) {
    return badRequest(error);
  }
}
