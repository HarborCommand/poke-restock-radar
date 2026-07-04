import { NextResponse } from "next/server";
import { customerAccountsEnabled, requestCustomerPasswordReset } from "@/lib/customer-account-auth";
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
      redirect: false
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get("email") || ""),
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
      action: "customer_forgot_password",
      identifiers: [{ scope: "email", value: input.email }]
    });
    await enforceCustomerAuthRateLimit({
      request,
      action: "forgot_password_request",
      email: input.email
    });
    await requestCustomerPasswordReset({
      email: input.email,
      requestUrl: request.url
    });

    if (input.redirect) {
      const url = new URL("/account/forgot-password", request.url);
      url.searchParams.set("resetStatus", "sent");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }

    return privateJson({ ok: true, status: "sent_if_eligible" });
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) {
      if (!redirect) return publicRateLimitResponse(error);
      const url = new URL("/account/forgot-password", request.url);
      url.searchParams.set("resetStatus", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthRateLimitExceededError) {
      if (!redirect) return customerAuthRateLimitResponse(error);
      const url = new URL("/account/forgot-password", request.url);
      url.searchParams.set("resetStatus", "rate_limited");
      return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
    }
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    throw error;
  }
}
