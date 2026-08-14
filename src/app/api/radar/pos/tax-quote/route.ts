import { requireUser } from "@/lib/auth";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { quotePosSaleTax } from "@/lib/radar-service";
import { posTaxQuoteSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizePosMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));
  try {
    const input = posTaxQuoteSchema.parse(await readJson(request));
    const storeUser = await resolvePosStoreUser(user);
    return withRequestId(privateOk({ quote: await quotePosSaleTax(storeUser, input) }), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "POS tax could not be calculated.");
  }
}
