import { badRequest, ok, readJson } from "@/lib/http";
import { createInvoiceRequest } from "@/lib/storefront";
import { storefrontInvoiceRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = storefrontInvoiceRequestSchema.parse(await readJson(request));
    const result = await createInvoiceRequest(input);
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
