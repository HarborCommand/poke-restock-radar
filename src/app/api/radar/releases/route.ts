import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createRelease, listDashboard } from "@/lib/radar-service";
import { releaseCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ releases: dashboard.releases });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = releaseCreateSchema.parse(await readJson(request));
    return ok({ release: await createRelease(input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
