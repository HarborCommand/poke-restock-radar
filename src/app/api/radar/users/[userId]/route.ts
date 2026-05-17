import { requireAdmin, requireUser } from "@/lib/auth";
import { updateUserAccess } from "@/lib/access";
import { badRequest, ok, readJson } from "@/lib/http";
import { userAccessUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { userId } = await params;
    const input = userAccessUpdateSchema.parse(await readJson(request));
    return ok({ user: await updateUserAccess(user, userId, input) });
  } catch (error) {
    return badRequest(error);
  }
}
