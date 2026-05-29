import { NextResponse } from "next/server";
import { badRequest, ok, readJson } from "@/lib/http";
import { runProductMonitorBatch } from "@/lib/monitor";
import { monitorRunSchema } from "@/lib/validation";

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

function productMonitorCronEnabled() {
  return process.env.PRODUCT_MONITOR_CRON_ENABLED === "true";
}

function pausedResponse() {
  return ok({
    status: "PAUSED",
    runType: "DUE_JOB",
    checked: 0,
    alertsCreated: 0,
    reason: "Product monitor cron is paused while Products, Stores, and Cards UI modules are hidden. Set PRODUCT_MONITOR_CRON_ENABLED=true to re-enable scheduled product scans."
  });
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }
  if (!productMonitorCronEnabled()) return pausedResponse();

  try {
    return ok(await runProductMonitorBatch("due", "DUE_JOB"));
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }
  if (!productMonitorCronEnabled()) return pausedResponse();

  try {
    const input = monitorRunSchema.parse(await readJson(request));
    return ok(await runProductMonitorBatch(input.mode, "DUE_JOB"));
  } catch (error) {
    return badRequest(error);
  }
}
