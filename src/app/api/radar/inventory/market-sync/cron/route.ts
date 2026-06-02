import { NextResponse } from "next/server";
import { badRequest, ok } from "@/lib/http";
import { prisma } from "@/lib/db";
import { refreshAllInventoryMarketComps, syncTcgcsvMarketData } from "@/lib/radar-service";
import type { SessionUser } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(request: Request) {
  const secrets = [process.env.MONITOR_JOB_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  if (!secrets.length) return process.env.NODE_ENV !== "production";

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const monitorHeader = request.headers.get("x-monitor-secret");
  return secrets.some((secret) => monitorHeader === secret || bearer === secret);
}

async function ownerUser(): Promise<SessionUser> {
  const configuredEmail = process.env.ADMIN_EMAIL?.trim();
  const user = await prisma.user.findFirst({
    where: configuredEmail ? { email: configuredEmail } : { role: "ADMIN" },
    orderBy: { createdAt: "asc" }
  });
  if (!user) throw new Error("No admin user available for market sync.");
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
    canAddSightings: user.canAddSightings,
    canAddComps: user.canAddComps,
    canRunChecks: user.canRunChecks,
    canReceivePushAlerts: user.canReceivePushAlerts
  };
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }

  try {
    const user = await ownerUser();
    if (process.env.TCGCSV_ENABLED === "true") {
      return ok(await syncTcgcsvMarketData(user, { refreshLimit: 25 }));
    }
    return ok(await refreshAllInventoryMarketComps(user, { onlyStale: true, limit: 25 }));
  } catch (error) {
    return badRequest(error);
  }
}
