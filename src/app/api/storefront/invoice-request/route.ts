import { badRequest, ok, readJson } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { createInvoiceRequest } from "@/lib/storefront";
import { storefrontInvoiceRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontInvoiceRequestSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "invoice_request",
      identifiers: [{ scope: "email", value: input.customerEmail }]
    });
    const result = await createInvoiceRequest(input);
    return ok(result);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
