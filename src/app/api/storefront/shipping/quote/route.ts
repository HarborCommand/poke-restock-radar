import { badRequest, ok, readJson } from "@/lib/http";
import { createStorefrontShippingQuote } from "@/lib/storefront";
import { storefrontShippingQuoteSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontShippingQuoteSchema.parse(await readJson(request));
    const result = await createStorefrontShippingQuote(input);
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}

