import {
  clearCustomerSessionCookie,
  currentCustomerAccountSessionStatus,
  customerAccountsEnabled,
  customerSessionCookieName
} from "@/lib/customer-account-auth";
import { privateOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await currentCustomerAccountSessionStatus({ touchActivity: false });
  const account = status.account;
  const response = privateOk({
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
    },
    timeout: status.timeout
  });
  if (status.shouldClearCookie) clearCustomerSessionCookie(response);
  return response;
}
