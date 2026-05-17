import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { verifyProductLink } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { productId } = await params;
    const product = await verifyProductLink(productId);
    await logAudit({
      user,
      action: "product.verify",
      entityType: "PRODUCT",
      entityId: productId,
      summary: `${user.email} verified ${product.name} product link as ${product.verificationStatus}.`
    });
    return ok({ product });
  } catch (error) {
    return badRequest(error);
  }
}
