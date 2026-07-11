import { NextResponse } from "next/server";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { privateNoStoreHeaders } from "@/lib/http";
import type { SessionUser } from "@/types/radar";

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403, headers: privateNoStoreHeaders });
}

export function authorizeAdminMutation(request: Request, user: SessionUser) {
  if (user.role !== "ADMIN") return forbidden("Admin access required");
  try {
    assertSameOriginRequest(request);
  } catch (error) {
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    throw error;
  }
  return null;
}
