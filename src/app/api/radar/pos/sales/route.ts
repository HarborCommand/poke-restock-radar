import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createPosSale } from "@/lib/radar-service";
import { posSaleCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const input = posSaleCreateSchema.parse(await readJson(request));
    const sale = await createPosSale(user, input);
    await logAudit({
      user,
      action: "pos.sale.completed",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `${user.email} completed POS sale ${sale.saleReference} for ${sale.itemCount} item${sale.itemCount === 1 ? "" : "s"}.`,
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
        action: "pos.sale.tax_exemption_applied",
        entityType: "POS_SALE",
        entityId: sale.saleReference,
        summary: `${user.email} applied an approved tax exemption to POS sale ${sale.saleReference}.`,
        metadata: { saleReference: sale.saleReference, taxStatus: sale.taxStatus }
      });
    }
    return ok({ sale }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
