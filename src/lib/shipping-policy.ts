import { rateForWeight, type ShippingCalculation } from "@/lib/shipping";
import type { NormalizedShippingQuote } from "@/lib/shipping-rate-provider";

function centsFromMoney(value: number) {
  return Math.round(value * 100);
}

type MerchantShippingFulfillmentMethod = "shipping" | "pickup" | "local_pickup";

const merchantShippingFloorCents = {
  small: 799,
  normal: 999,
  large: 1299,
  veryLarge: 1499
} as const;

const largePackageTierKeys = new Set(["box_16x12x8", "box_18x12x8"]);
const veryLargePackageTierKeys = new Set(["box_20x14x10", "box_22x16x14"]);

function policyWeightOz(shippingCalculation: ShippingCalculation) {
  return Math.max(
    shippingCalculation.actualWeightOz,
    shippingCalculation.billableWeightOz,
    shippingCalculation.totalWeightOz
  );
}

function packageTierFloorCents(packageTierKey: string | null | undefined) {
  if (!packageTierKey) return null;
  if (veryLargePackageTierKeys.has(packageTierKey)) return merchantShippingFloorCents.veryLarge;
  if (largePackageTierKeys.has(packageTierKey)) return merchantShippingFloorCents.large;
  return null;
}

export function getMerchantShippingFloor(
  shippingCalculation: ShippingCalculation,
  options: { fulfillmentMethod?: MerchantShippingFulfillmentMethod } = {}
) {
  if (options.fulfillmentMethod === "pickup" || options.fulfillmentMethod === "local_pickup") return 0;

  const totalUnits = Math.max(0, Math.floor(shippingCalculation.totalUnits));
  const weightOz = policyWeightOz(shippingCalculation);
  if (totalUnits <= 0 && weightOz <= 0) return null;

  const tierFloor = packageTierFloorCents(shippingCalculation.packageTierKey);
  if (totalUnits >= 10 || weightOz > 96 || tierFloor === merchantShippingFloorCents.veryLarge) {
    return merchantShippingFloorCents.veryLarge;
  }
  if (totalUnits >= 6 || weightOz >= 48 || tierFloor === merchantShippingFloorCents.large) {
    return merchantShippingFloorCents.large;
  }
  if (totalUnits >= 3 || weightOz >= 24) return merchantShippingFloorCents.normal;
  return merchantShippingFloorCents.small;
}

export function merchantMinimumShippingCents(shippingCalculation: ShippingCalculation) {
  const standardOption =
    shippingCalculation.shippingOptions.find((option) => option.id !== "local_pickup") ?? shippingCalculation.defaultShippingOption;
  if (!standardOption || standardOption.id === "local_pickup" || standardOption.amount <= 0) return null;
  const configuredOptionCents = centsFromMoney(standardOption.amount);
  const serverWeightFloorCents = centsFromMoney(rateForWeight(shippingCalculation.billableWeightOz).amount);
  const tieredFloorCents = getMerchantShippingFloor(shippingCalculation);
  return Math.max(configuredOptionCents, serverWeightFloorCents, tieredFloorCents ?? 0);
}

export function applyMerchantShippingPolicyToCarrierQuote(
  quote: NormalizedShippingQuote,
  shippingCalculation: ShippingCalculation
): {
  quote: NormalizedShippingQuote;
  policyApplied: boolean;
  baseAmountCents: number;
  minimumAmountCents: number | null;
} {
  const minimumAmountCents = merchantMinimumShippingCents(shippingCalculation);
  if (quote.fallbackUsed || quote.provider !== "shippo" || minimumAmountCents === null || quote.amountCents >= minimumAmountCents) {
    return {
      quote,
      policyApplied: false,
      baseAmountCents: quote.amountCents,
      minimumAmountCents
    };
  }

  return {
    quote: {
      ...quote,
      amountCents: minimumAmountCents
    },
    policyApplied: true,
    baseAmountCents: quote.amountCents,
    minimumAmountCents
  };
}
