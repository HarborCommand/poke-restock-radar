import { NextResponse } from "next/server";
import {
  clearCustomerSessionCookie,
  customerAccountsEnabled,
  resetCustomerPassword,
  setCustomerSessionCookie
} from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  CustomerAuthRateLimitExceededError,
  customerAuthOriginErrorResponse,
  customerAuthRateLimitResponse,
  enforceCustomerAuthRateLimit
} from "@/lib/customer-auth-rate-limit";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

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
  const contentType = request.headers.get("content-type") || "";
  const redirect = !contentType.includes("application/json");
  try {
    assertCustomerSameOriginRequest(request);
    if (!customerAccountsEnabled()) {
      return privateJson({ error: "Customer accounts are not enabled yet." }, 404);
    }

    const input = await requestInput(request);
    await checkPublicRateLimit({
      request,
      action: "customer_reset_password",
      identifiers: [{ scope: "token", value: input.token }]
    });
    await enforceCustomerAuthRateLimit({
      request,
      action: "password_reset_submit"
    });
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
        await setCustomerSessionCookie(response, result.account, request);
        return withPrivateNoStore(response);
      }
      const response = privateJson({ ok: true });
      await setCustomerSessionCookie(response, result.account, request);
      return response;
    }

    if (input.redirect) {
      const url = new URL("/account/reset-password", request.url);
      const safeReason = result.reason === "expired" ? "expired" : "invalid";
      url.searchParams.set("resetError", safeReason);
      const response = NextResponse.redirect(url, { status: 303 });
      clearCustomerSessionCookie(response);
      return withPrivateNoStore(response);
    }

    const response = privateJson({ error: "This password reset link is invalid, expired, or already used." }, 400);
    clearCustomerSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) {
      if (!redirect) return publicRateLimitResponse(error);
      const url = new URL("/account/reset-password", request.url);
      url.searchParams.set("resetError", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthRateLimitExceededError) {
      if (!redirect) return customerAuthRateLimitResponse(error);
      const url = new URL("/account/reset-password", request.url);
      url.searchParams.set("resetError", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    if (redirect) {
      const url = new URL("/account/reset-password", request.url);
      url.searchParams.set("resetError", "password");
      const response = NextResponse.redirect(url, { status: 303 });
      clearCustomerSessionCookie(response);
      return withPrivateNoStore(response);
    }
    return withPrivateNoStore(badRequest(error));
  }
}
