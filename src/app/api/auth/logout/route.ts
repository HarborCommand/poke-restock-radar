import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (error) {
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    throw error;
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return withPrivateNoStore(response);
}
