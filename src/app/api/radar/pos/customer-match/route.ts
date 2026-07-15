import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { resolvePosCustomerMatch } from "@/lib/pos-customer";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { posCustomerMatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));

  try {
    const input = posCustomerMatchSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_customer_lookup",
      identifiers: [{ scope: "email", value: input.customerEmail }]
    });
    const match = await resolvePosCustomerMatch(input, user.id);
    return withRequestId(privateOk({ match }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "Customer matching could not be completed.");
  }
}
