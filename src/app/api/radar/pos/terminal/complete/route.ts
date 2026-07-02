import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { completeTerminalPosSale } from "@/lib/stripe-terminal";
import { posTerminalCompleteSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = posTerminalCompleteSchema.parse(await readJson(request));
    const sale = await completeTerminalPosSale(user, input);
    await logAudit({
      user,
      action: "pos.terminal.sale.completed",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `${user.email} completed test-mode Stripe Terminal POS sale ${sale.saleReference}.`,
      metadata: {
        saleReference: sale.saleReference,
        paymentMethod: sale.paymentMethod,
        stripePaymentIntentId: sale.stripePaymentIntentId,
        subtotal: sale.subtotal,
        tax: sale.tax,
        total: sale.total,
        itemCount: sale.itemCount
      }
    });
    return ok({ sale }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
