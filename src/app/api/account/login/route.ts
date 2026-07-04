import { NextResponse } from "next/server";
import {
  authenticateCustomerPassword,
  clearCustomerSessionCookie,
  customerAccountsEnabled,
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
import { privateJson, readJson, withPrivateNoStore } from "@/lib/http";
import { checkPublicRateLimit, PublicRateLimitExceededError, publicRateLimitResponse } from "@/lib/rate-limit";

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
  const redirect = !(request.headers.get("content-type") || "").includes("application/json");
  try {
    assertCustomerSameOriginRequest(request);
    if (!customerAccountsEnabled()) {
      return privateJson({ error: "Customer accounts are not enabled yet." }, 404);
    }

    const input = await requestInput(request);
    await checkPublicRateLimit({
      request,
      action: "customer_login",
      identifiers: [{ scope: "email", value: input.email }]
    });
    await enforceCustomerAuthRateLimit({
      request,
      action: "password_login",
      email: input.email
    });
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
        await setCustomerSessionCookie(response, result.account, request);
        return withPrivateNoStore(response);
      }
      const response = privateJson({ ok: true });
      await setCustomerSessionCookie(response, result.account, request);
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
      return withPrivateNoStore(response);
    }

    const response = privateJson(
      { error: result.reason === "unverified" ? "Verify your email before signing in." : "Email or password is incorrect." },
      401
    );
    clearCustomerSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) {
      if (!redirect) return publicRateLimitResponse(error);
      const url = new URL("/account/login", request.url);
      url.searchParams.set("loginError", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthRateLimitExceededError) {
      if (!redirect) return customerAuthRateLimitResponse(error);
      const url = new URL("/account/login", request.url);
      url.searchParams.set("loginError", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    throw error;
  }
}
