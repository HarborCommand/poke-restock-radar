import { requireUser } from "@/lib/auth";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { sendPosReceiptEmail } from "@/lib/radar-service";
import { receiptEmailResendSchema } from "@/lib/validation";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ saleReference: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const posResponse = authorizePosMutation(request, user);
  if (posResponse) return withPrivateNoStore(withRequestId(posResponse, requestId));

  try {
    const { saleReference } = await params;
    const input = receiptEmailResendSchema.parse(await readJson(request));
    const storeUser = await resolvePosStoreUser(user);
    await checkPublicRateLimit({
      request,
      action: "admin_receipt_email",
      identifiers: [
        { scope: "order", value: saleReference },
        { scope: "email", value: input.email }
      ]
    });
    const sale = await sendPosReceiptEmail(storeUser, decodeURIComponent(saleReference), { ...input, requestId });
    return withRequestId(privateOk({ sale }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "The POS receipt email could not be sent.");
  }
}
