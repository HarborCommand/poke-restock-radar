import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createProductDiscoverySource, listDashboard, runProductDiscoverySourceNow } from "@/lib/radar-service";
import { productDiscoverySourceCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;
  const dashboard = await listDashboard(user);
  return ok({
    scannerStatus: dashboard.scannerStatus,
    sources: dashboard.productDiscoverySources,
    candidates: dashboard.productDiscoveryCandidates
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const body = await readJson(request);
    const input = productDiscoverySourceCreateSchema.parse(body);
    const source = await createProductDiscoverySource(input);
    const runNow = Boolean((body as { runNow?: unknown }).runNow);
    const result = runNow ? await runProductDiscoverySourceNow(source.id) : null;
    await logAudit({
      user,
      action: "product.discovery.source.create",
      entityType: "PRODUCT_DISCOVERY_SOURCE",
      entityId: source.id,
      summary: `${user.email} added ${source.retailerName} discovery source ${source.name}.`
    });
    return ok({ source, result }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
