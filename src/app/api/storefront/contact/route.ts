import { badRequest, ok, readJson } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { createContactMessage } from "@/lib/storefront";
import { storefrontContactMessageSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontContactMessageSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "contact_message",
      identifiers: [{ scope: "email", value: input.email }]
    });
    const result = await createContactMessage(input);
    return ok({
      ok: true,
      delivery: result.delivery,
      stored: result.stored,
      emailSent: result.emailSent,
      orderNumber: result.order.orderNumber,
      message: result.message
    });
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
