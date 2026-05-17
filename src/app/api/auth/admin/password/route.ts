import { NextResponse } from "next/server";
import { createSessionToken, requireAdmin, requireUser, setSessionCookie } from "@/lib/auth";
import { badRequest, readJson } from "@/lib/http";
import { resetAdminPassword } from "@/lib/password-reset";
import { adminPasswordResetSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = adminPasswordResetSchema.parse(await readJson(request));
    const sessionUser = await resetAdminPassword(user, input.currentPassword, input.password);
    const nextResponse = NextResponse.json({ ok: true, user: sessionUser });
    setSessionCookie(nextResponse, createSessionToken(sessionUser));
    return nextResponse;
  } catch (error) {
    return badRequest(error);
  }
}
