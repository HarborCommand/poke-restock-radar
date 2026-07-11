import { badRequest, privateOk, readJson, withPrivateNoStore } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { lookupPublicOrderStatus } from "@/lib/storefront";
import { publicOrderStatusLookupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = publicOrderStatusLookupSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "order_status_lookup",
      identifiers: [
        { scope: "order", value: input.orderNumber },
        { scope: "email", value: input.email }
      ]
    });
    const result = await lookupPublicOrderStatus(input);
    return privateOk(result);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return withPrivateNoStore(badRequest(error));
  }
}
