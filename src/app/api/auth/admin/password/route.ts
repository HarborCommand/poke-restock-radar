import { clearSessionCookie, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { resetAdminPassword } from "@/lib/password-reset";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { adminPasswordResetSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const input = adminPasswordResetSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_reset_password",
      identifiers: [{ scope: "token", value: user.id }]
    });
    await resetAdminPassword(user, input.currentPassword, input.password);
    await logAudit({
      user,
      action: "auth.admin.password_changed",
      entityType: "USER",
      entityId: user.id,
      summary: "Admin login password changed."
    });
    const nextResponse = privateJson({ ok: true, reauthRequired: true });
    clearSessionCookie(nextResponse);
    return nextResponse;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return withPrivateNoStore(badRequest(error));
  }
}
