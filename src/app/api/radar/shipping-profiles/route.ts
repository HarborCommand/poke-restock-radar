import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { createShippingProfile, listShippingProfiles } from "@/lib/shipping-profiles";
import { shippingProfileCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;
  return ok(await listShippingProfiles(user));
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;
  try {
    const input = shippingProfileCreateSchema.parse(await readJson(request));
    const profile = await createShippingProfile(user, input);
    await logAudit({
      user,
      action: "shipping.profile.created",
      entityType: "SHIPPING_PROFILE",
      entityId: profile.id,
      summary: `${user.email} created shipping profile ${profile.name}.`
    });
    return ok({ profile }, 201);
  } catch (error) {
    return badRequest(error);
  }
}
