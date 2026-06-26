import { NextResponse } from "next/server";
import {
  clearCustomerSessionCookie,
  currentCustomerAccount,
  customerAccountsEnabled,
  customerSecurityCenterEnabled,
  revokeCustomerAccountSecuritySession,
  signOutAllCustomerSecuritySessions,
  signOutOtherCustomerSecuritySessions
} from "@/lib/customer-account-auth";
import { hasClientSuppliedCustomerOwnership } from "@/lib/customer-account-security";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { privateJson, readJson, withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SecurityActionInput = {
  redirect: boolean;
  action: string;
  sessionRef: string;
  raw: Record<string, unknown>;
};

function redirectToSecurity(request: Request, status: string) {
  const url = new URL("/account/security", request.url);
  url.searchParams.set("securityStatus", status);
  return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
}

function redirectToLogin(request: Request) {
  const url = new URL("/account/login", request.url);
  url.searchParams.set("signedOut", "1");
  return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
}

async function actionInput(request: Request): Promise<SecurityActionInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await readJson(request);
    return {
      redirect: false,
      action: typeof json.action === "string" ? json.action : "",
      sessionRef: typeof json.sessionRef === "string" ? json.sessionRef : "",
      raw: json && typeof json === "object" ? json as Record<string, unknown> : {}
    };
  }

  const form = await request.formData();
  const raw = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  return {
    redirect: true,
    action: String(form.get("action") || ""),
    sessionRef: String(form.get("sessionRef") || ""),
    raw
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const redirect = !contentType.includes("application/json");
  try {
    assertCustomerSameOriginRequest(request);
    const input = await actionInput(request);
    if (hasClientSuppliedCustomerOwnership(input.raw)) {
      return input.redirect ? redirectToSecurity(request, "error") : privateJson({ error: "Not found." }, 404);
    }
    if (!customerAccountsEnabled() || !customerSecurityCenterEnabled()) {
      return input.redirect
        ? redirectToSecurity(request, "disabled")
        : privateJson({ error: "Account security is not enabled yet." }, 404);
    }

    const account = await currentCustomerAccount();
    if (!account) {
      return input.redirect
        ? redirectToLogin(request)
        : privateJson({ error: "Sign in required." }, 401);
    }

    if (input.action === "sign_out_others") {
      const result = await signOutOtherCustomerSecuritySessions(account);
      return input.redirect
        ? redirectToSecurity(request, result.count > 0 ? "signed_out_others" : "no_other_devices")
        : privateJson({ ok: true, status: "signed_out_others", count: result.count });
    }

    if (input.action === "sign_out_all") {
      await signOutAllCustomerSecuritySessions(account);
      const response = input.redirect
        ? redirectToLogin(request)
        : privateJson({ ok: true, status: "signed_out_all" });
      clearCustomerSessionCookie(response);
      return response;
    }

    if (input.action === "revoke") {
      const result = await revokeCustomerAccountSecuritySession(account, input.sessionRef);
      if (result.status !== "revoked") {
        return input.redirect ? redirectToSecurity(request, "not_found") : privateJson({ error: "Not found." }, 404);
      }
      if (result.revokedCurrent) {
        const response = input.redirect
          ? redirectToLogin(request)
          : privateJson({ ok: true, status: "current_revoked" });
        clearCustomerSessionCookie(response);
        return response;
      }
      return input.redirect
        ? redirectToSecurity(request, "session_revoked")
        : privateJson({ ok: true, status: "session_revoked" });
    }

    return input.redirect ? redirectToSecurity(request, "error") : privateJson({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) {
      return redirect ? redirectToSecurity(request, "error") : customerAuthOriginErrorResponse();
    }
    throw error;
  }
}
