import { NextResponse } from "next/server";
import { clearCustomerSessionCookie, setCustomerSessionCookie, verifyCustomerMagicLink } from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  CustomerAuthRateLimitExceededError,
  customerAuthOriginErrorResponse,
  enforceCustomerAuthRateLimit
} from "@/lib/customer-auth-rate-limit";
import { withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function confirmationUrl(request: Request, token: string | null) {
  const redirect = new URL("/account/magic-link", request.url);
  if (token?.trim()) redirect.searchParams.set("token", token.trim());
  else redirect.searchParams.set("error", "missing");
  return redirect;
}

// Email providers and security products may prefetch links. GET therefore never
// consumes a one-time token; it only moves the browser to a confirmation page.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return withPrivateNoStore(NextResponse.redirect(confirmationUrl(request, token), { status: 303 }));
}

export async function POST(request: Request) {
  let result;
  try {
    assertCustomerSameOriginRequest(request);
    const form = await request.formData();
    const token = String(form.get("token") || "");
    await enforceCustomerAuthRateLimit({
      request,
      action: "magic_link_verify"
    });
    result = await verifyCustomerMagicLink(token);
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
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
