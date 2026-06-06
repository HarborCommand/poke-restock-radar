import { NextResponse } from "next/server";
import { badRequest, ok, readJson } from "@/lib/http";
import { runProductMonitorBatch } from "@/lib/monitor";
import {
  bestBuyDiscoveryEnabled,
  runAutomaticBestBuyDiscoveryPipeline,
  runAutomaticTargetDiscoveryPipeline,
  targetDiscoveryAutoEnabled
} from "@/lib/radar-service";
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

function targetMonitorCronEnabled() {
  return process.env.TARGET_MONITOR_CRON_ENABLED !== "false";
}

function pausedResponse() {
  return ok({
    status: "PAUSED",
    runType: "DUE_JOB",
    checked: 0,
    alertsCreated: 0,
    reason: "Monitor cron is paused. Target batching is disabled with TARGET_MONITOR_CRON_ENABLED=false, and legacy product scans require PRODUCT_MONITOR_CRON_ENABLED=true."
  });
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }
  if (!productMonitorCronEnabled() && !targetMonitorCronEnabled()) return pausedResponse();

  try {
    const discovery = targetDiscoveryAutoEnabled() ? await runAutomaticTargetDiscoveryPipeline(false) : null;
    const bestBuyDiscovery = bestBuyDiscoveryEnabled() ? await runAutomaticBestBuyDiscoveryPipeline(false) : null;
    const monitor = await runProductMonitorBatch(productMonitorCronEnabled() ? "due" : "target_due", "DUE_JOB");
    return ok({ ...monitor, automaticTargetDiscovery: discovery, automaticBestBuyDiscovery: bestBuyDiscovery });
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Monitor job secret required" }, { status: 401 });
  }
  if (!productMonitorCronEnabled() && !targetMonitorCronEnabled()) return pausedResponse();

  try {
    const input = monitorRunSchema.parse(await readJson(request));
    const mode = productMonitorCronEnabled()
      ? input.mode
      : input.mode === "target_priority"
        ? "target_priority"
        : "target_due";
    const discovery = targetDiscoveryAutoEnabled() ? await runAutomaticTargetDiscoveryPipeline(false) : null;
    const bestBuyDiscovery = bestBuyDiscoveryEnabled() ? await runAutomaticBestBuyDiscoveryPipeline(false) : null;
    const monitor = await runProductMonitorBatch(mode, "DUE_JOB");
    return ok({ ...monitor, automaticTargetDiscovery: discovery, automaticBestBuyDiscovery: bestBuyDiscovery });
  } catch (error) {
    return badRequest(error);
  }
}
