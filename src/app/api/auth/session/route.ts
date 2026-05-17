import { authRuntimeConfig, currentUser } from "@/lib/auth";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  const auth = authRuntimeConfig();
  return ok({
    user,
    session: {
      authenticated: Boolean(user),
      cookieName: auth.sessionCookieName,
      secureCookie: auth.secureCookie,
      sameSite: auth.sameSite,
      sessionDays: auth.sessionDays
    }
  });
}
