import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createCardCompSale } from "@/lib/radar-service";
import { cardCompCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = cardCompCreateSchema.parse(await readJson(request));
    return ok(await createCardCompSale(user, input), 201);
  } catch (error) {
    return badRequest(error);
  }
}
