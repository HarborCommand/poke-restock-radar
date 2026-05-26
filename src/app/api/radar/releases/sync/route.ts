import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { syncReleaseCalendarFromPublicSources } from "@/lib/release-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    return ok(await syncReleaseCalendarFromPublicSources());
  } catch (error) {
    return badRequest(error);
  }
}
