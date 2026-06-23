import { NextResponse } from "next/server";
import { clearCustomerSessionCookie, setCustomerSessionCookie, verifyCustomerMagicLink } from "@/lib/customer-account-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await verifyCustomerMagicLink(url.searchParams.get("token"));
  if (!result.ok || !result.account) {
    const redirect = new URL("/account/login", request.url);
    redirect.searchParams.set("error", result.reason);
    const response = NextResponse.redirect(redirect, { status: 303 });
    clearCustomerSessionCookie(response);
    return response;
  }

  const redirect = new URL("/account", request.url);
  redirect.searchParams.set("signedIn", "1");
  const response = NextResponse.redirect(redirect, { status: 303 });
  setCustomerSessionCookie(response, result.account);
  return response;
}
