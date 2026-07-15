import { privateOk, readJson, withRequestId } from "@/lib/http";
import { assertSameOriginRequest, AuthOriginError, authOriginErrorResponse } from "@/lib/auth-origin";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { createCheckoutSession } from "@/lib/storefront";
import { storefrontCheckoutErrorResponse } from "@/lib/storefront-checkout-errors";
import { storefrontCheckoutSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOriginRequest(request);
    const input = storefrontCheckoutSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "checkout_creation",
      identifiers: [{ scope: "email", value: input.customerEmail }]
    });
    const result = await createCheckoutSession(input, { requestUrl: request.url });
    return withRequestId(privateOk(result), requestId);
  } catch (error) {
    if (error instanceof AuthOriginError) return withRequestId(authOriginErrorResponse(), requestId);
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return storefrontCheckoutErrorResponse(error, requestId);
  }
}
