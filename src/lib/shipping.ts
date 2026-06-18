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
  item: Pick<ShippingCartItem, "shippingProfile" | "packageWeightOz">,
  profileDefinitions: Record<string, ShippingProfileDefinition> = shippingProfiles
) {
  const normalized = String(item.shippingProfile || "").trim().toLowerCase();
  return !normalized || normalized === "standard" || normalizeShippingProfile(item.shippingProfile, profileDefinitions).usedFallback || !positiveNumber(item.packageWeightOz);
}

function rateForWeight(totalWeightOz: number) {
  if (totalWeightOz <= 8) return { amount: 4.99, label: "Standard Shipping", manualReview: false };
  if (totalWeightOz <= 16) return { amount: 5.99, label: "Standard Shipping", manualReview: false };
  if (totalWeightOz <= 32) return { amount: 7.99, label: "Boxed Shipping", manualReview: false };
  if (totalWeightOz <= 80) return { amount: 9.99, label: "Boxed Shipping", manualReview: false };
  return { amount: 12.99, label: "Heavy Package Shipping", manualReview: true };
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
  const profileDefinitions: Record<string, ShippingProfileDefinition> = {
    ...shippingProfiles,
    ...(options.profileDefinitions ?? {})
  };
  const cartItems = items.filter((item) => quantityForItem(item) > 0);
  const warnings = new Set<string>();
  let totalWeightOz = 0;
  let packageProfile: string = safeFallbackProfile;
  let needsShippingProfile = false;
  let manualReviewRequired = false;

  for (const item of cartItems) {
    const quantity = quantityForItem(item);
    const normalized = normalizeShippingProfile(item.shippingProfile, profileDefinitions);
    const profile = profileDefinitions[normalized.profile] ?? shippingProfiles[safeFallbackProfile];
    const itemWeight = positiveNumber(item.packageWeightOz);
    const fallbackNeeded = normalized.usedFallback || itemNeedsShippingProfile(item, profileDefinitions);

    if (fallbackNeeded) {
      needsShippingProfile = true;
      warnings.add("One or more items need a shipping profile; using a safe small-box fallback.");
    }

    totalWeightOz += (itemWeight ?? profile.defaultWeightOz) * quantity;

    if (profile.rank > (profileDefinitions[packageProfile] ?? shippingProfiles[safeFallbackProfile]).rank) {
      packageProfile = normalized.profile;
    }

    if (item.requiresBox && shippingProfiles.small_box.rank > (profileDefinitions[packageProfile] ?? shippingProfiles[safeFallbackProfile]).rank) {
      packageProfile = "small_box";
    }

    if (item.insuranceRecommended || profile.insuranceRecommended) {
      warnings.add("Insurance is recommended for one or more items.");
    }
  }

  totalWeightOz = roundedWeight(totalWeightOz);
  const allPickupEligible = cartItems.length > 0 && cartItems.every((item) => (item.localPickupEligible ?? item.localPickupAvailable) === true);
  const allShippingAvailable = cartItems.length > 0 && cartItems.every((item) => item.shippingAvailable !== false);
  const freeShippingUnlocked =
    typeof options.subtotal === "number" &&
    typeof options.freeShippingThreshold === "number" &&
    options.freeShippingThreshold > 0 &&
    options.subtotal >= options.freeShippingThreshold;
  const packageDefinition = profileDefinitions[packageProfile] ?? shippingProfiles[safeFallbackProfile];
  const singleCartItem = cartItems.length === 1 ? cartItems[0] : null;
  const packageLengthIn = packageDimension(singleCartItem?.packageLengthIn) ?? packageDimension(packageDefinition.packageLengthIn);
  const packageWidthIn = packageDimension(singleCartItem?.packageWidthIn) ?? packageDimension(packageDefinition.packageWidthIn);
  const packageHeightIn = packageDimension(singleCartItem?.packageHeightIn) ?? packageDimension(packageDefinition.packageHeightIn);
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
