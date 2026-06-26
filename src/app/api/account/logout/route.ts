import { NextResponse } from "next/server";
import { clearCustomerSessionCookie, revokeCurrentCustomerSession } from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertCustomerSameOriginRequest(request);
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    throw error;
  }
  await revokeCurrentCustomerSession("logout");
  const url = new URL("/account/login", request.url);
  url.searchParams.set("signedOut", "1");
  const response = NextResponse.redirect(url, { status: 303 });
  clearCustomerSessionCookie(response);
  return withPrivateNoStore(response);
}
