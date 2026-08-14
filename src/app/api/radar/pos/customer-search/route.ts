import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { privateOk } from "@/lib/http";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { listAdminCustomerRewards } from "@/lib/rewards-admin";

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
  if (!hasPosRole(user)) {
    return NextResponse.json({ error: "POS access required" }, { status: 403 });
  }

  const storeUser = await resolvePosStoreUser(user);
  const url = new URL(request.url);
  const result = await listAdminCustomerRewards(storeUser.id, {
    search: url.searchParams.get("search"),
    status: url.searchParams.get("status"),
    sort: url.searchParams.get("sort"),
    page: numberParam(url.searchParams.get("page")),
    pageSize: numberParam(url.searchParams.get("pageSize"))
  });
  return privateOk(result);
}
