import { handleStripeWebhook } from "@/lib/storefront";
import { privateOk, safeApiError, withRequestId } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const result = await handleStripeWebhook(rawBody, signature);
    return withRequestId(privateOk(result), requestId);
  } catch {
    return safeApiError("WEBHOOK_REJECTED", "Webhook could not be processed.", 400, requestId, true);
  }
}
