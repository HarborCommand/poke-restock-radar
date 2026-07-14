export const TAX_PROVIDER_VALUES = ["stripe_tax", "configured_pos_rate", "historical_unknown", "exempt"] as const;
export type TaxProvider = (typeof TAX_PROVIDER_VALUES)[number];

export const TAX_STATUS_VALUES = ["calculated", "collected", "refunded", "partially_refunded", "exempt", "not_recorded"] as const;
export type TaxStatus = (typeof TAX_STATUS_VALUES)[number];

export const TAX_CATEGORY_VALUES = ["general_tangible_goods"] as const;
export type TaxCategory = (typeof TAX_CATEGORY_VALUES)[number];

export const DEFAULT_TAX_CATEGORY: TaxCategory = "general_tangible_goods";
export const DEFAULT_STRIPE_TAX_CODE = "txcd_99999999";
export const ONLINE_STRIPE_TAX_FLAG = "ONLINE_STRIPE_TAX_ENABLED";
export const POS_SALES_TAX_FLAG = "POS_SALES_TAX_ENABLED";
export const TAX_EXEMPT_SALES_FLAG = "TAX_EXEMPT_SALES_ENABLED";
export const TAX_REPORTING_FLAG = "TAX_REPORTING_ENABLED";

export function taxFeatureConfig(env: Record<string, string | undefined> = process.env) {
  return {
    onlineStripeTaxEnabled: env[ONLINE_STRIPE_TAX_FLAG]?.trim().toLowerCase() === "true",
    posSalesTaxEnabled: env[POS_SALES_TAX_FLAG]?.trim().toLowerCase() === "true",
    taxExemptSalesEnabled: env[TAX_EXEMPT_SALES_FLAG]?.trim().toLowerCase() === "true",
    taxReportingEnabled: env[TAX_REPORTING_FLAG]?.trim().toLowerCase() === "true"
  };
}

export function moneyToCents(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.round(value * 100));
}

export function centsToMoney(cents: number | null | undefined) {
  if (typeof cents !== "number" || !Number.isInteger(cents)) return 0;
  return cents / 100;
}

export function nonnegativeCents(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(0, value) : 0;
}

export function validBasisPoints(value: number | null | undefined, maximum = 10_000) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function roundRatioHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator <= 0n) return 0;
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = whole + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Tax amount exceeds the supported range.");
  return Number(rounded);
}

/** Florida TIP 21A01-02: carry through the third decimal and round up when it is greater than 4. */
export function floridaRoundTaxCents(taxableSubtotalCents: number, rateBasisPoints: number) {
  if (!Number.isSafeInteger(taxableSubtotalCents) || taxableSubtotalCents < 0) throw new Error("Taxable subtotal must be nonnegative integer cents.");
  if (!validBasisPoints(rateBasisPoints)) throw new Error("Tax rate must be valid integer basis points.");
  return roundRatioHalfUp(BigInt(taxableSubtotalCents) * BigInt(rateBasisPoints), 10_000n);
}

export type PosTaxProfile = {
  country: string;
  state: string;
  county: string | null;
  stateRateBasisPoints: number;
  countyRateBasisPoints: number;
  effectiveAt: Date | null;
  sourceNote: string | null;
  enabled: boolean;
};

export function calculateConfiguredPosTax(input: {
  subtotalCents: number;
  discountCents?: number;
  taxableSubtotalCents?: number;
  profile: PosTaxProfile;
  exempt?: boolean;
}) {
  const subtotalCents = nonnegativeCents(input.subtotalCents);
  const discountCents = Math.min(subtotalCents, nonnegativeCents(input.discountCents));
  const merchandiseNetCents = subtotalCents - discountCents;
  const taxableSubtotalCents = input.taxableSubtotalCents === undefined
    ? merchandiseNetCents
    : Math.min(merchandiseNetCents, nonnegativeCents(input.taxableSubtotalCents));
  const stateRateBasisPoints = input.profile.stateRateBasisPoints;
  const countyRateBasisPoints = input.profile.countyRateBasisPoints;
  if (!validBasisPoints(stateRateBasisPoints, 2_000) || !validBasisPoints(countyRateBasisPoints, 2_000)) {
    throw new Error("Configured tax rates must be integer basis points between 0 and 2000.");
  }
  const combinedRateBasisPoints = stateRateBasisPoints + countyRateBasisPoints;
  if (combinedRateBasisPoints > 2_000) throw new Error("Combined configured tax rate cannot exceed 20%.");
  const exempt = Boolean(input.exempt);
  const totalTaxCents = exempt ? 0 : floridaRoundTaxCents(taxableSubtotalCents, combinedRateBasisPoints);
  const roundedStateTaxCents = exempt ? 0 : floridaRoundTaxCents(taxableSubtotalCents, stateRateBasisPoints);
  const stateTaxCents = Math.min(totalTaxCents, roundedStateTaxCents);
  const countySurtaxCents = totalTaxCents - stateTaxCents;
  return {
    subtotalCents,
    discountCents,
    taxableSubtotalCents,
    stateTaxCents,
    countySurtaxCents,
    taxCents: totalTaxCents,
    totalCents: merchandiseNetCents + totalTaxCents,
    combinedRateBasisPoints
  };
}

export function allocateCentsByWeight(totalCents: number, weights: number[]) {
  const total = nonnegativeCents(totalCents);
  const safeWeights = weights.map(nonnegativeCents);
  const weightTotal = safeWeights.reduce((sum, value) => sum + value, 0);
  if (!safeWeights.length) return [];
  if (total === 0 || weightTotal === 0) return safeWeights.map(() => 0);
  const denominator = BigInt(weightTotal);
  const rows = safeWeights.map((weight, index) => {
    const numerator = BigInt(total) * BigInt(weight);
    return { index, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.cents, 0);
  for (const row of [...rows].sort((left, right) => (left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1))) {
    if (remaining <= 0) break;
    row.cents += 1;
    remaining -= 1;
  }
  return rows.sort((left, right) => left.index - right.index).map((row) => row.cents);
}

export function cumulativeRefundedTaxCents(input: {
  originalTaxCents: number | null | undefined;
  originalTotalCents: number | null | undefined;
  cumulativeRefundedAmountCents: number;
}) {
  if (input.originalTaxCents === null || input.originalTaxCents === undefined || input.originalTotalCents === null || input.originalTotalCents === undefined) {
    return null;
  }
  const taxCents = nonnegativeCents(input.originalTaxCents);
  const totalCents = nonnegativeCents(input.originalTotalCents);
  const refundedCents = Math.min(totalCents, nonnegativeCents(input.cumulativeRefundedAmountCents));
  if (taxCents === 0 || totalCents === 0 || refundedCents === 0) return 0;
  if (refundedCents >= totalCents) return taxCents;
  return Math.min(taxCents, roundRatioHalfUp(BigInt(taxCents) * BigInt(refundedCents), BigInt(totalCents)));
}

export function normalizeStripeTaxCode(value: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const allowed = new Set([
    DEFAULT_STRIPE_TAX_CODE,
    ...(env.STRIPE_ALLOWED_PRODUCT_TAX_CODES ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^txcd_\d{8}$/.test(entry))
  ]);
  const candidate = value?.trim() || DEFAULT_STRIPE_TAX_CODE;
  return allowed.has(candidate) ? candidate : null;
}

export function safeTaxBreakdownJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const safe = {
    country: typeof source.country === "string" ? source.country.slice(0, 2).toUpperCase() : null,
    state: typeof source.state === "string" ? source.state.slice(0, 32) : null,
    county: typeof source.county === "string" ? source.county.slice(0, 80) : null,
    jurisdiction: typeof source.jurisdiction === "string" ? source.jurisdiction.slice(0, 120) : null,
    rateBasisPoints: validBasisPoints(source.rateBasisPoints as number) ? source.rateBasisPoints : null,
    amountCents: Number.isInteger(source.amountCents) ? nonnegativeCents(source.amountCents as number) : null
  };
  return JSON.stringify(safe);
}
