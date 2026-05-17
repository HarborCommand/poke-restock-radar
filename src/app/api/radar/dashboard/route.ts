import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  return ok(await listDashboard(user));
}
