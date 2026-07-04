import { requireAdmin, requireUser } from "@/lib/auth";
import { getAppHealth } from "@/lib/health";
import { privateOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  const health = await getAppHealth(user);
  return privateOk(health, health.status === "ERROR" ? 503 : 200);
}
