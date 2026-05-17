import { NextResponse } from "next/server";
import { badRequest, readJson } from "@/lib/http";
import { requestPasswordReset } from "@/lib/password-reset";
import { forgotPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = forgotPasswordSchema.parse(await readJson(request));
    const result = await requestPasswordReset(input.email);
    return NextResponse.json({
      ok: true,
      message: "If that private account exists, a reset link will be sent when email is configured.",
      emailConfigured: result.emailSent,
      expiresInMinutes: result.expiresInMinutes
    });
  } catch (error) {
    return badRequest(error);
  }
}
