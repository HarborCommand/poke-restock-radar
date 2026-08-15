import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AuthOriginError, assertSameOriginRequest, authOriginErrorResponse, safeAuthBaseUrl } from "@/lib/auth-origin";
import {
  customerAccountsEnabled,
  findCustomerAccountByNormalizedEmail,
  normalizeCustomerAccountEmail
} from "@/lib/customer-account-auth";
import {
  CustomerAuthRateLimitExceededError,
  customerAuthRateLimitResponse,
  enforceCustomerAuthRateLimit
} from "@/lib/customer-auth-rate-limit";
import { sendEmailViaProvider } from "@/lib/email-provider";
import { badRequest, privateJson, privateOk, readJson, withPrivateNoStore } from "@/lib/http";
import { hasPosRole } from "@/lib/pos-authorization";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function customerAccountInviteText(link: string) {
  return [
    "You're invited to create your GameDayGrabs customer account.",
    "",
    "Finish setting up your account here:",
    link,
    "",
    "Create your password on the GameDayGrabs website to keep your purchases and rewards connected to your account.",
    "",
    "Guest checkout is always available and this invitation does not subscribe you to marketing emails.",
    "",
    `Questions? Contact ${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}.`
  ].join("\n");
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) {
    return NextResponse.json({ error: "POS access required" }, { status: 403 });
  }

  try {
    assertSameOriginRequest(request);
    if (!customerAccountsEnabled()) {
      return privateJson({ error: "Customer accounts are not enabled yet." }, 404);
    }

    const body = await readJson(request);
    const email = normalizeCustomerAccountEmail(typeof body.email === "string" ? body.email : "");
    if (!email) return withPrivateNoStore(badRequest(new Error("Enter a valid email address.")));

    await enforceCustomerAuthRateLimit({
      request,
      action: "magic_link_request",
      email
    });

    const existingAccount = await findCustomerAccountByNormalizedEmail(email);
    if (existingAccount?.status === "active" && existingAccount.passwordHash) {
      return privateOk({ ok: true, status: "existing_account" });
    }

    const inviteUrl = new URL("/account/login", safeAuthBaseUrl(request.url, "store"));
    inviteUrl.searchParams.set("mode", "create");
    inviteUrl.searchParams.set("email", email);
    inviteUrl.searchParams.set("source", "pos-invite");

    const sendResult = await sendEmailViaProvider(
      {
        to: email,
        subject: "Create your GameDayGrabs account",
        text: customerAccountInviteText(inviteUrl.toString()),
        headers: {
          "X-Entity-Ref-ID": `customer-account-invite:${email}`,
          "X-GDD-Notification-Type": "customer_account_invite"
        },
        tags: [
          { name: "notificationType", value: "customer_account_invite" },
          { name: "environment", value: process.env.NODE_ENV || "development" }
        ]
      },
      {
        idempotencyKey: `customer-account-invite:${randomBytes(16).toString("hex")}`
      }
    );

    if (sendResult.status === "failed" || sendResult.status === "not_configured") {
      return privateJson({ error: "Could not send the account invitation." }, 503);
    }

    return privateOk({ ok: true, status: "invite_sent" });
  } catch (error) {
    if (error instanceof AuthOriginError) return authOriginErrorResponse();
    if (error instanceof CustomerAuthRateLimitExceededError) return customerAuthRateLimitResponse(error);
    return withPrivateNoStore(badRequest(error));
  }
}
