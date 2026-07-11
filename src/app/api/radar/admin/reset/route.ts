import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { badRequest, ok } from "@/lib/http";
import { resetDemoData } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return adminResponse;

  try {
    return ok(await resetDemoData());
  } catch (error) {
    return badRequest(error);
  }
}
