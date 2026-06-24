import { NextResponse } from "next/server";
import {
  clearCustomerSessionCookie,
  customerAccountsEnabled,
  resetCustomerPassword,
  setCustomerSessionCookie
} from "@/lib/customer-account-auth";
import { badRequest, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await readJson(request);
    return {
      token: typeof json.token === "string" ? json.token : "",
      password: typeof json.password === "string" ? json.password : "",
      confirmPassword: typeof json.confirmPassword === "string" ? json.confirmPassword : "",
      redirect: false
    };
  }
  const form = await request.formData();
  return {
    token: String(form.get("token") || ""),
    password: String(form.get("password") || ""),
    confirmPassword: String(form.get("confirmPassword") || ""),
    redirect: true
  };
}

export async function POST(request: Request) {
  let attemptedToken = "";
  try {
    if (!customerAccountsEnabled()) {
      return NextResponse.json({ error: "Customer accounts are not enabled yet." }, { status: 404 });
    }

    const input = await requestInput(request);
    attemptedToken = input.token;
    const result = await resetCustomerPassword({
      token: input.token,
      password: input.password,
      confirmPassword: input.confirmPassword
    });

    if (result.ok && result.account) {
      if (input.redirect) {
        const url = new URL("/account", request.url);
        url.searchParams.set("accountStatus", "password_reset");
        const response = NextResponse.redirect(url, { status: 303 });
        setCustomerSessionCookie(response, result.account);
        return response;
      }
      const response = NextResponse.json({ ok: true });
      setCustomerSessionCookie(response, result.account);
      return response;
    }

    if (input.redirect) {
      const url = new URL("/account/reset-password", request.url);
      const safeReason = result.reason === "expired" ? "expired" : "invalid";
      url.searchParams.set("resetError", safeReason);
      const response = NextResponse.redirect(url, { status: 303 });
      clearCustomerSessionCookie(response);
      return response;
    }

    const response = NextResponse.json({ error: "This password reset link is invalid, expired, or already used." }, { status: 400 });
    clearCustomerSessionCookie(response);
    return response;
  } catch (error) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const url = new URL("/account/reset-password", request.url);
      url.searchParams.set("resetError", "password");
      if (attemptedToken) url.searchParams.set("token", attemptedToken);
      const response = NextResponse.redirect(url, { status: 303 });
      clearCustomerSessionCookie(response);
      return response;
    }
    return badRequest(error);
  }
}
