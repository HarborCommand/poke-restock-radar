import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse } from "@/lib/auth-origin";
import { acceptFriendInvite } from "@/lib/access";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";
import { friendInviteAcceptSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const input = friendInviteAcceptSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_invite_accept",
      identifiers: [
        { scope: "email", value: input.email },
        { scope: "token", value: input.token }
      ]
    });
    const user = await acceptFriendInvite(input);
    const response = privateJson({ user });
    setSessionCookie(response, createSessionToken(user));
    return response;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return publicRateLimitResponse(error);
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    return withPrivateNoStore(badRequest(error));
  }
}
