import { rateForWeight, type ShippingCalculation } from "@/lib/shipping";
import type { NormalizedShippingQuote } from "@/lib/shipping-rate-provider";

function centsFromMoney(value: number) {
  return Math.round(value * 100);
}

export function merchantMinimumShippingCents(shippingCalculation: ShippingCalculation) {
  const standardOption =
    shippingCalculation.shippingOptions.find((option) => option.id !== "local_pickup") ?? shippingCalculation.defaultShippingOption;
  if (!standardOption || standardOption.id === "local_pickup" || standardOption.amount <= 0) return null;
  const configuredOptionCents = centsFromMoney(standardOption.amount);
  const serverWeightFloorCents = centsFromMoney(rateForWeight(shippingCalculation.billableWeightOz).amount);
  return Math.max(configuredOptionCents, serverWeightFloorCents);
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
