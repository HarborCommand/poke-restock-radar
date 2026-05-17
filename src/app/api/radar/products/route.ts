import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createProduct, listDashboard } from "@/lib/radar-service";
import { productCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ products: dashboard.products, retailers: dashboard.retailers });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = productCreateSchema.parse(await readJson(request));
    return ok({ product: await createProduct(input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
