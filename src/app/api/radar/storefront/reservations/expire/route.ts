import { NextResponse } from "next/server";
import { badRequest, ok } from "@/lib/http";
import { expireOpenStripeSessionsForExpiredReservations } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This is a thirty-minute safety-net job. Checkout already releases expired holds before
// validating inventory, and Stripe expiration webhooks handle normal session expiration.
// Keeping this cadence above Neon's idle timeout prevents the cron from holding compute awake all month.
// Production calls must include CRON_SECRET or MONITOR_JOB_SECRET as a bearer token or x-monitor-secret header.
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

async function expireReservations(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Reservation job secret required" }, { status: 401 });
  }

  try {
    const result = await expireOpenStripeSessionsForExpiredReservations();
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}

export async function GET(request: Request) {
  return expireReservations(request);
}

export async function POST(request: Request) {
  return expireReservations(request);
}
