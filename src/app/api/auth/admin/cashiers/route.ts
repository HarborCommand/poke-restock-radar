import bcrypt from "bcryptjs";
import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cashierUser(user: {
  id: string;
  email: string;
  name: string;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    disabled: Boolean(user.disabledAt),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString()
  };
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  const users = await prisma.user.findMany({
    where: { role: "CASHIER" },
    select: {
      id: true,
      email: true,
      name: true,
      disabledAt: true,
      lastLoginAt: true,
      createdAt: true
    },
    orderBy: [{ disabledAt: "asc" }, { createdAt: "desc" }]
  });

  return ok({ cashiers: users.map(cashierUser) });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;

  try {
    const payload = await readJson(request);
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (name.length < 2 || name.length > 80) throw new Error("Cashier name must be between 2 and 80 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid cashier email address.");
    if (password.length < 12) throw new Error("Cashier password must be at least 12 characters.");
    if (password.length > 200) throw new Error("Cashier password is too long.");

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email } },
      select: { id: true }
    });
    if (existing) throw new Error("An account with that email already exists.");

    const passwordHash = await bcrypt.hash(password, 12);
    const cashier = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "CASHIER",
        canAddSightings: false,
        canAddComps: false,
        canRunChecks: false,
        canReceivePushAlerts: false
      },
      select: {
        id: true,
        email: true,
        name: true,
        disabledAt: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    await logAudit({
      user,
      action: "auth.cashier.created",
      entityType: "USER",
      entityId: cashier.id,
      summary: `${user.email} created cashier account ${cashier.email}.`,
      metadata: { cashierEmail: cashier.email, role: "CASHIER" }
    });

    return ok({ cashier: cashierUser(cashier) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
