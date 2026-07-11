import { createSessionToken, requireAdmin, requireUser, setSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { logAudit } from "@/lib/audit";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { updateAdminLoginEmail } from "@/lib/password-reset";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { adminEmailUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (error) {
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    throw error;
  }
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = adminEmailUpdateSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_reset_password",
      identifiers: [{ scope: "token", value: user.id }]
    });
    const sessionUser = await updateAdminLoginEmail(user, input.currentPassword, input.email);
    await logAudit({
      user: sessionUser,
      action: "auth.admin.email_changed",
      entityType: "USER",
      entityId: sessionUser.id,
      summary: `Admin login email changed from ${user.email} to ${sessionUser.email}.`
    });
    const nextResponse = privateJson({ ok: true, user: sessionUser });
    setSessionCookie(nextResponse, createSessionToken(sessionUser));
    return nextResponse;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    return withPrivateNoStore(badRequest(error));
  }
}
