import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { POS_REFUND_REASON_LABELS } from "@/lib/pos";
import { refundPosSale } from "@/lib/radar-service";
import { posSaleRefundSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ saleReference: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { saleReference } = await params;
    const input = posSaleRefundSchema.parse(await readJson(request));
    const sale = await refundPosSale(user, decodeURIComponent(saleReference), input);
    await logAudit({
      user,
      action: "pos.sale.refund_recorded",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `${user.email} recorded a manual POS refund for ${sale.saleReference}.`,
      metadata: {
        saleReference: sale.saleReference,
        reason: POS_REFUND_REASON_LABELS[input.reason],
        restoreInventory: input.restoreInventory,
        total: sale.total
      }
    });
    return ok({ sale });
  } catch (error) {
    return badRequest(error);
  }
}
