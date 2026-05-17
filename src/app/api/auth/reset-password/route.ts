import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { badRequest, readJson } from "@/lib/http";
import { resetPasswordWithToken } from "@/lib/password-reset";
import { resetPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = resetPasswordSchema.parse(await readJson(request));
    await resetPasswordWithToken(input.token, input.password);
    const response = NextResponse.json({ ok: true, message: "Password reset. Sign in with the new password." });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return badRequest(error);
  }
}
