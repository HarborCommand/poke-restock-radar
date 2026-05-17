import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { createCard, listDashboard } from "@/lib/radar-service";
import { cardCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const dashboard = await listDashboard(user);
  return ok({ cards: dashboard.cards });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = cardCreateSchema.parse(await readJson(request));
    return ok({ card: await createCard(input) }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
