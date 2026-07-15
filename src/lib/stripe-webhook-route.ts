import { privateNoStoreHeaders, safeApiError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";
import { handleStripeWebhook } from "@/lib/storefront";

export async function handleStripeWebhookRequest(request: Request) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const result = await handleStripeWebhook(rawBody, signature);
    return withRequestId(Response.json(result, { headers: privateNoStoreHeaders }), requestId);
  } catch {
    // Never log the raw body, signature, provider error, customer data, or provider identifiers.
    logServerEvent({
      level: "warn",
      requestId,
      route: "/api/storefront/webhook/stripe",
      operation: "stripe_webhook.rejected",
      status: 400,
      durationMs: Date.now() - startedAt
    });
    return safeApiError(
      "STRIPE_WEBHOOK_REJECTED",
      "Stripe webhook could not be verified or processed.",
      400,
      requestId
    );
  }
}
