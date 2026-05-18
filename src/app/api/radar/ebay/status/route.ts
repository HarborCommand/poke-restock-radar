import { requireAdmin, requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { getEbayApiStatus } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  return ok({ status: getEbayApiStatus() });
}
