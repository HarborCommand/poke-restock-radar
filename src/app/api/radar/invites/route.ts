import { requireAdmin, requireUser } from "@/lib/auth";
import { createFriendInvite } from "@/lib/access";
import { badRequest, ok, readJson } from "@/lib/http";
import { friendInviteCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = friendInviteCreateSchema.parse(await readJson(request));
    return ok({ invite: await createFriendInvite(user, input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
