import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createStore, listDashboard } from "@/lib/radar-service";
import { storeCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ stores: dashboard.stores, retailers: dashboard.retailers, sightings: dashboard.sightings });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = storeCreateSchema.parse(await readJson(request));
    return ok({ store: await createStore(input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
