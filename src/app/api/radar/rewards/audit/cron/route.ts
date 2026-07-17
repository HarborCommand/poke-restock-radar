import { NextResponse } from "next/server";
import { privateNoStoreHeaders, withRequestId } from "@/lib/http";
import { requestCorrelationId, runWithRequestContext } from "@/lib/observability";
import { runRewardReconciliation } from "@/lib/reward-auditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(request: Request) {
  const secrets = [process.env.MONITOR_JOB_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  if (!secrets.length) return false;

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const monitorHeader = request.headers.get("x-monitor-secret");
  return secrets.some((secret) => monitorHeader === secret || bearer === secret);
}

async function reconcile(request: Request) {
  const requestId = requestCorrelationId(request);
  if (!cronAuthorized(request)) {
    return withRequestId(
      NextResponse.json({ error: "Reward audit job secret required" }, { status: 401, headers: privateNoStoreHeaders }),
      requestId
    );
  }
  const url = new URL(request.url);
  const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
  const maxPages = Number(url.searchParams.get("maxPages") ?? "5");
  const result = await runWithRequestContext(requestId, () => runRewardReconciliation({ pageSize, maxPages }));
  return withRequestId(NextResponse.json(result, { headers: privateNoStoreHeaders }), requestId);
}

export async function GET(request: Request) {
  return reconcile(request);
}

export async function POST(request: Request) {
  return reconcile(request);
}
