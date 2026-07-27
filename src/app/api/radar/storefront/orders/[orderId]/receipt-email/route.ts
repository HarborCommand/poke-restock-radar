import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { getStorefrontOrderReceiptEmailStatus, sendStorefrontOrderReceiptEmail } from "@/lib/storefront";
import { receiptEmailResendSchema } from "@/lib/validation";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));

  try {
    const { orderId } = await params;
    const delivery = await getStorefrontOrderReceiptEmailStatus(user, orderId);
    return withPrivateNoStore(withRequestId(privateOk({ delivery }), requestId));
  } catch (error) {
    return safeMutationError(error, requestId, "The storefront receipt email status could not be loaded.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));

  try {
    const { orderId } = await params;
    const input = receiptEmailResendSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_receipt_email",
      identifiers: [
        { scope: "order", value: orderId },
        { scope: "email", value: input.email }
      ]
    });
    const delivery = await sendStorefrontOrderReceiptEmail(user, orderId, { ...input, requestId });
    return withRequestId(privateOk({ delivery }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "The storefront receipt email could not be sent.");
  }
}
