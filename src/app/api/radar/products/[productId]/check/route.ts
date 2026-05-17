import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { runProductMonitorCheck } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { productId } = await params;
    return ok(await runProductMonitorCheck(productId, "MANUAL_PRODUCT", true));
  } catch (error) {
    return badRequest(error);
  }
}
