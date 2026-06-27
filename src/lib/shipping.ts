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
  packageProfile: string;
  packageProfileLabel: string;
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

export const shippingProfiles: Record<ShippingProfileKey, ShippingProfileDefinition> = {
  single_card_or_light_item: {
    label: "Single Card or Light Item",
    defaultWeightOz: 4,
    rank: 1,
    requiresBox: false,
    insuranceRecommended: false
  },
  sealed_pack_small: {
    label: "Sealed Pack Small",
    defaultWeightOz: 8,
    rank: 2,
    requiresBox: false,
    insuranceRecommended: false
  },
  small_box: {
    label: "Small Box",
    defaultWeightOz: 16,
    rank: 3,
    requiresBox: true,
    insuranceRecommended: false
  },
  medium_box: {
    label: "Medium Box",
    defaultWeightOz: 32,
    rank: 4,
    requiresBox: true,
    insuranceRecommended: false
  },
  large_box: {
    label: "Large Box",
    defaultWeightOz: 80,
    rank: 5,
    requiresBox: true,
    insuranceRecommended: true
  },
  heavy_box: {
    label: "Heavy Box",
    defaultWeightOz: 96,
    rank: 6,
    requiresBox: true,
    insuranceRecommended: true
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

function shippingProfileDefinitionMap(profileDefinitions: Record<string, ShippingProfileDefinition>): Record<string, ShippingProfileDefinition> {
  return {
    ...shippingProfiles,
    ...profileDefinitions
  };
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

function categoryAwareFallbackProfile(
  item: Pick<ShippingCartItem, "category" | "storefrontCategory" | "title" | "itemName">
): ShippingProfileKey {
  const signals = [item.storefrontCategory, item.category, item.title, item.itemName]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (/\b(single|graded|raw)\s+cards?\b/.test(signals)) return "single_card_or_light_item";
  if (/\b(booster\s+boxes?|ultra[-\s]?premium|premium\s+collections?|collection\s+boxes?)\b/.test(signals)) return "large_box";
  if (/\b(elite\s+trainer|etbs?|booster\s+bundles?|tins?)\b/.test(signals)) return "medium_box";
  if (/\b(blisters?|checklane|sleeved\s+boosters?|sealed\s+packs?|packs?)\b/.test(signals)) return "sealed_pack_small";
  return safeFallbackProfile;
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
  const profileKey = normalized.usedFallback ? categoryAwareFallbackProfile(item) : normalized.profile;
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

function packingMaterialWeightOz(totalUnits: number) {
  if (totalUnits <= 1) return 0;
  return roundedWeight(Math.min(8, 2 + (totalUnits - 1) * 0.5));
}

function orientedDimensions(lengthIn: number | null, widthIn: number | null, heightIn: number | null) {
  if (!lengthIn || !widthIn || !heightIn) return null;
  const [length, width, height] = [lengthIn, widthIn, heightIn].sort((left, right) => right - left);
  return { length, width, height };
}

function packedDimension(value: number, totalUnits: number) {
  return packageDimension(totalUnits > 1 ? value + 0.5 : value);
}

function packedCartPackage(
  cartItems: ShippingCartItem[],
  profileDefinitions: Record<string, ShippingProfileDefinition>
) {
  let totalUnits = 0;
  let totalWeightOz = 0;
  let packageProfile: string = safeFallbackProfile;
  let missingDimensions = false;
  let maxLengthIn = 0;
  let maxWidthIn = 0;
  let stackedHeightIn = 0;

  for (const item of cartItems) {
    const quantity = quantityForItem(item);
    const effectivePackage = effectiveShippingPackageData(item, profileDefinitions);
    const fallbackNeeded = effectivePackage.needsShippingProfile;
    const profileKey = effectivePackage.profileKey;
    const profileWeightOz = effectivePackage.packageWeightOz ?? shippingProfiles[safeFallbackProfile].defaultWeightOz;
    const dimensions = orientedDimensions(
      effectivePackage.packageLengthIn,
      effectivePackage.packageWidthIn,
      effectivePackage.packageHeightIn
    );

    totalUnits += quantity;
    totalWeightOz += profileWeightOz * quantity;
    packageProfile =
      cartItems.length === 1 && quantity === 1
        ? profileKey
        : higherRankProfile(profileDefinitions, packageProfile, profileKey);

    if (item.requiresBox) {
      packageProfile = higherRankProfile(profileDefinitions, packageProfile, "small_box");
    }

    if (!dimensions) {
      missingDimensions = true;
      continue;
    }

    maxLengthIn = Math.max(maxLengthIn, dimensions.length);
    maxWidthIn = Math.max(maxWidthIn, dimensions.width);
    stackedHeightIn += dimensions.height * quantity;
  }

  totalWeightOz = roundedWeight(totalWeightOz + packingMaterialWeightOz(totalUnits));
  if (totalUnits > 1) {
    packageProfile = higherRankProfile(profileDefinitions, packageProfile, profileForPackedWeight(totalWeightOz));
  }

  return {
    totalUnits,
    totalWeightOz,
    packageProfile,
    packageLengthIn: missingDimensions || totalUnits === 0 ? null : packedDimension(maxLengthIn, totalUnits),
    packageWidthIn: missingDimensions || totalUnits === 0 ? null : packedDimension(maxWidthIn, totalUnits),
    packageHeightIn: missingDimensions || totalUnits === 0 ? null : packedDimension(stackedHeightIn, totalUnits)
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
  const totalWeightOz = packedPackage.totalWeightOz;
  const packageProfile = packedPackage.packageProfile;
  const packageDefinition = profileDefinitions[packageProfile] ?? shippingProfiles[safeFallbackProfile];
  const packageLengthIn = packedPackage.packageLengthIn;
  const packageWidthIn = packedPackage.packageWidthIn;
  const packageHeightIn = packedPackage.packageHeightIn;
  if (allShippingAvailable && (!packageLengthIn || !packageWidthIn || !packageHeightIn)) {
    warnings.add("Package dimensions are missing; using fallback shipping until package size is complete.");
  }
  const baseRate = rateForWeight(totalWeightOz);
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
    packageProfile,
    packageProfileLabel: packageDefinition.label,
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
