import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { resolvePosCustomerMatch } from "@/lib/pos-customer";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { posCustomerMatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = posCustomerMatchSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_customer_lookup",
      identifiers: [{ scope: "email", value: input.customerEmail }]
    });
    const match = await resolvePosCustomerMatch(input);
    return ok({ match });
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return badRequest(error);
  }
}
