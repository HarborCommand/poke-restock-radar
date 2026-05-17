import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { runProductMonitorCheck } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canRunChecks", "Run checks");
  if (permissionResponse) return permissionResponse;

  try {
    const { productId } = await params;
    const result = await runProductMonitorCheck(productId, "MANUAL_PRODUCT", true);
    await logAudit({
      user,
      action: "monitor.product.run",
      entityType: "PRODUCT",
      entityId: productId,
      summary: `${user.email} ran a manual product check.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
