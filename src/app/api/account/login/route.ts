import { NextResponse } from "next/server";
import {
  authenticateCustomerPassword,
  clearCustomerSessionCookie,
  customerAccountsEnabled,
  setCustomerSessionCookie
} from "@/lib/customer-account-auth";
import { readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await readJson(request);
    return {
      email: typeof json.email === "string" ? json.email : "",
      password: typeof json.password === "string" ? json.password : "",
      redirect: false
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get("email") || ""),
    password: String(form.get("password") || ""),
    redirect: true
  };
}

export async function POST(request: Request) {
  if (!customerAccountsEnabled()) {
    return NextResponse.json({ error: "Customer accounts are not enabled yet." }, { status: 404 });
  }

  const input = await requestInput(request);
  const result = await authenticateCustomerPassword({
    email: input.email,
    password: input.password,
    requestUrl: request.url
  });

  if (result.ok) {
    if (input.redirect) {
      const url = new URL("/account", request.url);
      url.searchParams.set("signedIn", "1");
      const response = NextResponse.redirect(url, { status: 303 });
      setCustomerSessionCookie(response, result.account);
      return response;
    }
    const response = NextResponse.json({ ok: true });
    setCustomerSessionCookie(response, result.account);
    return response;
  }

  if (input.redirect) {
    const url = new URL("/account/login", request.url);
    if (result.reason === "unverified") {
      url.searchParams.set("accountStatus", "verify_email");
    } else {
      url.searchParams.set("loginError", "invalid");
    }
    const response = NextResponse.redirect(url, { status: 303 });
    clearCustomerSessionCookie(response);
    return response;
  }

  const response = NextResponse.json(
    { error: result.reason === "unverified" ? "Verify your email before signing in." : "Email or password is incorrect." },
    { status: 401 }
  );
  clearCustomerSessionCookie(response);
  return response;
}
