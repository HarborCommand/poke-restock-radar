import { badRequest, ok, readJson } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { createCheckoutSession } from "@/lib/storefront";
import { storefrontCheckoutSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontCheckoutSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "checkout_creation",
      identifiers: [{ scope: "email", value: input.customerEmail }]
    });
    const result = await createCheckoutSession(input, { requestUrl: request.url });
    return ok(result);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
