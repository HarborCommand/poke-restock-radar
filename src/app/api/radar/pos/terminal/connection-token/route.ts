import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { createTerminalConnectionToken } from "@/lib/stripe-terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const token = await createTerminalConnectionToken();
    return ok(token);
  } catch (error) {
    return badRequest(error);
  }
}
