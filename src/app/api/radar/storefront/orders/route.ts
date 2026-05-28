import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listStorefrontOrders, storefrontSummary } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const [orders, summary] = await Promise.all([listStorefrontOrders(user), storefrontSummary(user)]);
  return ok({ orders, summary });
}
