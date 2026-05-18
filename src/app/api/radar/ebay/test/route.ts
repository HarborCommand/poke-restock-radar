import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ok } from "@/lib/http";
import { testEbayApiConnection } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  const result = await testEbayApiConnection();
  await logAudit({
    user,
    action: "ebay.connection.test",
    entityType: "SETTING",
    summary: `${user.email} tested eBay API connection: ${result.ok ? "connected" : "not connected"}.`
  });
  return ok(result);
}
