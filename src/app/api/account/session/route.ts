import { currentCustomerAccount, customerAccountsEnabled, customerSessionCookieName } from "@/lib/customer-account-auth";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await currentCustomerAccount();
  return ok({
    enabled: customerAccountsEnabled(),
    account: account
      ? {
          email: account.email,
          displayName: account.displayName,
          emailVerified: Boolean(account.emailVerifiedAt)
        }
      : null,
    session: {
      authenticated: Boolean(account),
      cookieName: customerSessionCookieName(),
      sameSite: "lax"
    }
  });
}
