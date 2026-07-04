import { badRequest, ok, readJson } from "@/lib/http";
import {
  checkPublicRateLimit,
  PublicRateLimitExceededError,
  publicRateLimitCartIdentifier,
  publicRateLimitResponse
} from "@/lib/rate-limit";
import { createStorefrontShippingQuote } from "@/lib/storefront";
import { storefrontShippingQuoteSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontShippingQuoteSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "shipping_quote",
      identifiers: [
        { scope: "zip", value: input.destinationZip },
        { scope: "cart", value: publicRateLimitCartIdentifier(input.items, { destinationZip: input.destinationZip }) }
      ]
    });
    const result = await createStorefrontShippingQuote(input);
    return ok(result);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
