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
  profileHasWeightDefault: boolean;
  profileHasDimensionDefaults: boolean;
  needsShippingProfile: boolean;
  missingDimensions: boolean;
};

const safeFallbackProfile: ShippingProfileKey = "small_box";
export const shippingFormulaVersion = "packed-box-tiers-v2";

export type ShippingCalculationAudit = {
  formulaVersion: string;
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
    category: string | null;
    storefrontCategory: string | null;
  }>;
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
  { key: "small_padded_mailer", label: "Small Padded Mailer", profileKey: "sealed_pack_small", lengthIn: 10, widthIn: 7, heightIn: 2, maxWeightOz: 8, packingWeightOz: 1 },
  { key: "small_box", label: "Small Box", profileKey: "small_box", lengthIn: 9, widthIn: 7, heightIn: 5, maxWeightOz: 16, packingWeightOz: 2 },
  { key: "medium_box", label: "Medium Box", profileKey: "medium_box", lengthIn: 12, widthIn: 9, heightIn: 7, maxWeightOz: 48, packingWeightOz: 3.5 },
  { key: "large_box", label: "Large Box", profileKey: "large_box", lengthIn: 15, widthIn: 12, heightIn: 9, maxWeightOz: 96, packingWeightOz: 5 },
  { key: "extra_large_box", label: "Extra-Large Box", profileKey: "heavy_box", lengthIn: 18, widthIn: 14, heightIn: 12, maxWeightOz: 160, packingWeightOz: 8 },
  { key: "heavy_box", label: "Heavy Box", profileKey: "heavy_box", lengthIn: 22, widthIn: 16, heightIn: 14, maxWeightOz: 320, packingWeightOz: 10 }
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
  item: Pick<ShippingCartItem, "shippingProfile" | "packageWeightOz" | "category" | "storefrontCategory" | "title" | "itemName">,
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
    return "large_box";
  }
  if (/\b(elite\s+trainer|etbs?|booster\s+bundles?|tins?|mini\s+tins?)\b/.test(signals)) return "medium_box";
  if (/\b(blisters?|checklane|sleeved\s+boosters?|sealed\s+packs?|packs?)\b/.test(signals)) return "sealed_pack_small";
  return null;
}

export function effectiveShippingPackageData(
  item: Pick<
    ShippingCartItem,
    | "shippingProfile"
    | "packageWeightOz"
    | "packageLengthIn"
    | "packageWidthIn"
    | "packageHeightIn"
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
  const baseProfileKey = normalized.usedFallback ? minimumProfile ?? safeFallbackProfile : normalized.profile;
  const categoryCanRaiseProfile = normalized.usedFallback || normalized.profile in shippingProfiles;
  const profileKey = minimumProfile && categoryCanRaiseProfile ? higherRankProfile(definitions, baseProfileKey, minimumProfile) : baseProfileKey;
  const profileDefinition = definitions[profileKey] ?? shippingProfiles[safeFallbackProfile];
  const itemWeight = positiveNumber(item.packageWeightOz);
  const profileWeight = positiveNumber(profileDefinition.defaultWeightOz);
  const itemLength = packageDimension(item.packageLengthIn);
  const itemWidth = packageDimension(item.packageWidthIn);
  const itemHeight = packageDimension(item.packageHeightIn);
  const profileLength = packageDimension(profileDefinition.packageLengthIn);
  const profileWidth = packageDimension(profileDefinition.packageWidthIn);
  const profileHeight = packageDimension(profileDefinition.packageHeightIn);
  const packageWeightOz = itemWeight ?? profileWeight;
  const packageLengthIn = itemLength ?? profileLength;
  const packageWidthIn = itemWidth ?? profileWidth;
  const packageHeightIn = itemHeight ?? profileHeight;
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
    profileHasWeightDefault: Boolean(profileWeight),
    profileHasDimensionDefaults,
    needsShippingProfile: normalized.usedFallback || !packageWeightOz,
    missingDimensions
  };
}

function rateForWeight(totalWeightOz: number) {
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
  requiredHeightIn: number;
  totalVolumeIn: number;
  totalItemWeightOz: number;
  totalUnits: number;
  requiredProfile: string;
  profileDefinitions: Record<string, ShippingProfileDefinition>;
}) {
  const requiredRank = profileRank(input.profileDefinitions, input.requiredProfile);
  const volumeWithVoidFill = input.totalVolumeIn * 1.2;

  return (
    shippingPackageTiers.find((tier) => {
      const tierVolume = tier.lengthIn * tier.widthIn * tier.heightIn;
      return (
        profileRank(input.profileDefinitions, tier.profileKey) >= requiredRank &&
        tier.lengthIn >= input.requiredLengthIn &&
        tier.widthIn >= input.requiredWidthIn &&
        tier.heightIn >= input.requiredHeightIn &&
        tierVolume >= volumeWithVoidFill &&
        input.totalItemWeightOz + (input.totalUnits > 1 ? tier.packingWeightOz : 0) <= tier.maxWeightOz
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
  let cumulativeHeightIn = 0;
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
    packageProfile =
      cartItems.length === 1 && quantity === 1
        ? profileKey
        : higherRankProfile(profileDefinitions, packageProfile, profileKey);

    if (item.requiresBox) {
      packageProfile = higherRankProfile(profileDefinitions, packageProfile, "small_box");
    }

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
    cumulativeHeightIn += dimensions.height * quantity;
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
  if (totalUnits > 1) {
    packageProfile = higherRankProfile(profileDefinitions, packageProfile, profileForPackedWeight(totalItemWeightOz));
  }

  const requiredLengthIn = maxLengthIn ? roundUpDimension(maxLengthIn + 1) : 0;
  const requiredWidthIn = maxWidthIn ? roundUpDimension(maxWidthIn + 1) : 0;
  const requiredHeightIn =
    maxHeightIn && totalUnits > 1
      ? roundUpDimension(Math.max(maxHeightIn + 1, Math.min(cumulativeHeightIn + 1, maxHeightIn + totalUnits)))
      : maxHeightIn;
  const useSingleItemPackage = !missingDimensions && totalUnits === 1;
  const tier =
    missingDimensions || totalUnits === 0 || useSingleItemPackage
      ? null
      : selectPackageTier({
          requiredLengthIn,
          requiredWidthIn,
          requiredHeightIn,
          totalVolumeIn,
          totalItemWeightOz,
          totalUnits,
          requiredProfile: packageProfile,
          profileDefinitions
        });
  const tierProfile = tier?.profileKey ?? packageProfile;
  const packingWeightOz = tier && totalUnits > 1 ? tier.packingWeightOz : 0;
  const actualWeightOz = roundedWeight(totalItemWeightOz + packingWeightOz);
  const packageLengthIn = useSingleItemPackage ? maxLengthIn : tier?.lengthIn ?? null;
  const packageWidthIn = useSingleItemPackage ? maxWidthIn : tier?.widthIn ?? null;
  const packageHeightIn = useSingleItemPackage ? maxHeightIn : tier?.heightIn ?? null;
  const calculatedDimensionalWeightOz = dimensionalWeightOz(packageLengthIn, packageWidthIn, packageHeightIn);
  const billableWeightOz = Math.max(actualWeightOz, calculatedDimensionalWeightOz);
  const finalPackageProfile = higherRankProfile(
    profileDefinitions,
    higherRankProfile(profileDefinitions, packageProfile, tierProfile),
    profileForPackedWeight(billableWeightOz)
  );

  return {
    totalUnits,
    totalItemWeightOz,
    packingWeightOz,
    actualWeightOz,
    dimensionalWeightOz: calculatedDimensionalWeightOz,
    billableWeightOz,
    packageProfile: finalPackageProfile,
    packageTierKey: useSingleItemPackage ? "single_item_package" : tier?.key ?? "missing_package_data",
    packageTierLabel: useSingleItemPackage ? "Single Item Package" : tier?.label ?? "Missing Package Data",
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
    actualPackedWeightOz: packedPackage.actualWeightOz,
    dimensionalWeightOz: packedPackage.dimensionalWeightOz,
    billableWeightOz: packedPackage.billableWeightOz,
    fallbackProfileUsed: packedPackage.fallbackProfileUsed,
    missingDimensions: packedPackage.missingDimensions,
    cacheRelevantFields: cartItems.map((item) => ({
      id: item.id ?? null,
      quantity: quantityForItem(item),
      shippingProfile: item.shippingProfile ?? null,
      packageWeightOz: item.packageWeightOz ?? null,
      packageLengthIn: item.packageLengthIn ?? null,
      packageWidthIn: item.packageWidthIn ?? null,
      packageHeightIn: item.packageHeightIn ?? null,
      category: item.category ?? null,
      storefrontCategory: item.storefrontCategory ?? null
    }))
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
    shippingOptions,
    defaultShippingOption,
    warnings: [...warnings],
    needsShippingProfile,
    manualReviewRequired,
    localPickupEligible: allPickupEligible
  };
}
