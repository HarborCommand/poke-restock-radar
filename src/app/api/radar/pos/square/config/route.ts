import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { privateOk, withPrivateNoStore } from "@/lib/http";
import { hasPosRole } from "@/lib/pos-authorization";
import { getSquarePosPublicConfig } from "@/lib/square-pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(response);
  if (!hasPosRole(user)) {
    return withPrivateNoStore(NextResponse.json({ error: "POS access required" }, { status: 403 }));
  }

  return privateOk({ square: getSquarePosPublicConfig() });
}
