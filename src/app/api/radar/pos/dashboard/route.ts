import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) return NextResponse.json({ error: "POS access required" }, { status: 403 });

  const storeUser = await resolvePosStoreUser(user);
  const scopedUser = String(user.role) === "CASHIER" ? { ...storeUser, role: user.role } : storeUser;
  const dashboard = await listDashboard(scopedUser);
  return ok({ ...dashboard, currentUser: user });
}
