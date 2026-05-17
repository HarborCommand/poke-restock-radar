import { NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { acceptFriendInvite } from "@/lib/access";
import { badRequest, readJson } from "@/lib/http";
import { friendInviteAcceptSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = friendInviteAcceptSchema.parse(await readJson(request));
    const user = await acceptFriendInvite(input);
    const response = NextResponse.json({ user });
    setSessionCookie(response, createSessionToken(user));
    return response;
  } catch (error) {
    return badRequest(error);
  }
}
