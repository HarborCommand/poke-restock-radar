import { NextResponse } from "next/server";
import { customerAccountsEnabled, requestCustomerPasswordReset } from "@/lib/customer-account-auth";
import { readJson } from "@/lib/http";

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
  if (!customerAccountsEnabled()) {
    return NextResponse.json({ error: "Customer accounts are not enabled yet." }, { status: 404 });
  }

  const input = await requestInput(request);
  await requestCustomerPasswordReset({
    email: input.email,
    requestUrl: request.url
  });

  if (input.redirect) {
    const url = new URL("/account/forgot-password", request.url);
    url.searchParams.set("resetStatus", "sent");
    return NextResponse.redirect(url, { status: 303 });
  }

  return NextResponse.json({ ok: true, status: "sent_if_eligible" });
}
