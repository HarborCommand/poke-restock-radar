import { NextResponse } from "next/server";
import { customerAccountsEnabled, registerCustomerAccountWithPassword } from "@/lib/customer-account-auth";
import { badRequest, readJson } from "@/lib/http";

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
  try {
    if (!customerAccountsEnabled()) {
      return NextResponse.json({ error: "Customer accounts are not enabled yet." }, { status: 404 });
    }
    const input = await requestInput(request);
    const result = await registerCustomerAccountWithPassword({
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
      url.searchParams.set("emailStatus", result.status);
      return NextResponse.redirect(url, { status: 303 });
    }
    return NextResponse.json({
      ok: true,
      status: "check_email",
      emailStatus: result.status,
      provider: result.provider,
      expiresAt: result.expiresAt?.toISOString() ?? null
    });
  } catch (error) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const url = new URL("/account/login", request.url);
      url.searchParams.set("mode", "create");
      url.searchParams.set("registerError", "invalid");
      return NextResponse.redirect(url, { status: 303 });
    }
    return badRequest(error);
  }
}
