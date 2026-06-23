import { NextResponse } from "next/server";
import { clearCustomerSessionCookie } from "@/lib/customer-account-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL("/account/login", request.url);
  url.searchParams.set("signedOut", "1");
  const response = NextResponse.redirect(url, { status: 303 });
  clearCustomerSessionCookie(response);
  return response;
}
