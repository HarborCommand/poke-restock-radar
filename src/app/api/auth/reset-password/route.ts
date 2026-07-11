import { clearSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { resetPasswordWithToken } from "@/lib/password-reset";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const input = resetPasswordSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_reset_password",
      identifiers: [{ scope: "token", value: input.token }]
    });
    await resetPasswordWithToken(input.token, input.password);
    const response = privateJson({ ok: true, message: "Password reset. Sign in with the new password." });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    return withPrivateNoStore(badRequest(error));
  }
}
