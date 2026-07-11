import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { revokeFriendInvite } from "@/lib/access";
import { badRequest, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    const { inviteId } = await params;
    return ok({ invite: await revokeFriendInvite(user, inviteId) });
  } catch (error) {
    return badRequest(error);
  }
}
