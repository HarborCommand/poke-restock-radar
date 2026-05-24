import { NextResponse } from "next/server";
import { createSessionToken, requireAdmin, requireUser, setSessionCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { updateAdminLoginEmail } from "@/lib/password-reset";
import { adminEmailUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = adminEmailUpdateSchema.parse(await readJson(request));
    const sessionUser = await updateAdminLoginEmail(user, input.currentPassword, input.email);
    await logAudit({
      user: sessionUser,
      action: "auth.admin.email_changed",
      entityType: "USER",
      entityId: sessionUser.id,
      summary: `Admin login email changed from ${user.email} to ${sessionUser.email}.`
    });
    const nextResponse = NextResponse.json({ ok: true, user: sessionUser });
    setSessionCookie(nextResponse, createSessionToken(sessionUser));
    return nextResponse;
  } catch (error) {
    return badRequest(error);
  }
}
