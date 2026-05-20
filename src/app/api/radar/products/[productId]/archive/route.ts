import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { archiveProduct } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { productId } = await params;
    return ok({ product: await archiveProduct(productId) });
  } catch (error) {
    return badRequest(error);
  }
}
