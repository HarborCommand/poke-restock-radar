import { NextResponse } from "next/server";
import { badRequest, ok } from "@/lib/http";
import { syncReleaseCalendarFromPublicSources } from "@/lib/release-sync";

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

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }

  try {
    return ok(await syncReleaseCalendarFromPublicSources());
  } catch (error) {
    return badRequest(error);
  }
}
