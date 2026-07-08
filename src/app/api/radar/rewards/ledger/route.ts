import { requireAdmin, requireUser } from "@/lib/auth";
import { privateOk } from "@/lib/http";
import { listAdminRewardLedger } from "@/lib/rewards-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberParam(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  const url = new URL(request.url);
  const result = await listAdminRewardLedger({
    search: url.searchParams.get("search"),
    status: url.searchParams.get("status"),
    source: url.searchParams.get("source"),
    page: numberParam(url.searchParams.get("page")),
    pageSize: numberParam(url.searchParams.get("pageSize"))
  });
  return privateOk(result);
}
