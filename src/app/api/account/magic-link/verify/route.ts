import { NextResponse } from "next/server";
import { clearCustomerSessionCookie, setCustomerSessionCookie, verifyCustomerMagicLink } from "@/lib/customer-account-auth";
import { CustomerAuthRateLimitExceededError, enforceCustomerAuthRateLimit } from "@/lib/customer-auth-rate-limit";
import { withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let result;
  try {
    await enforceCustomerAuthRateLimit({
      request,
      action: "magic_link_verify"
    });
    result = await verifyCustomerMagicLink(url.searchParams.get("token"));
  } catch (error) {
    if (!(error instanceof CustomerAuthRateLimitExceededError)) throw error;
    const redirect = new URL("/account/login", request.url);
    redirect.searchParams.set("error", "rate_limited");
    const response = NextResponse.redirect(redirect, { status: 303 });
    clearCustomerSessionCookie(response);
    return withPrivateNoStore(response);
  }
  if (!result.ok || !result.account) {
    const redirect = new URL("/account/login", request.url);
    redirect.searchParams.set("error", result.reason);
    const response = NextResponse.redirect(redirect, { status: 303 });
    clearCustomerSessionCookie(response);
    return withPrivateNoStore(response);
  }

  const redirect = new URL("/account", request.url);
  redirect.searchParams.set("signedIn", "1");
  const response = NextResponse.redirect(redirect, { status: 303 });
  await setCustomerSessionCookie(response, result.account, request);
  return withPrivateNoStore(response);
}
