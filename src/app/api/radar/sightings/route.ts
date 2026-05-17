import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createSighting } from "@/lib/radar-service";
import { sightingCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = sightingCreateSchema.parse(await readJson(request));
    return ok({ sighting: await createSighting(user.id, input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
