import { badRequest, ok, readJson } from "@/lib/http";
import { createCheckoutSession } from "@/lib/storefront";
import { storefrontCheckoutSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontCheckoutSchema.parse(await readJson(request));
    const result = await createCheckoutSession(input);
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
