import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { resolvePosCustomerMatch } from "@/lib/pos-customer";
import { posCustomerMatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = posCustomerMatchSchema.parse(await readJson(request));
    const match = await resolvePosCustomerMatch(input);
    return ok({ match });
  } catch (error) {
    return badRequest(error);
  }
}
