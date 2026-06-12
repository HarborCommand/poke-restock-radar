import { badRequest, ok, readJson } from "@/lib/http";
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
    const cart = await getCartProducts(input.items, { strict: false });
    return ok({
      items: cart.map(({ product, quantity }) => ({
        ...product,
        requestedQuantity: quantity
      }))
    });
  } catch (error) {
    return badRequest(error);
  }
}
