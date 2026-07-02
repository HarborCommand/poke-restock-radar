import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { cancelTerminalPosPaymentIntent } from "@/lib/stripe-terminal";
import { posTerminalCancelSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = posTerminalCancelSchema.parse(await readJson(request));
    const payment = await cancelTerminalPosPaymentIntent(user, input);
    await logAudit({
      user,
      action: "pos.terminal.payment_intent.canceled",
      entityType: "POS_TERMINAL_PAYMENT",
      entityId: payment.paymentIntentId,
      summary: `${user.email} canceled a test-mode Stripe Terminal payment.`,
      metadata: {
        paymentIntentId: payment.paymentIntentId,
        status: payment.status
      }
    });
    return ok({ payment });
  } catch (error) {
    return badRequest(error);
  }
}
