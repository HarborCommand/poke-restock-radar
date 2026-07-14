import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { createPosSale } from "@/lib/radar-service";
import { posSaleCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));

  try {
    const input = posSaleCreateSchema.parse(await readJson(request));
    const sale = await createPosSale(user, input);
    await logAudit({
      user,
      requestId,
      action: "pos.sale.completed",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `Authenticated admin completed POS sale ${sale.saleReference} for ${sale.itemCount} item${sale.itemCount === 1 ? "" : "s"}.`,
      metadata: {
        saleReference: sale.saleReference,
        paymentMethod: sale.paymentMethod,
        subtotal: sale.subtotal,
        tax: sale.tax,
        total: sale.total,
        itemCount: sale.itemCount
      }
    });
    if (sale.taxExempt) {
      await logAudit({
        user,
        requestId,
        action: "pos.sale.tax_exemption_applied",
        entityType: "POS_SALE",
        entityId: sale.saleReference,
        summary: `Authenticated admin applied an approved tax exemption to POS sale ${sale.saleReference}.`,
        metadata: { saleReference: sale.saleReference, taxStatus: sale.taxStatus }
      });
    }
    return withRequestId(privateOk({ sale }, 201), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "The POS sale could not be completed.");
  }
}
