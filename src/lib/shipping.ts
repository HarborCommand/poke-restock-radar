export type ShippingProfileKey =
  | "single_card_or_light_item"
  | "sealed_pack_small"
  | "small_box"
  | "medium_box"
  | "large_box"
  | "heavy_box"
  | "local_pickup";

export type ShippingCartItem = {
  id?: string | null;
  title?: string | null;
  itemName?: string | null;
  category?: string | null;
  storefrontCategory?: string | null;
  quantity?: number | null;
  requestedQuantity?: number | null;
  shippingProfile?: string | null;
  packageWeightOz?: number | null;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  shippingMetadataSource?: string | null;
  freeShippingEligible?: boolean | null;
  localPickupEligible?: boolean | null;
  localPickupAvailable?: boolean | null;
  shippingAvailable?: boolean | null;
  requiresBox?: boolean | null;
  insuranceRecommended?: boolean | null;
};

export type ShippingOption = {
  id: string;
  label: string;
  amount: number;
  profile: string;
  rateSource: "internal_profile" | "shippo";
  requiresManualReview: boolean;
};

export type ShippingCalculation = {
  totalWeightOz: number;
  actualWeightOz: number;
  packingWeightOz: number;
  dimensionalWeightOz: number;
  billableWeightOz: number;
  packageProfile: string;
  packageProfileLabel: string;
  packageTierKey: string;
  packageTierLabel: string;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
  packageVolumeIn: number;
  packageCubicFeet: number;
  shippingOptions: ShippingOption[];
  defaultShippingOption: ShippingOption | null;
  warnings: string[];
  needsShippingProfile: boolean;
  manualReviewRequired: boolean;
  localPickupEligible: boolean;
};

export type ShippingProfileDefinition = {
  label: string;
  defaultWeightOz: number;
  rank: number;
  requiresBox: boolean;
  insuranceRecommended: boolean;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  defaultShippingCharge?: number | null;
  active?: boolean;
};

export type EffectiveShippingPackageData = {
  profileKey: string;
  profileDefinition: ShippingProfileDefinition;
  usedFallbackProfile: boolean;
  categoryMinimumProfile: string | null;
  packageWeightOz: number | null;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
  usesProfileDefaultWeight: boolean;
  usesProfileDefaultDimensions: boolean;
  hasCompleteProductPackageData: boolean;
  shippingMetadataSource: "measured" | "estimated" | "fallback" | null;
  profileHasWeightDefault: boolean;
  profileHasDimensionDefaults: boolean;
  needsShippingProfile: boolean;
  missingDimensions: boolean;
};

const safeFallbackProfile: ShippingProfileKey = "small_box";
export const shippingFormulaVersion = "fit-box-packing-v3";
export const shippingFallbackProfileVersion = "tcg-retail-fallbacks-v1";

export type ShippingCalculationAudit = {
  formulaVersion: string;
  fallbackProfileVersion: string;
  lineCount: number;
  totalUnits: number;
  items: Array<{
    id: string | null;
    name: string | null;
    category: string | null;
    storefrontCategory: string | null;
    quantity: number;
    selectedProfile: string;
    selectedProfileLabel: string;
    fallbackProfileUsed: boolean;
    shippingMetadataSource: string | null;
    categoryMinimumProfile: string | null;
    packageWeightOz: number | null;
    packageDimensions: { lengthIn: number | null; widthIn: number | null; heightIn: number | null };
    lineWeightOz: number;
    missingDimensions: boolean;
  }>;
  totalItemWeightOz: number;
  packingWeightOz: number;
  selectedPackageTier: string;
  selectedPackageTierLabel: string;
  selectedPackageDimensions: { lengthIn: number | null; widthIn: number | null; heightIn: number | null };
  selectedPackageVolumeIn: number;
  selectedPackageCubicFeet: number;
  actualPackedWeightOz: number;
  dimensionalWeightOz: number;
  billableWeightOz: number;
  fallbackProfileUsed: boolean;
  missingDimensions: boolean;
  cacheRelevantFields: Array<{
    id: string | null;
    quantity: number;
    shippingProfile: string | null;
    packageWeightOz: number | null;
    packageLengthIn: number | null;
    packageWidthIn: number | null;
    packageHeightIn: number | null;
    shippingMetadataSource: string | null;
    category: string | null;
    storefrontCategory: string | null;
  }>;
  shippoParcelPayload: {
    weightOz: number;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    profileKey: string;
  };
};

type ShippingPackageTier = {
  key: string;
  label: string;
  profileKey: ShippingProfileKey;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  maxWeightOz: number;
  packingWeightOz: number;
};

const shippingPackageTiers: ShippingPackageTier[] = [
  { key: "padded_mailer", label: "Padded Mailer", profileKey: "sealed_pack_small", lengthIn: 10, widthIn: 8, heightIn: 2, maxWeightOz: 12, packingWeightOz: 1 },
  { key: "box_10x8x4", label: "10 x 8 x 4 Box", profileKey: "small_box", lengthIn: 10, widthIn: 8, heightIn: 4, maxWeightOz: 24, packingWeightOz: 2 },
  { key: "box_12x9x4", label: "12 x 9 x 4 Box", profileKey: "small_box", lengthIn: 12, widthIn: 9, heightIn: 4, maxWeightOz: 48, packingWeightOz: 3 },
  { key: "box_14x10x6", label: "14 x 10 x 6 Box", profileKey: "medium_box", lengthIn: 14, widthIn: 10, heightIn: 6, maxWeightOz: 80, packingWeightOz: 4 },
  { key: "box_16x12x4", label: "16 x 12 x 4 Box", profileKey: "medium_box", lengthIn: 16, widthIn: 12, heightIn: 4, maxWeightOz: 80, packingWeightOz: 4.5 },
  { key: "box_16x12x8", label: "16 x 12 x 8 Box", profileKey: "large_box", lengthIn: 16, widthIn: 12, heightIn: 8, maxWeightOz: 128, packingWeightOz: 6 },
  { key: "box_18x12x8", label: "18 x 12 x 8 Box", profileKey: "large_box", lengthIn: 18, widthIn: 12, heightIn: 8, maxWeightOz: 160, packingWeightOz: 7 },
  { key: "box_20x14x10", label: "20 x 14 x 10 Box", profileKey: "heavy_box", lengthIn: 20, widthIn: 14, heightIn: 10, maxWeightOz: 240, packingWeightOz: 9 },
  { key: "box_22x16x14", label: "22 x 16 x 14 Box", profileKey: "heavy_box", lengthIn: 22, widthIn: 16, heightIn: 14, maxWeightOz: 320, packingWeightOz: 10 }
];

export const shippingProfiles: Record<ShippingProfileKey, ShippingProfileDefinition> = {
  single_card_or_light_item: {
    label: "Single Card or Light Item",
    defaultWeightOz: 4,
    rank: 1,
    requiresBox: false,
    insuranceRecommended: false,
    packageLengthIn: 6,
    packageWidthIn: 4,
    packageHeightIn: 1
  },
  sealed_pack_small: {
    label: "Sealed Pack Small",
    defaultWeightOz: 8,
    rank: 2,
    requiresBox: false,
    insuranceRecommended: false,
    packageLengthIn: 10,
    packageWidthIn: 7,
    packageHeightIn: 2
  },
  small_box: {
    label: "Small Box",
    defaultWeightOz: 16,
    rank: 3,
    requiresBox: true,
    insuranceRecommended: false,
    packageLengthIn: 9,
    packageWidthIn: 7,
    packageHeightIn: 5
  },
  medium_box: {
    label: "Medium Box",
    defaultWeightOz: 32,
    rank: 4,
    requiresBox: true,
    insuranceRecommended: false,
    packageLengthIn: 12,
    packageWidthIn: 9,
    packageHeightIn: 7
  },
  large_box: {
    label: "Large Box",
    defaultWeightOz: 80,
    rank: 5,
    requiresBox: true,
    insuranceRecommended: true,
    packageLengthIn: 15,
    packageWidthIn: 12,
    packageHeightIn: 9
  },
  heavy_box: {
    label: "Heavy Box",
    defaultWeightOz: 96,
    rank: 6,
    requiresBox: true,
    insuranceRecommended: true,
    packageLengthIn: 22,
    packageWidthIn: 16,
    packageHeightIn: 14
  },
  local_pickup: {
    label: "Local Pickup",
    defaultWeightOz: 0,
    rank: 0,
    requiresBox: false,
    insuranceRecommended: false
  }
};

const profileAliases: Record<string, ShippingProfileKey> = {
  card: "single_card_or_light_item",
  light: "single_card_or_light_item",
  pack: "sealed_pack_small",
  sealed_pack: "sealed_pack_small",
  blister: "sealed_pack_small",
  box: "small_box"
};

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function roundedMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundedWeight(value: number) {
  return Math.round(value * 10) / 10;
}

function packageDimension(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null;
}

function normalizeShippingMetadataSource(value: string | null | undefined): "measured" | "estimated" | "fallback" | null {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "measured" || normalized === "estimated" || normalized === "fallback" ? normalized : null;
}

function quantityForItem(item: ShippingCartItem) {
  const quantity = positiveNumber(item.quantity ?? item.requestedQuantity);
  return quantity ? Math.max(1, Math.floor(quantity)) : 1;
}

function mergeShippingProfileDefinition(key: string, profile: ShippingProfileDefinition): ShippingProfileDefinition {
  const base = shippingProfiles[key as ShippingProfileKey];
  if (!base) return profile;

  return {
    ...base,
    ...profile,
    defaultWeightOz: positiveNumber(profile.defaultWeightOz) ?? base.defaultWeightOz,
    packageLengthIn: packageDimension(profile.packageLengthIn) ?? base.packageLengthIn ?? null,
    packageWidthIn: packageDimension(profile.packageWidthIn) ?? base.packageWidthIn ?? null,
    packageHeightIn: packageDimension(profile.packageHeightIn) ?? base.packageHeightIn ?? null,
    requiresBox: profile.requiresBox ?? base.requiresBox,
    insuranceRecommended: profile.insuranceRecommended ?? base.insuranceRecommended
  };
}

function shippingProfileDefinitionMap(profileDefinitions: Record<string, ShippingProfileDefinition>): Record<string, ShippingProfileDefinition> {
  return Object.entries(profileDefinitions).reduce<Record<string, ShippingProfileDefinition>>(
    (definitions, [key, profile]) => {
      definitions[key] = mergeShippingProfileDefinition(key, profile);
      return definitions;
    },
    { ...shippingProfiles }
  );
}

export function normalizeShippingProfile(
  value: string | null | undefined,
  profileDefinitions: Record<string, ShippingProfileDefinition> = shippingProfiles
): {
  profile: string;
  usedFallback: boolean;
} {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized && normalized in profileDefinitions) {
    return { profile: normalized, usedFallback: false };
  }
  if (normalized && normalized in profileAliases) {
    return { profile: profileAliases[normalized], usedFallback: false };
  }
  return { profile: safeFallbackProfile, usedFallback: true };
}

export function itemNeedsShippingProfile(
  item: Pick<
    ShippingCartItem,
    | "shippingProfile"
    | "packageWeightOz"
    | "packageLengthIn"
    | "packageWidthIn"
    | "packageHeightIn"
    | "shippingMetadataSource"
    | "category"
    | "storefrontCategory"
    | "title"
    | "itemName"
  >,
  profileDefinitions: Record<string, ShippingProfileDefinition> = shippingProfiles
) {
  return effectiveShippingPackageData(item, profileDefinitions).needsShippingProfile;
}

function normalizedSearchSignals(item: Pick<ShippingCartItem, "category" | "storefrontCategory" | "title" | "itemName">) {
  return [item.storefrontCategory, item.category, item.title, item.itemName]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
    )
    .filter(Boolean)
    .join(" ");
}

function categoryMinimumProfile(
  item: Pick<ShippingCartItem, "category" | "storefrontCategory" | "title" | "itemName">
): ShippingProfileKey | null {
  const signals = normalizedSearchSignals(item);

  if (/\b(single|graded|raw)\s+cards?\b/.test(signals)) return "single_card_or_light_item";
  if (/\b(booster\s+boxes?|ultra\s+premium|premium\s+collections?|collections?|collection\s+boxes?|illustration\s+collection|boxed\s+sets?)\b/.test(signals)) {
    return "medium_box";
  }
  if (/\b(elite\s+trainer|etbs?)\b/.test(signals)) return "medium_box";
  if (/\b(booster\s+bundles?|tins?|mini\s+tins?)\b/.test(signals)) return "small_box";
  if (/\b(blisters?|checklane|sleeved\s+boosters?|sealed\s+packs?|packs?)\b/.test(signals)) return "sealed_pack_small";
  return null;
}

type CategoryFallbackPackage = {
  profileKey: ShippingProfileKey;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

function categoryFallbackPackage(
  item: Pick<ShippingCartItem, "category" | "storefrontCategory" | "title" | "itemName">
): CategoryFallbackPackage | null {
  const signals = normalizedSearchSignals(item);

  if (/\b(single|graded|raw)\s+cards?\b/.test(signals)) {
    return { profileKey: "single_card_or_light_item", weightOz: 4, lengthIn: 6, widthIn: 4, heightIn: 1 };
  }
  if (/\b(booster\s+boxes?)\b/.test(signals)) {
    return { profileKey: "medium_box", weightOz: 28, lengthIn: 6, widthIn: 5, heightIn: 5 };
  }
  if (/\b(elite\s+trainer|etbs?)\b/.test(signals)) {
    return { profileKey: "medium_box", weightOz: 26, lengthIn: 8, widthIn: 7, heightIn: 4 };
  }
  if (/\b(ultra\s+premium|premium\s+collections?|collections?|collection\s+boxes?|illustration\s+collection|boxed\s+sets?)\b/.test(signals)) {
    return { profileKey: "medium_box", weightOz: 18, lengthIn: 15, widthIn: 10, heightIn: 2 };
  }
  if (/\b(booster\s+bundles?)\b/.test(signals)) {
    return { profileKey: "small_box", weightOz: 6, lengthIn: 5, widthIn: 3, heightIn: 3 };
  }
  if (/\b(tins?|mini\s+tins?)\b/.test(signals)) {
    return { profileKey: "small_box", weightOz: 10, lengthIn: 7, widthIn: 5, heightIn: 3 };
  }
  if (/\b(three|3)[-\s]?booster\s+blisters?\b/.test(signals)) {
    return { profileKey: "sealed_pack_small", weightOz: 6, lengthIn: 11, widthIn: 8, heightIn: 1 };
  }
  if (/\b(blisters?|checklane)\b/.test(signals)) {
    return { profileKey: "sealed_pack_small", weightOz: 5, lengthIn: 9, widthIn: 7, heightIn: 1 };
  }
  if (/\b(sleeved\s+boosters?|sealed\s+packs?|packs?)\b/.test(signals)) {
    return { profileKey: "sealed_pack_small", weightOz: 4, lengthIn: 8, widthIn: 5, heightIn: 1 };
  }
  return null;
}

function packageVolume(lengthIn: number | null | undefined, widthIn: number | null | undefined, heightIn: number | null | undefined) {
  return lengthIn && widthIn && heightIn ? lengthIn * widthIn * heightIn : 0;
}

function categoryFallbackShouldReplaceDimensions(
  item: Pick<ShippingCartItem, "category" | "storefrontCategory" | "title" | "itemName">,
  fallback: CategoryFallbackPackage | null,
  dimensions: { lengthIn: number | null; widthIn: number | null; heightIn: number | null }
) {
  if (!fallback || !dimensions.lengthIn || !dimensions.widthIn || !dimensions.heightIn) return false;
  const signals = normalizedSearchSignals(item);
  const current = orientedDimensions(dimensions.lengthIn, dimensions.widthIn, dimensions.heightIn);
  const fallbackOriented = orientedDimensions(fallback.lengthIn, fallback.widthIn, fallback.heightIn);
  if (!current || !fallbackOriented) return false;

  const currentVolume = packageVolume(current.length, current.width, current.height);
  const fallbackVolume = packageVolume(fallbackOriented.length, fallbackOriented.width, fallbackOriented.height);
  if (!currentVolume || !fallbackVolume) return false;

  if (/\b(blisters?|checklane|sleeved\s+boosters?|sealed\s+packs?|packs?)\b/.test(signals)) {
    return current.height > 2.5 || currentVolume > fallbackVolume * 3;
  }
  if (/\b(booster\s+bundles?|tins?|mini\s+tins?)\b/.test(signals)) {
    return current.height > 5 || currentVolume > fallbackVolume * 5;
  }
  if (/\b(premium\s+collections?|collections?|collection\s+boxes?|illustration\s+collection|boxed\s+sets?)\b/.test(signals)) {
    return current.height > 5 || currentVolume > fallbackVolume * 4;
  }
  return false;
}

export function effectiveShippingPackageData(
  item: Pick<
    ShippingCartItem,
    | "shippingProfile"
    | "packageWeightOz"
    | "packageLengthIn"
    | "packageWidthIn"
    | "packageHeightIn"
    | "shippingMetadataSource"
    | "category"
    | "storefrontCategory"
    | "title"
    | "itemName"
  >,
  profileDefinitions: Record<string, ShippingProfileDefinition> = shippingProfiles
): EffectiveShippingPackageData {
  const definitions = shippingProfileDefinitionMap(profileDefinitions);
  const normalized = normalizeShippingProfile(item.shippingProfile, definitions);
  const minimumProfile = categoryMinimumProfile(item);
  const fallbackPackage = categoryFallbackPackage(item);
  const baseProfileKey = normalized.usedFallback ? fallbackPackage?.profileKey ?? minimumProfile ?? safeFallbackProfile : normalized.profile;
  const categoryCanRaiseProfile = normalized.usedFallback || normalized.profile in shippingProfiles;
  const profileKey = minimumProfile && categoryCanRaiseProfile ? higherRankProfile(definitions, baseProfileKey, minimumProfile) : baseProfileKey;
  const profileDefinition = definitions[profileKey] ?? shippingProfiles[safeFallbackProfile];
  const itemWeight = positiveNumber(item.packageWeightOz);
  const profileWeight = positiveNumber(profileDefinition.defaultWeightOz);
  const itemLength = packageDimension(item.packageLengthIn);
  const itemWidth = packageDimension(item.packageWidthIn);
  const itemHeight = packageDimension(item.packageHeightIn);
  const shippingMetadataSource = normalizeShippingMetadataSource(item.shippingMetadataSource);
  const productPackageDataAuthoritative = shippingMetadataSource === "measured" || shippingMetadataSource === "estimated";
  const hasCompleteProductPackageData = Boolean(itemWeight && itemLength && itemWidth && itemHeight);
  const profileLength = packageDimension(profileDefinition.packageLengthIn);
  const profileWidth = packageDimension(profileDefinition.packageWidthIn);
  const profileHeight = packageDimension(profileDefinition.packageHeightIn);
  const replaceDimensions =
    !productPackageDataAuthoritative &&
    categoryFallbackShouldReplaceDimensions(item, fallbackPackage, {
      lengthIn: itemLength,
      widthIn: itemWidth,
      heightIn: itemHeight
    });
  const fallbackWeight = normalized.usedFallback ? fallbackPackage?.weightOz : null;
  const fallbackLength = normalized.usedFallback || replaceDimensions ? fallbackPackage?.lengthIn : null;
  const fallbackWidth = normalized.usedFallback || replaceDimensions ? fallbackPackage?.widthIn : null;
  const fallbackHeight = normalized.usedFallback || replaceDimensions ? fallbackPackage?.heightIn : null;
  const packageWeightOz = itemWeight ?? fallbackWeight ?? profileWeight;
  const packageLengthIn = replaceDimensions ? fallbackLength ?? null : itemLength ?? fallbackLength ?? profileLength;
  const packageWidthIn = replaceDimensions ? fallbackWidth ?? null : itemWidth ?? fallbackWidth ?? profileWidth;
  const packageHeightIn = replaceDimensions ? fallbackHeight ?? null : itemHeight ?? fallbackHeight ?? profileHeight;
  const profileHasDimensionDefaults = Boolean(profileLength && profileWidth && profileHeight);
  const missingDimensions = !packageLengthIn || !packageWidthIn || !packageHeightIn;

  return {
    profileKey,
    profileDefinition,
    usedFallbackProfile: normalized.usedFallback,
    categoryMinimumProfile: minimumProfile,
    packageWeightOz,
    packageLengthIn,
    packageWidthIn,
    packageHeightIn,
    usesProfileDefaultWeight: !itemWeight && Boolean(profileWeight) && !normalized.usedFallback,
    usesProfileDefaultDimensions: (!itemLength || !itemWidth || !itemHeight) && !missingDimensions && !normalized.usedFallback,
    hasCompleteProductPackageData,
    shippingMetadataSource,
    profileHasWeightDefault: Boolean(profileWeight),
    profileHasDimensionDefaults,
    needsShippingProfile: !hasCompleteProductPackageData && (normalized.usedFallback || !packageWeightOz),
    missingDimensions
  };
}

export function rateForWeight(totalWeightOz: number) {
  if (totalWeightOz <= 8) return { amount: 4.99, label: "Standard Shipping", manualReview: false };
  if (totalWeightOz <= 16) return { amount: 5.99, label: "Standard Shipping", manualReview: false };
  if (totalWeightOz <= 32) return { amount: 7.99, label: "Boxed Shipping", manualReview: false };
  if (totalWeightOz <= 80) return { amount: 9.99, label: "Boxed Shipping", manualReview: false };
  return { amount: 12.99, label: "Heavy Package Shipping", manualReview: true };
}

function profileRank(profileDefinitions: Record<string, ShippingProfileDefinition>, profileKey: string) {
  return (profileDefinitions[profileKey] ?? shippingProfiles[safeFallbackProfile]).rank;
}

function higherRankProfile(
  profileDefinitions: Record<string, ShippingProfileDefinition>,
  currentProfile: string,
  candidateProfile: string
) {
  return profileRank(profileDefinitions, candidateProfile) > profileRank(profileDefinitions, currentProfile) ? candidateProfile : currentProfile;
}

function profileForPackedWeight(totalWeightOz: number): ShippingProfileKey {
  if (totalWeightOz <= 8) return "sealed_pack_small";
  if (totalWeightOz <= 16) return "small_box";
  if (totalWeightOz <= 32) return "medium_box";
  if (totalWeightOz <= 80) return "large_box";
  return "heavy_box";
}

function orientedDimensions(lengthIn: number | null, widthIn: number | null, heightIn: number | null) {
  if (!lengthIn || !widthIn || !heightIn) return null;
  const [length, width, height] = [lengthIn, widthIn, heightIn].sort((left, right) => right - left);
  return { length, width, height };
}

function roundUpDimension(value: number) {
  return Math.ceil(value * 10) / 10;
}

function dimensionalWeightOz(lengthIn: number | null, widthIn: number | null, heightIn: number | null) {
  if (!lengthIn || !widthIn || !heightIn) return 0;
  const cubicInches = lengthIn * widthIn * heightIn;
  if (cubicInches <= 1728) return 0;
  return Math.ceil(cubicInches / 166) * 16;
}

type PackedCartAuditItem = ShippingCalculationAudit["items"][number];

type PackedCartPackage = {
  totalUnits: number;
  totalItemWeightOz: number;
  packingWeightOz: number;
  actualWeightOz: number;
  dimensionalWeightOz: number;
  billableWeightOz: number;
  packageVolumeIn: number;
  packageCubicFeet: number;
  packageProfile: string;
  packageTierKey: string;
  packageTierLabel: string;
  packageLengthIn: number | null;
  packageWidthIn: number | null;
  packageHeightIn: number | null;
  missingDimensions: boolean;
  fallbackProfileUsed: boolean;
  auditItems: PackedCartAuditItem[];
};

function selectPackageTier(input: {
  requiredLengthIn: number;
  requiredWidthIn: number;
  minimumItemHeightIn: number;
  totalVolumeIn: number;
  totalItemWeightOz: number;
  totalUnits: number;
  requiresRigidBox: boolean;
}) {
  const volumeWithVoidFill = input.totalVolumeIn * (input.totalUnits <= 1 ? 1.15 : 1.2);

  return (
    shippingPackageTiers.find((tier) => {
      const tierVolume = tier.lengthIn * tier.widthIn * tier.heightIn;
      const estimatedHeightIn = Math.max(input.minimumItemHeightIn, volumeWithVoidFill / (tier.lengthIn * tier.widthIn));
      return (
        (!input.requiresRigidBox || tier.key !== "padded_mailer") &&
        tier.lengthIn >= input.requiredLengthIn &&
        tier.widthIn >= input.requiredWidthIn &&
        tier.heightIn >= estimatedHeightIn &&
        tierVolume >= volumeWithVoidFill &&
        input.totalItemWeightOz + tier.packingWeightOz <= tier.maxWeightOz
      );
    }) ?? shippingPackageTiers[shippingPackageTiers.length - 1]
  );
}

function packedCartPackage(
  cartItems: ShippingCartItem[],
  profileDefinitions: Record<string, ShippingProfileDefinition>
): PackedCartPackage {
  let totalUnits = 0;
  let totalItemWeightOz = 0;
  let packageProfile: string = safeFallbackProfile;
  let missingDimensions = false;
  let fallbackProfileUsed = false;
  let maxLengthIn = 0;
  let maxWidthIn = 0;
  let maxHeightIn = 0;
  let totalVolumeIn = 0;
  let requiresRigidBox = false;
  const auditItems: PackedCartAuditItem[] = [];

  for (const item of cartItems) {
    const quantity = quantityForItem(item);
    const effectivePackage = effectiveShippingPackageData(item, profileDefinitions);
    const profileKey = effectivePackage.profileKey;
    const profileWeightOz = effectivePackage.packageWeightOz ?? shippingProfiles[safeFallbackProfile].defaultWeightOz;
    const dimensions = orientedDimensions(
      effectivePackage.packageLengthIn,
      effectivePackage.packageWidthIn,
      effectivePackage.packageHeightIn
    );

    totalUnits += quantity;
    const lineWeightOz = roundedWeight(profileWeightOz * quantity);
    totalItemWeightOz += lineWeightOz;
    fallbackProfileUsed ||= effectivePackage.needsShippingProfile;
    packageProfile = higherRankProfile(profileDefinitions, packageProfile, profileKey);
    requiresRigidBox ||= Boolean(item.requiresBox || effectivePackage.profileDefinition.requiresBox);

    if (!dimensions) {
      missingDimensions = true;
      auditItems.push({
        id: item.id ?? null,
        name: item.title ?? item.itemName ?? null,
        category: item.category ?? null,
        storefrontCategory: item.storefrontCategory ?? null,
        quantity,
        selectedProfile: profileKey,
        selectedProfileLabel: effectivePackage.profileDefinition.label,
        fallbackProfileUsed: effectivePackage.needsShippingProfile,
        shippingMetadataSource: effectivePackage.shippingMetadataSource,
        categoryMinimumProfile: effectivePackage.categoryMinimumProfile,
        packageWeightOz: effectivePackage.packageWeightOz,
        packageDimensions: {
          lengthIn: effectivePackage.packageLengthIn,
          widthIn: effectivePackage.packageWidthIn,
          heightIn: effectivePackage.packageHeightIn
        },
        lineWeightOz,
        missingDimensions: true
      });
      continue;
    }

    maxLengthIn = Math.max(maxLengthIn, dimensions.length);
    maxWidthIn = Math.max(maxWidthIn, dimensions.width);
    maxHeightIn = Math.max(maxHeightIn, dimensions.height);
    totalVolumeIn += dimensions.length * dimensions.width * dimensions.height * quantity;
    auditItems.push({
      id: item.id ?? null,
      name: item.title ?? item.itemName ?? null,
      category: item.category ?? null,
      storefrontCategory: item.storefrontCategory ?? null,
      quantity,
      selectedProfile: profileKey,
      selectedProfileLabel: effectivePackage.profileDefinition.label,
      fallbackProfileUsed: effectivePackage.needsShippingProfile,
      shippingMetadataSource: effectivePackage.shippingMetadataSource,
      categoryMinimumProfile: effectivePackage.categoryMinimumProfile,
      packageWeightOz: effectivePackage.packageWeightOz,
      packageDimensions: {
        lengthIn: effectivePackage.packageLengthIn,
        widthIn: effectivePackage.packageWidthIn,
        heightIn: effectivePackage.packageHeightIn
      },
      lineWeightOz,
      missingDimensions: false
    });
  }

  totalItemWeightOz = roundedWeight(totalItemWeightOz);

  const paddingIn = totalUnits <= 1 ? 0.5 : 1;
  const requiredLengthIn = maxLengthIn ? roundUpDimension(maxLengthIn + paddingIn) : 0;
  const requiredWidthIn = maxWidthIn ? roundUpDimension(maxWidthIn + paddingIn) : 0;
  const minimumItemHeightIn = maxHeightIn ? roundUpDimension(maxHeightIn + paddingIn) : 0;
  const tier =
    missingDimensions || totalUnits === 0
      ? null
      : selectPackageTier({
          requiredLengthIn,
          requiredWidthIn,
          minimumItemHeightIn,
          totalVolumeIn,
          totalItemWeightOz,
          totalUnits,
          requiresRigidBox
        });
  const tierProfile = tier?.profileKey ?? packageProfile;
  const packingWeightOz = tier ? tier.packingWeightOz : 0;
  const actualWeightOz = roundedWeight(totalItemWeightOz + packingWeightOz);
  const packageLengthIn = tier?.lengthIn ?? null;
  const packageWidthIn = tier?.widthIn ?? null;
  const packageHeightIn = tier?.heightIn ?? null;
  const calculatedDimensionalWeightOz = dimensionalWeightOz(packageLengthIn, packageWidthIn, packageHeightIn);
  const billableWeightOz = Math.max(actualWeightOz, calculatedDimensionalWeightOz);
  const finalPackageProfile = tierProfile || profileForPackedWeight(billableWeightOz);
  const finalPackageVolumeIn = packageVolume(packageLengthIn, packageWidthIn, packageHeightIn);

  return {
    totalUnits,
    totalItemWeightOz,
    packingWeightOz,
    actualWeightOz,
    dimensionalWeightOz: calculatedDimensionalWeightOz,
    billableWeightOz,
    packageVolumeIn: finalPackageVolumeIn,
    packageCubicFeet: finalPackageVolumeIn ? Math.round((finalPackageVolumeIn / 1728) * 1000) / 1000 : 0,
    packageProfile: finalPackageProfile,
    packageTierKey: tier?.key ?? "missing_package_data",
    packageTierLabel: tier?.label ?? "Missing Package Data",
    packageLengthIn,
    packageWidthIn,
    packageHeightIn,
    missingDimensions,
    fallbackProfileUsed,
    auditItems
  };
}

export function shippingRatePackageFromCalculation(shippingCalculation: ShippingCalculation) {
  return {
    weightOz: shippingCalculation.actualWeightOz,
    lengthIn: shippingCalculation.packageLengthIn,
    widthIn: shippingCalculation.packageWidthIn,
    heightIn: shippingCalculation.packageHeightIn,
    profileKey: shippingCalculation.packageProfile
  };
}

export function explainCartShippingCalculation(
  items: ShippingCartItem[],
  options: { profileDefinitions?: Record<string, ShippingProfileDefinition> } = {}
): ShippingCalculationAudit {
  const profileDefinitions = shippingProfileDefinitionMap(options.profileDefinitions ?? {});
  const cartItems = items.filter((item) => quantityForItem(item) > 0);
  const packedPackage = packedCartPackage(cartItems, profileDefinitions);

  return {
    formulaVersion: shippingFormulaVersion,
    fallbackProfileVersion: shippingFallbackProfileVersion,
    lineCount: cartItems.length,
    totalUnits: packedPackage.totalUnits,
    items: packedPackage.auditItems,
    totalItemWeightOz: packedPackage.totalItemWeightOz,
    packingWeightOz: packedPackage.packingWeightOz,
    selectedPackageTier: packedPackage.packageTierKey,
    selectedPackageTierLabel: packedPackage.packageTierLabel,
    selectedPackageDimensions: {
      lengthIn: packedPackage.packageLengthIn,
      widthIn: packedPackage.packageWidthIn,
      heightIn: packedPackage.packageHeightIn
    },
    selectedPackageVolumeIn: packedPackage.packageVolumeIn,
    selectedPackageCubicFeet: packedPackage.packageCubicFeet,
    actualPackedWeightOz: packedPackage.actualWeightOz,
    dimensionalWeightOz: packedPackage.dimensionalWeightOz,
    billableWeightOz: packedPackage.billableWeightOz,
    fallbackProfileUsed: packedPackage.fallbackProfileUsed,
    missingDimensions: packedPackage.missingDimensions,
    cacheRelevantFields: cartItems.map((item) => {
      const effectivePackage = effectiveShippingPackageData(item, profileDefinitions);
      return {
        id: item.id ?? null,
        quantity: quantityForItem(item),
        shippingProfile: item.shippingProfile ?? null,
        packageWeightOz: effectivePackage.packageWeightOz,
        packageLengthIn: effectivePackage.packageLengthIn,
        packageWidthIn: effectivePackage.packageWidthIn,
        packageHeightIn: effectivePackage.packageHeightIn,
        shippingMetadataSource: item.shippingMetadataSource ?? null,
        category: item.category ?? null,
        storefrontCategory: item.storefrontCategory ?? null
      };
    }),
    shippoParcelPayload: {
      weightOz: packedPackage.actualWeightOz,
      lengthIn: packedPackage.packageLengthIn,
      widthIn: packedPackage.packageWidthIn,
      heightIn: packedPackage.packageHeightIn,
      profileKey: packedPackage.packageProfile
    }
  };
}

export function calculateCartShipping(
  items: ShippingCartItem[],
  options: {
    subtotal?: number | null;
    freeShippingThreshold?: number | null;
    fulfillmentMethod?: "shipping" | "pickup";
    profileDefinitions?: Record<string, ShippingProfileDefinition>;
  } = {}
): ShippingCalculation {
  const profileDefinitions = shippingProfileDefinitionMap(options.profileDefinitions ?? {});
  const cartItems = items.filter((item) => quantityForItem(item) > 0);
  const packedPackage = packedCartPackage(cartItems, profileDefinitions);
  const warnings = new Set<string>();
  let needsShippingProfile = false;
  let manualReviewRequired = false;

  for (const item of cartItems) {
    const effectivePackage = effectiveShippingPackageData(item, profileDefinitions);
    const fallbackNeeded = effectivePackage.needsShippingProfile;
    const profile = effectivePackage.profileDefinition;

    if (fallbackNeeded) {
      needsShippingProfile = true;
      warnings.add("One or more items need a shipping profile; using a safe package fallback.");
    }

    if (item.insuranceRecommended || profile.insuranceRecommended) {
      warnings.add("Insurance is recommended for one or more items.");
    }
  }

  const allPickupEligible = cartItems.length > 0 && cartItems.every((item) => (item.localPickupEligible ?? item.localPickupAvailable) === true);
  const allShippingAvailable = cartItems.length > 0 && cartItems.every((item) => item.shippingAvailable !== false);
  const freeShippingUnlocked =
    typeof options.subtotal === "number" &&
    typeof options.freeShippingThreshold === "number" &&
    options.freeShippingThreshold > 0 &&
    options.subtotal >= options.freeShippingThreshold;
  const totalWeightOz = packedPackage.actualWeightOz;
  const packageProfile = packedPackage.packageProfile;
  const packageDefinition = profileDefinitions[packageProfile] ?? shippingProfiles[safeFallbackProfile];
  const packageLengthIn = packedPackage.packageLengthIn;
  const packageWidthIn = packedPackage.packageWidthIn;
  const packageHeightIn = packedPackage.packageHeightIn;
  if (allShippingAvailable && (!packageLengthIn || !packageWidthIn || !packageHeightIn)) {
    warnings.add("Package dimensions are missing; using fallback shipping until package size is complete.");
  }
  const baseRate = rateForWeight(packedPackage.billableWeightOz);
  const profileCharge = positiveNumber(packageDefinition.defaultShippingCharge);
  const rateAmount = profileCharge ?? baseRate.amount;
  manualReviewRequired = baseRate.manualReview;
  if (manualReviewRequired) warnings.add("Heavy package shipping may need manual review.");

  const shippingOption: ShippingOption | null = allShippingAvailable
    ? {
        id: "standard_shipping",
        label: baseRate.label,
        amount: freeShippingUnlocked ? 0 : roundedMoney(rateAmount),
        profile: packageProfile,
        rateSource: "internal_profile",
        requiresManualReview: manualReviewRequired
      }
    : null;
  const pickupOption: ShippingOption | null = allPickupEligible
    ? {
        id: "local_pickup",
        label: "Local Pickup",
        amount: 0,
        profile: "local_pickup",
        rateSource: "internal_profile",
        requiresManualReview: false
      }
    : null;

  if (!shippingOption && !pickupOption) {
    warnings.add("No safe shipping option is available for one or more cart items.");
  }

  const shippingOptions = [shippingOption, pickupOption].filter((option): option is ShippingOption => Boolean(option));
  const defaultShippingOption = options.fulfillmentMethod === "pickup" && pickupOption ? pickupOption : shippingOption ?? pickupOption;

  return {
    totalWeightOz,
    actualWeightOz: packedPackage.actualWeightOz,
    packingWeightOz: packedPackage.packingWeightOz,
    dimensionalWeightOz: packedPackage.dimensionalWeightOz,
    billableWeightOz: packedPackage.billableWeightOz,
    packageProfile,
    packageProfileLabel: packageDefinition.label,
    packageTierKey: packedPackage.packageTierKey,
    packageTierLabel: packedPackage.packageTierLabel,
    packageLengthIn,
    packageWidthIn,
    packageHeightIn,
    packageVolumeIn: packedPackage.packageVolumeIn,
    packageCubicFeet: packedPackage.packageCubicFeet,
    shippingOptions,
    defaultShippingOption,
    warnings: [...warnings],
    needsShippingProfile,
    manualReviewRequired,
    localPickupEligible: allPickupEligible
  };
}
