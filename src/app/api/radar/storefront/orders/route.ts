import { requireUser } from "@/lib/auth";
import { privateOk, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { listStorefrontOrders, storefrontSummary } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const [orders, summary] = await Promise.all([listStorefrontOrders(user), storefrontSummary(user)]);
  return withRequestId(privateOk({ orders, summary }), requestId);
}
