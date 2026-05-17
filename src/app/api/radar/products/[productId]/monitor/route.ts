import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { controlProductMonitor } from "@/lib/radar-service";
import { productMonitorActionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { productId } = await params;
    const input = productMonitorActionSchema.parse(await readJson(request));
    return ok(await controlProductMonitor(productId, input));
  } catch (error) {
    return badRequest(error);
  }
}
