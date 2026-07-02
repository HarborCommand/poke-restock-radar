import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createTerminalPosPaymentIntent } from "@/lib/stripe-terminal";
import { posTerminalPaymentIntentCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = posTerminalPaymentIntentCreateSchema.parse(await readJson(request));
    const terminalPayment = await createTerminalPosPaymentIntent(user, input);
    await logAudit({
      user,
      action: "pos.terminal.payment_intent.created",
      entityType: "POS_TERMINAL_PAYMENT",
      entityId: terminalPayment.paymentIntentId,
      summary: `${user.email} created a test-mode Stripe Terminal PaymentIntent for POS sale ${terminalPayment.saleReference}.`,
      metadata: {
        paymentIntentId: terminalPayment.paymentIntentId,
        saleReference: terminalPayment.saleReference,
        subtotal: terminalPayment.subtotal,
        tax: terminalPayment.tax,
        total: terminalPayment.total,
        itemCount: terminalPayment.itemCount
      }
    });
    return ok({ terminalPayment }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
