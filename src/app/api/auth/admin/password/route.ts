import { NextResponse } from "next/server";
import { clearSessionCookie, requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
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
    await resetAdminPassword(user, input.currentPassword, input.password);
    await logAudit({
      user,
      action: "auth.admin.password_changed",
      entityType: "USER",
      entityId: user.id,
      summary: `${user.email} changed the admin login password.`
    });
    const nextResponse = NextResponse.json({ ok: true, reauthRequired: true });
    clearSessionCookie(nextResponse);
    return nextResponse;
  } catch (error) {
    return badRequest(error);
  }
}
