import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { importReleases } from "@/lib/radar-service";
import { bulkImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = bulkImportSchema.parse(await readJson(request));
    return ok(await importReleases(input.format, input.data));
  } catch (error) {
    return badRequest(error);
  }
}
