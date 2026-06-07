import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";
import { getStorefrontSettings } from "@/lib/storefront";
import { storefrontSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringifyList(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => String(entry).trim()).filter(Boolean));
  if (typeof value === "string") {
    const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    return entries.length ? JSON.stringify(entries) : null;
  }
  return null;
}

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  return ok(await getStorefrontSettings());
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    if (user.role !== "ADMIN") throw new Error("Admin access required.");
    const input = storefrontSettingsSchema.parse(await readJson(request));
    const existing = await prisma.storefrontSettings.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true } });
    const data = {
      userId: user.id,
      storeName: input.storeName,
      storeLogoUrl: input.storeLogoUrl,
      sportsCardsExternalUrl: input.sportsCardsExternalUrl ?? null,
      contactEmail: input.contactEmail,
      returnPolicyText: input.returnPolicyText,
      shippingPolicyText: input.shippingPolicyText,
      localPickupInstructions: input.localPickupInstructions,
      announcementBanner: input.announcementBanner,
      defaultShippingPrice: input.defaultShippingPrice,
      freeShippingThreshold: input.freeShippingThreshold,
      socialLinks: stringifyList(input.socialLinks)
    };
    const settings = existing
      ? await prisma.storefrontSettings.update({ where: { id: existing.id }, data })
      : await prisma.storefrontSettings.create({ data });
    await logAudit({
      user,
      action: "storefront.settings.updated",
      entityType: "STORE_SETTINGS",
      entityId: settings.id,
      summary: `${user.email} updated storefront settings.`
    });
    return ok(await getStorefrontSettings());
  } catch (error) {
    return badRequest(error);
  }
}
