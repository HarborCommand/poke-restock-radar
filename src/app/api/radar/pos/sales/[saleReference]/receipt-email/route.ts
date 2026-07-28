import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { sendPosReceiptEmail } from "@/lib/radar-service";
import { receiptEmailResendSchema } from "@/lib/validation";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ saleReference: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));

  try {
    const { saleReference } = await params;
    const input = receiptEmailResendSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_receipt_email",
      identifiers: [
        { scope: "order", value: saleReference },
        { scope: "email", value: input.email }
      ]
    });
    const sale = await sendPosReceiptEmail(user, decodeURIComponent(saleReference), { ...input, requestId });
    return withRequestId(privateOk({ sale }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "The POS receipt email could not be sent.");
  }
}
