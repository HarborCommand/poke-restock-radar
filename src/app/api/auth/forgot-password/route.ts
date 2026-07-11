import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { requestPasswordReset } from "@/lib/password-reset";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const input = forgotPasswordSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_forgot_password",
      identifiers: [{ scope: "email", value: input.email }]
    });
    await requestPasswordReset(input.email);
    return privateJson({
      ok: true,
      message: "If that private account exists, a reset link will be sent when email is configured.",
      expiresInMinutes: 30
    });
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    return withPrivateNoStore(badRequest(error));
  }
}
