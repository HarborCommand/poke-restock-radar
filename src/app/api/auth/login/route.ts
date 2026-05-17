import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { authRuntimeConfig, createSessionToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, readJson } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await readJson(request));
    const authConfig = authRuntimeConfig();
    if (!authConfig.authReady) {
      return NextResponse.json(
        { error: "Authentication is not configured correctly. Ask the admin to verify AUTH_SECRET in production." },
        { status: 503 }
      );
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const matchingUsers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE lower("email") = ${normalizedEmail} LIMIT 1
    `;
    const user = matchingUsers[0]?.id
      ? await prisma.user.findUnique({ where: { id: matchingUsers[0].id } })
      : null;

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Email or password did not match a private account. Check the credentials or use password reset." },
        { status: 401 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: { id: true, email: true, name: true, role: true, sessionVersion: true }
    });
    const sessionUser = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role as Role,
      sessionVersion: updatedUser.sessionVersion
    };
    const response = NextResponse.json({ user: sessionUser });
    setSessionCookie(response, createSessionToken(sessionUser));
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("AUTH_SECRET")) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return badRequest(error);
  }
}
