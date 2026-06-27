import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shippingProfiles, type ShippingProfileDefinition } from "@/lib/shipping";
import type { SessionUser, ShippingProfileDTO } from "@/types/radar";

type ShippingProfileRecord = Prisma.ShippingProfileGetPayload<object>;

export type ShippingProfileInput = {
  name: string;
  key?: string | null;
  packageType: string;
  defaultWeightOz: number;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  defaultShippingCharge?: number | null;
  localPickupEligibleDefault?: boolean;
  freeShippingEligibleDefault?: boolean;
  requiresBoxDefault?: boolean;
  insuranceRecommendedDefault?: boolean;
  active?: boolean;
};

const defaultProfilePackageTypes: Record<string, string> = {
  single_card_or_light_item: "Padded Envelope",
  sealed_pack_small: "Padded Mailer",
  small_box: "Small Box / Booster Bundle Box",
  medium_box: "Premium Collection Box",
  large_box: "Multi-Item Box",
  heavy_box: "Heavy Box",
  local_pickup: "Local Pickup"
};

function shippingProfileKeyFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function shippingProfileRank(defaultWeightOz: number) {
  if (defaultWeightOz <= 0) return 0;
  if (defaultWeightOz <= 8) return 1;
  if (defaultWeightOz <= 16) return 3;
  if (defaultWeightOz <= 32) return 4;
  if (defaultWeightOz <= 80) return 5;
  return 6;
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function defaultShippingProfileRows(userId: string | null) {
  return Object.entries(shippingProfiles).map(([key, profile]) => ({
    userId,
    name: profile.label,
    key,
    packageType: defaultProfilePackageTypes[key] ?? profile.label,
    defaultWeightOz: profile.defaultWeightOz,
    packageLengthIn: profile.packageLengthIn ?? null,
    packageWidthIn: profile.packageWidthIn ?? null,
    packageHeightIn: profile.packageHeightIn ?? null,
    defaultShippingCharge: null,
    localPickupEligibleDefault: key === "local_pickup",
    freeShippingEligibleDefault: false,
    requiresBoxDefault: profile.requiresBox,
    insuranceRecommendedDefault: profile.insuranceRecommended,
    active: true,
    systemDefault: true
  }));
}

export async function ensureDefaultShippingProfiles(currentUser?: Pick<SessionUser, "id"> | null) {
  const userId = currentUser?.id ?? null;
  for (const profile of defaultShippingProfileRows(userId)) {
    await prisma.shippingProfile.upsert({
      where: { key: profile.key },
      create: profile,
      update: {
        systemDefault: true,
        userId: profile.userId
      }
    });
  }
}

function shippingProfileToDefinition(profile: Pick<ShippingProfileRecord, "name" | "defaultWeightOz" | "packageLengthIn" | "packageWidthIn" | "packageHeightIn" | "requiresBoxDefault" | "insuranceRecommendedDefault" | "defaultShippingCharge" | "active">): ShippingProfileDefinition {
  return {
    label: profile.name,
    defaultWeightOz: profile.defaultWeightOz,
    rank: shippingProfileRank(profile.defaultWeightOz),
    requiresBox: profile.requiresBoxDefault,
    insuranceRecommended: profile.insuranceRecommendedDefault,
    packageLengthIn: profile.packageLengthIn,
    packageWidthIn: profile.packageWidthIn,
    packageHeightIn: profile.packageHeightIn,
    defaultShippingCharge: profile.defaultShippingCharge,
    active: profile.active
  };
}

export async function shippingProfileDefinitionsForCheckout() {
  const profiles = await prisma.shippingProfile.findMany({
    where: { active: true },
    orderBy: [{ systemDefault: "desc" }, { name: "asc" }]
  });
  return profiles.reduce<Record<string, ShippingProfileDefinition>>((definitions, profile) => {
    definitions[profile.key] = shippingProfileToDefinition(profile);
    return definitions;
  }, {});
}

async function shippingProfileUsageCounts(key: string) {
  const [productsUsingCount, activeProductsUsingCount, historicalOrdersUsingCount] = await Promise.all([
    prisma.inventoryItem.count({ where: { shippingProfile: key } }),
    prisma.inventoryItem.count({ where: { shippingProfile: key, publishToStore: true, storeStatus: { in: ["active", "sold_out"] } } }),
    prisma.storefrontOrder.count({ where: { shippingPackageProfile: key } })
  ]);
  return { productsUsingCount, activeProductsUsingCount, historicalOrdersUsingCount };
}

export async function shippingProfileToDTO(profile: ShippingProfileRecord): Promise<ShippingProfileDTO> {
  const counts = await shippingProfileUsageCounts(profile.key);
  return {
    id: profile.id,
    name: profile.name,
    key: profile.key,
    packageType: profile.packageType,
    defaultWeightOz: profile.defaultWeightOz,
    packageLengthIn: profile.packageLengthIn,
    packageWidthIn: profile.packageWidthIn,
    packageHeightIn: profile.packageHeightIn,
    defaultShippingCharge: profile.defaultShippingCharge,
    localPickupEligibleDefault: profile.localPickupEligibleDefault,
    freeShippingEligibleDefault: profile.freeShippingEligibleDefault,
    requiresBoxDefault: profile.requiresBoxDefault,
    insuranceRecommendedDefault: profile.insuranceRecommendedDefault,
    active: profile.active,
    systemDefault: profile.systemDefault,
    ...counts,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  };
}

export async function listShippingProfiles(currentUser: Pick<SessionUser, "id">) {
  await ensureDefaultShippingProfiles(currentUser);
  const profiles = await prisma.shippingProfile.findMany({
    where: { OR: [{ userId: null }, { userId: currentUser.id }, { systemDefault: true }] },
    orderBy: [{ active: "desc" }, { systemDefault: "desc" }, { name: "asc" }]
  });
  return Promise.all(profiles.map(shippingProfileToDTO));
}

function normalizeShippingProfileInput(input: ShippingProfileInput, existingKey?: string | null) {
  const name = input.name.trim();
  const key = (input.key?.trim() || existingKey || shippingProfileKeyFromName(name)).toLowerCase();
  if (!name) throw new Error("Shipping profile name is required.");
  if (!key || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(key)) {
    throw new Error("Use a profile key with lowercase letters, numbers, dashes, or underscores.");
  }
  if (!input.packageType.trim()) throw new Error("Package type is required.");
  if (!positiveNumber(input.defaultWeightOz) && key !== "local_pickup") {
    throw new Error("Default weight must be greater than zero.");
  }
  return {
    name,
    key,
    packageType: input.packageType.trim(),
    defaultWeightOz: key === "local_pickup" ? Math.max(0, input.defaultWeightOz || 0) : input.defaultWeightOz,
    packageLengthIn: input.packageLengthIn ?? null,
    packageWidthIn: input.packageWidthIn ?? null,
    packageHeightIn: input.packageHeightIn ?? null,
    defaultShippingCharge: input.defaultShippingCharge ?? null,
    localPickupEligibleDefault: Boolean(input.localPickupEligibleDefault),
    freeShippingEligibleDefault: Boolean(input.freeShippingEligibleDefault),
    requiresBoxDefault: Boolean(input.requiresBoxDefault),
    insuranceRecommendedDefault: Boolean(input.insuranceRecommendedDefault),
    active: input.active !== false
  };
}

export async function createShippingProfile(currentUser: Pick<SessionUser, "id">, input: ShippingProfileInput) {
  const data = normalizeShippingProfileInput(input);
  const profile = await prisma.shippingProfile.create({
    data: {
      ...data,
      userId: currentUser.id,
      systemDefault: false
    }
  });
  return shippingProfileToDTO(profile);
}

export async function updateShippingProfile(currentUser: Pick<SessionUser, "id">, profileId: string, input: Partial<ShippingProfileInput>) {
  const existing = await prisma.shippingProfile.findFirst({
    where: { id: profileId, OR: [{ userId: null }, { userId: currentUser.id }, { systemDefault: true }] }
  });
  if (!existing) throw new Error("Shipping profile not found.");
  const normalized = normalizeShippingProfileInput(
    {
      name: input.name ?? existing.name,
      key: input.key ?? existing.key,
      packageType: input.packageType ?? existing.packageType,
      defaultWeightOz: input.defaultWeightOz ?? existing.defaultWeightOz,
      packageLengthIn: input.packageLengthIn ?? existing.packageLengthIn,
      packageWidthIn: input.packageWidthIn ?? existing.packageWidthIn,
      packageHeightIn: input.packageHeightIn ?? existing.packageHeightIn,
      defaultShippingCharge: input.defaultShippingCharge ?? existing.defaultShippingCharge,
      localPickupEligibleDefault: input.localPickupEligibleDefault ?? existing.localPickupEligibleDefault,
      freeShippingEligibleDefault: input.freeShippingEligibleDefault ?? existing.freeShippingEligibleDefault,
      requiresBoxDefault: input.requiresBoxDefault ?? existing.requiresBoxDefault,
      insuranceRecommendedDefault: input.insuranceRecommendedDefault ?? existing.insuranceRecommendedDefault,
      active: input.active ?? existing.active
    },
    existing.key
  );
  if (normalized.key !== existing.key) {
    const counts = await shippingProfileUsageCounts(existing.key);
    if (existing.systemDefault || counts.productsUsingCount > 0 || counts.historicalOrdersUsingCount > 0) {
      throw new Error("Profile key cannot be changed while products or historical orders use this profile.");
    }
  }
  const profile = await prisma.shippingProfile.update({
    where: { id: existing.id },
    data: normalized
  });
  return shippingProfileToDTO(profile);
}
