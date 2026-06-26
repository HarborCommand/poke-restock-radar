import { NextResponse } from "next/server";
import { customerAccountsEnabled, registerCustomerAccountWithPassword } from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  CustomerAuthRateLimitExceededError,
  customerAuthOriginErrorResponse,
  customerAuthRateLimitResponse,
  enforceCustomerAuthRateLimit
} from "@/lib/customer-auth-rate-limit";
import { badRequest, privateJson, readJson, withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await readJson(request);
    return {
      email: typeof json.email === "string" ? json.email : "",
      displayName: typeof json.displayName === "string" ? json.displayName : "",
      password: typeof json.password === "string" ? json.password : "",
      confirmPassword: typeof json.confirmPassword === "string" ? json.confirmPassword : "",
      redirect: false
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get("email") || ""),
    displayName: String(form.get("displayName") || ""),
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
    await enforceCustomerAuthRateLimit({
      request,
      action: "registration",
      email: input.email
    });
    await registerCustomerAccountWithPassword({
      email: input.email,
      displayName: input.displayName,
      password: input.password,
      confirmPassword: input.confirmPassword,
      requestUrl: request.url
    });
    if (input.redirect) {
      const url = new URL("/account/login", request.url);
      url.searchParams.set("mode", "signin");
      url.searchParams.set("accountStatus", "check_email");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    return privateJson({
      ok: true,
      status: "check_email"
    });
  } catch (error) {
    if (error instanceof CustomerAuthRateLimitExceededError) {
      if (!redirect) return customerAuthRateLimitResponse(error);
      const url = new URL("/account/login", request.url);
      url.searchParams.set("mode", "create");
      url.searchParams.set("registerError", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    if (redirect) {
      const url = new URL("/account/login", request.url);
      url.searchParams.set("mode", "create");
      url.searchParams.set("registerError", "invalid");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    return withPrivateNoStore(badRequest(error));
  }
}
