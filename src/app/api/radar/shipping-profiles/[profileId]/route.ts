import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { updateShippingProfile } from "@/lib/shipping-profiles";
import { shippingProfileUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;
  try {
    const { profileId } = await params;
    const input = shippingProfileUpdateSchema.parse(await readJson(request));
    const profile = await updateShippingProfile(user, profileId, input);
    await logAudit({
      user,
      action: "shipping.profile.updated",
      entityType: "SHIPPING_PROFILE",
      entityId: profile.id,
      summary: `${user.email} updated shipping profile ${profile.name}.`
    });
    return ok({ profile });
  } catch (error) {
    return badRequest(error);
  }
}
