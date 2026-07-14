import { handleStripeWebhookRequest } from "@/lib/stripe-webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleStripeWebhookRequest(request);
}
