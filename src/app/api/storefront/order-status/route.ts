import { badRequest, ok, readJson } from "@/lib/http";
import { lookupPublicOrderStatus } from "@/lib/storefront";
import { publicOrderStatusLookupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = publicOrderStatusLookupSchema.parse(await readJson(request));
    const result = await lookupPublicOrderStatus(input);
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
