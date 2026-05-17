import { ok } from "@/lib/http";
import { getAppHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getAppHealth();
  return ok(health, health.status === "ERROR" ? 503 : 200);
}
