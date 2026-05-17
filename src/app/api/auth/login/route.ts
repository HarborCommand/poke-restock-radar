import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, readJson } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role
    };
    const response = NextResponse.json({ user: sessionUser });
    setSessionCookie(response, createSessionToken(sessionUser));
    return response;
  } catch (error) {
    return badRequest(error);
  }
}
