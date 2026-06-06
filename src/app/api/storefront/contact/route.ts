import { badRequest, ok, readJson } from "@/lib/http";
import { createContactMessage } from "@/lib/storefront";
import { storefrontContactMessageSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontContactMessageSchema.parse(await readJson(request));
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
    return badRequest(error);
  }
}
