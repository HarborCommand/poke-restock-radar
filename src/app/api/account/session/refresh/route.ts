import {
  clearCustomerSessionCookie,
  currentCustomerAccountSessionStatus,
  customerAccountsEnabled,
  customerSessionCookieName
} from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { privateJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertCustomerSameOriginRequest(request);
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    throw error;
  }
  if (!customerAccountsEnabled()) {
    return privateJson({ error: "Customer accounts are not enabled yet." }, 404);
  }

  const status = await currentCustomerAccountSessionStatus({ touchActivity: true });
  if (!status.account) {
    const response = privateJson(
      {
        ok: false,
        status: status.timeout.expiredReason ? "expired" : "signed_out",
        timeout: status.timeout
      },
      401
    );
    if (status.shouldClearCookie) clearCustomerSessionCookie(response);
    return response;
  }

  return privateJson({
    ok: true,
    status: "active",
    account: {
      email: status.account.email,
      displayName: status.account.displayName,
      emailVerified: Boolean(status.account.emailVerifiedAt)
    },
    session: {
      authenticated: true,
      cookieName: customerSessionCookieName(),
      sameSite: "lax"
    },
    timeout: status.timeout
  });
}
