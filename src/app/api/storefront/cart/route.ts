import { badRequest, ok, readJson } from "@/lib/http";
import {
  checkPublicRateLimit,
  PublicRateLimitExceededError,
  publicRateLimitCartIdentifier,
  publicRateLimitResponse
} from "@/lib/rate-limit";
import { getCartProducts } from "@/lib/storefront";
import { storefrontCartItemSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cartSchema = z.object({
  items: z.array(storefrontCartItemSchema).min(1).max(25)
});

export async function POST(request: Request) {
  try {
    const input = cartSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "cart_lookup",
      identifiers: [{ scope: "cart", value: publicRateLimitCartIdentifier(input.items) }]
    });
    const cart = await getCartProducts(input.items, { strict: false });
    return ok({
      items: cart.map(({ product, quantity }) => ({
        ...product,
        requestedQuantity: quantity
      }))
    });
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
