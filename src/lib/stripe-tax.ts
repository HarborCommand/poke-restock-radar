import Stripe from "stripe";

export const DEFAULT_SHIPPING_STRIPE_TAX_CODE = "txcd_92010001";

const STRIPE_TAX_CALCULATION_ID = /^taxcalc_[A-Za-z0-9_]+$/;
const STRIPE_TAX_TRANSACTION_ID = /^tax_[A-Za-z0-9_]+$/;
const STRIPE_TAX_LINE_ITEM_ID = /^tax_li_[A-Za-z0-9_]+$/;

export type StripeTaxAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type StripeTaxLineInput = {
  reference: string;
  amountCents: number;
  quantity: number;
  taxCode: string;
};

export type StripeTaxCalculationInput = {
  currency?: "usd";
  lines: StripeTaxLineInput[];
  destination: StripeTaxAddress;
  shipFrom: StripeTaxAddress;
  shippingCents: number;
  shippingTaxCode?: string;
  customerExempt?: boolean;
};

export type StripeTaxCalculationResult = {
  id: string;
  expiresAt: string;
  merchandiseSubtotalCents: number;
  shippingCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxabilityReason: string;
  providerStatus: "calculated" | "authoritative_zero" | "not_collecting" | "exempt" | "not_taxable";
  jurisdiction: { country: string; state: string; county: string | null };
  breakdown: Array<{
    amountCents: number;
    taxableAmountCents: number;
    country: string | null;
    state: string | null;
    taxType: string | null;
    reason: string | null;
    percentage: string | null;
  }>;
  lines: Array<{
    reference: string;
    calculationLineItemId: string;
    amountCents: number;
    taxCents: number;
    quantity: number;
  }>;
  shippingTaxCents: number;
};

type StripeTaxClient = Pick<Stripe, "tax">;
let stripeTaxTestClient: StripeTaxClient | null = null;

export function setStripeTaxClientForTests(client: StripeTaxClient | null) {
  if (process.env.NODE_ENV === "production") throw new Error("Stripe Tax test adapters are unavailable in production.");
  stripeTaxTestClient = client;
}

export class StripeTaxProviderError extends Error {
  readonly code = "STRIPE_TAX_PROVIDER_UNAVAILABLE";

  constructor(message = "Stripe Tax could not calculate this sale. Retry before completing it.") {
    super(message);
    this.name = "StripeTaxProviderError";
  }
}

function stripeTaxClient(): StripeTaxClient {
  if (stripeTaxTestClient) return stripeTaxTestClient;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeTaxProviderError("Stripe Tax is not configured. Add a test-mode Stripe secret before enabling POS tax.");
  if (process.env.VERCEL_ENV === "preview" && !key.startsWith("sk_test_")) {
    throw new StripeTaxProviderError("Stripe Tax Preview requires test-mode credentials.");
  }
  return new Stripe(key);
}

function positiveCents(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new StripeTaxProviderError(`${label} is invalid.`);
  }
  return value;
}

function stripeTaxCode(value: string, label: string) {
  const normalized = value.trim();
  if (!/^txcd_\d{8}$/.test(normalized)) throw new StripeTaxProviderError(`${label} is invalid.`);
  return normalized;
}

function cleanAddress(address: StripeTaxAddress) {
  const normalized = {
    line1: address.line1.trim(),
    line2: address.line2?.trim() || undefined,
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
    postal_code: address.postalCode.trim(),
    country: address.country.trim().toUpperCase()
  };
  if (!normalized.line1 || !normalized.city || !/^[A-Z]{2}$/.test(normalized.state) || !/^[A-Z]{2}$/.test(normalized.country)) {
    throw new StripeTaxProviderError("A complete verified sale location is required to calculate tax.");
  }
  if (normalized.country === "US" && !/^\d{5}(?:-\d{4})?$/.test(normalized.postal_code)) {
    throw new StripeTaxProviderError("A valid verified ZIP code is required to calculate tax.");
  }
  return normalized;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.length <= 160 ? value : null;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function safeCalculationId(value: unknown) {
  if (typeof value !== "string" || !STRIPE_TAX_CALCULATION_ID.test(value)) {
    throw new StripeTaxProviderError("Stripe Tax returned an invalid calculation reference.");
  }
  return value;
}

export function assertStripeTaxTransactionId(value: string) {
  if (!STRIPE_TAX_TRANSACTION_ID.test(value)) throw new StripeTaxProviderError("The saved Stripe Tax transaction reference is invalid.");
  return value;
}

function calculationStatus(taxCents: number, reasons: string[], customerExempt: boolean): StripeTaxCalculationResult["providerStatus"] {
  if (taxCents > 0) return "calculated";
  if (customerExempt || reasons.includes("customer_exempt")) return "exempt";
  if (reasons.includes("not_collecting")) return "not_collecting";
  if (reasons.some((reason) => ["not_subject_to_tax", "product_exempt"].includes(reason))) return "not_taxable";
  return "authoritative_zero";
}

export async function createStripeTaxCalculation(input: StripeTaxCalculationInput, client: StripeTaxClient = stripeTaxClient()): Promise<StripeTaxCalculationResult> {
  if (!input.lines.length || input.lines.length > 100) throw new StripeTaxProviderError("Stripe Tax requires between 1 and 100 sale lines.");
  const shippingCents = positiveCents(input.shippingCents, "Shipping amount", true);
  const destination = cleanAddress(input.destination);
  const shipFrom = cleanAddress(input.shipFrom);
  const references = new Set<string>();
  const lineItems = input.lines.map((line) => {
    const reference = line.reference.trim();
    if (!reference || reference.length > 500 || references.has(reference)) throw new StripeTaxProviderError("Each Stripe Tax sale line needs a unique reference.");
    references.add(reference);
    return {
      amount: positiveCents(line.amountCents, "Sale line amount"),
      quantity: positiveCents(line.quantity, "Sale line quantity"),
      reference,
      tax_behavior: "exclusive" as const,
      tax_code: stripeTaxCode(line.taxCode, "Product tax code")
    };
  });

  try {
    const calculation = await client.tax.calculations.create({
      currency: input.currency ?? "usd",
      customer_details: {
        address: destination,
        address_source: "shipping",
        taxability_override: input.customerExempt ? "customer_exempt" : "none"
      },
      ship_from_details: { address: shipFrom },
      line_items: lineItems,
      ...(shippingCents > 0 ? {
        shipping_cost: {
          amount: shippingCents,
          tax_behavior: "exclusive",
          tax_code: stripeTaxCode(input.shippingTaxCode ?? DEFAULT_SHIPPING_STRIPE_TAX_CODE, "Shipping tax code")
        }
      } : {}),
      expand: ["line_items"]
    });
    if (calculation.livemode) throw new StripeTaxProviderError("Stripe Tax returned a live-mode calculation in a non-production workflow.");

    const rawBreakdown = Array.isArray(calculation.tax_breakdown) ? calculation.tax_breakdown : [];
    const breakdown = rawBreakdown.slice(0, 100).map((stripeEntry) => {
      const entry = stripeEntry as unknown as Record<string, unknown>;
      const details = entry.tax_rate_details && typeof entry.tax_rate_details === "object"
        ? entry.tax_rate_details as Record<string, unknown>
        : {};
      return {
        amountCents: safeInteger(entry.amount),
        taxableAmountCents: safeInteger(entry.taxable_amount),
        country: safeString(details.country),
        state: safeString(details.state),
        taxType: safeString(details.tax_type),
        reason: safeString(entry.taxability_reason),
        percentage: safeString(details.percentage_decimal)
      };
    });
    const reasons = [...new Set(breakdown.map((entry) => entry.reason).filter((value): value is string => Boolean(value)))];
    const rawLines = calculation.line_items && typeof calculation.line_items === "object" && "data" in calculation.line_items
      ? calculation.line_items.data
      : [];
    const lines = (Array.isArray(rawLines) ? rawLines : []).map((stripeLine) => {
      const line = stripeLine as unknown as Record<string, unknown>;
      const id = safeString(line.id);
      const reference = safeString(line.reference);
      if (!id || !STRIPE_TAX_LINE_ITEM_ID.test(id) || !reference || !references.has(reference)) {
        throw new StripeTaxProviderError("Stripe Tax returned an invalid sale-line reference.");
      }
      return {
        reference,
        calculationLineItemId: id,
        amountCents: safeInteger(line.amount),
        taxCents: safeInteger(line.amount_tax),
        quantity: safeInteger(line.quantity)
      };
    });
    if (lines.length !== lineItems.length) throw new StripeTaxProviderError("Stripe Tax returned an incomplete line-item calculation.");

    const taxCents = safeInteger(calculation.tax_amount_exclusive) + safeInteger(calculation.tax_amount_inclusive);
    const merchandiseSubtotalCents = lineItems.reduce((sum, line) => sum + line.amount, 0);
    const shippingTaxCents = safeInteger(calculation.shipping_cost?.amount_tax);
    const taxableSubtotalCents = breakdown.reduce((sum, entry) => sum + Math.max(0, entry.taxableAmountCents), 0);
    const providerStatus = calculationStatus(taxCents, reasons, Boolean(input.customerExempt));
    const dominant = [...breakdown].sort((left, right) => Math.abs(right.amountCents) - Math.abs(left.amountCents))[0];
    return {
      id: safeCalculationId(calculation.id),
      expiresAt: new Date(safeInteger(calculation.expires_at) * 1000).toISOString(),
      merchandiseSubtotalCents,
      shippingCents,
      taxableSubtotalCents,
      taxCents,
      totalCents: merchandiseSubtotalCents + shippingCents + taxCents,
      taxabilityReason: reasons.join(",") || (taxCents > 0 ? "standard_rated" : "authoritative_zero"),
      providerStatus,
      jurisdiction: {
        country: dominant?.country ?? destination.country,
        state: dominant?.state ?? destination.state,
        county: null
      },
      breakdown,
      lines,
      shippingTaxCents
    };
  } catch (error) {
    if (error instanceof StripeTaxProviderError) throw error;
    throw new StripeTaxProviderError();
  }
}

export async function recordStripeTaxTransaction(input: {
  calculationId: string;
  saleReference: string;
  postedAt: Date;
  workspaceReference: string;
}, client: StripeTaxClient = stripeTaxClient()) {
  const calculationId = safeCalculationId(input.calculationId);
  const reference = input.saleReference.trim();
  if (!reference || reference.length > 500) throw new StripeTaxProviderError("The POS sale reference is invalid.");
  try {
    const transaction = await client.tax.transactions.createFromCalculation({
      calculation: calculationId,
      reference,
      posted_at: Math.floor(input.postedAt.getTime() / 1000),
      metadata: { channel: "pos", workspace_ref: input.workspaceReference.slice(0, 64) },
      expand: ["line_items"]
    }, { idempotencyKey: `tax-transaction:${reference}` });
    if (transaction.livemode) throw new StripeTaxProviderError("Stripe Tax returned a live-mode transaction in a non-production workflow.");
    if (transaction.reference !== reference) throw new StripeTaxProviderError("Stripe Tax returned an inconsistent sale reference.");
    const id = assertStripeTaxTransactionId(String(transaction.id));
    const rawLines = transaction.line_items && typeof transaction.line_items === "object" && "data" in transaction.line_items
      ? transaction.line_items.data
      : [];
    const lineItems = (Array.isArray(rawLines) ? rawLines : []).map((stripeLine) => {
      const line = stripeLine as unknown as Record<string, unknown>;
      const id = safeString(line.id);
      const lineReference = safeString(line.reference);
      if (!id || !STRIPE_TAX_LINE_ITEM_ID.test(id) || !lineReference) {
        throw new StripeTaxProviderError("Stripe Tax returned an invalid transaction line.");
      }
      return {
        id,
        reference: lineReference,
        amountCents: safeInteger(line.amount),
        taxCents: safeInteger(line.amount_tax)
      };
    });
    const shippingCents = safeInteger(transaction.shipping_cost?.amount);
    const shippingTaxCents = safeInteger(transaction.shipping_cost?.amount_tax);
    const merchandiseAmountCents = lineItems.reduce((sum, line) => sum + line.amountCents, 0);
    const merchandiseTaxCents = lineItems.reduce((sum, line) => sum + line.taxCents, 0);
    return {
      id,
      lineItems,
      merchandiseAmountCents,
      merchandiseTaxCents,
      shippingCents,
      shippingTaxCents,
      taxCents: merchandiseTaxCents + shippingTaxCents,
      totalCents: merchandiseAmountCents + shippingCents + merchandiseTaxCents + shippingTaxCents
    };
  } catch (error) {
    if (error instanceof StripeTaxProviderError) throw error;
    throw new StripeTaxProviderError("The sale was saved, but its Stripe Tax transaction is awaiting reconciliation. Retry the same sale reference.");
  }
}

export async function reverseStripeTaxTransaction(input: {
  originalTransactionId: string;
  reversalReference: string;
  mode: "full" | "partial";
  lineItems?: Array<{
    originalLineItemId: string;
    reference: string;
    amountCents: number;
    taxCents: number;
    quantity?: number;
  }>;
  flatAmountCents?: number;
}, client: StripeTaxClient = stripeTaxClient()) {
  const originalTransactionId = assertStripeTaxTransactionId(input.originalTransactionId);
  const reference = input.reversalReference.trim();
  if (!reference || reference.length > 500) throw new StripeTaxProviderError("The Stripe Tax reversal reference is invalid.");
  const lineItems = input.mode === "partial" ? (input.lineItems ?? []).map((line) => {
    if (!STRIPE_TAX_LINE_ITEM_ID.test(line.originalLineItemId)) throw new StripeTaxProviderError("A saved Stripe Tax line reference is invalid.");
    return {
      amount: -positiveCents(line.amountCents, "Reversal merchandise amount"),
      amount_tax: -positiveCents(line.taxCents, "Reversal tax amount", true),
      original_line_item: line.originalLineItemId,
      reference: line.reference.slice(0, 500),
      ...(line.quantity ? { quantity: positiveCents(line.quantity, "Reversal quantity") } : {})
    };
  }) : undefined;
  const flatAmountCents = input.mode === "partial" && !lineItems?.length
    ? positiveCents(input.flatAmountCents ?? 0, "Partial reversal amount")
    : null;
  try {
    const transaction = await client.tax.transactions.createReversal({
      mode: input.mode,
      original_transaction: originalTransactionId,
      reference,
      ...(lineItems ? { line_items: lineItems } : {}),
      ...(flatAmountCents ? { flat_amount: -flatAmountCents } : {}),
      metadata: { channel: "pos_refund" }
    }, { idempotencyKey: `tax-reversal:${reference}` });
    if (transaction.livemode) throw new StripeTaxProviderError("Stripe Tax returned a live-mode reversal in a non-production workflow.");
    if (transaction.reference !== reference || transaction.reversal?.original_transaction !== originalTransactionId) {
      throw new StripeTaxProviderError("Stripe Tax returned an inconsistent reversal reference.");
    }
    return { id: assertStripeTaxTransactionId(String(transaction.id)) };
  } catch (error) {
    if (error instanceof StripeTaxProviderError) throw error;
    throw new StripeTaxProviderError("Stripe Tax could not record this reversal. No internal refund was finalized; retry safely.");
  }
}

export async function getStripeTaxRegistrationStatus(country: string, state: string, client: StripeTaxClient = stripeTaxClient()) {
  try {
    const registrations = await client.tax.registrations.list({ status: "active", limit: 100 });
    const normalizedCountry = country.trim().toUpperCase();
    const normalizedState = state.trim().toUpperCase();
    const active = registrations.data.some((stripeRegistration) => {
      const registration = stripeRegistration as unknown as Record<string, unknown>;
      if (safeString(registration.country)?.toUpperCase() !== normalizedCountry || safeString(registration.status) !== "active") return false;
      const options = registration.country_options && typeof registration.country_options === "object"
        ? registration.country_options as Record<string, unknown>
        : {};
      const us = options.us && typeof options.us === "object" ? options.us as Record<string, unknown> : {};
      return normalizedCountry !== "US" || safeString(us.state)?.toUpperCase() === normalizedState;
    });
    return { status: active ? "active" as const : "inactive" as const };
  } catch {
    return { status: "unknown" as const };
  }
}

export type StripeTaxProviderReadiness = {
  reachable: boolean;
  registrationStatus: "active" | "pending" | "missing" | "unknown";
  registrationEffectiveDate: string | null;
  requestId: string | null;
  checkedAt: string;
};

function safeStripeRequestId(value: unknown) {
  return typeof value === "string" && /^req_[A-Za-z0-9_]+$/.test(value) ? value.slice(0, 120) : null;
}

function safeRegistrationDate(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export async function checkStripeTaxProviderReadiness(
  country: string,
  state: string,
  client: StripeTaxClient = stripeTaxClient()
): Promise<StripeTaxProviderReadiness> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await client.tax.registrations.list({ limit: 100 });
    const normalizedCountry = country.trim().toUpperCase();
    const normalizedState = state.trim().toUpperCase();
    const registrations = response.data
      .map((value) => value as unknown as Record<string, unknown>)
      .filter((registration) => {
        if (safeString(registration.country)?.toUpperCase() !== normalizedCountry) return false;
        if (normalizedCountry !== "US") return true;
        const options = registration.country_options && typeof registration.country_options === "object"
          ? registration.country_options as Record<string, unknown>
          : {};
        const us = options.us && typeof options.us === "object" ? options.us as Record<string, unknown> : {};
        return safeString(us.state)?.toUpperCase() === normalizedState;
      });
    const active = registrations.find((registration) => safeString(registration.status) === "active");
    const pending = registrations.find((registration) => ["pending", "scheduled"].includes(safeString(registration.status) ?? ""));
    const registration = active ?? pending;
    const lastResponse = (response as unknown as { lastResponse?: { requestId?: unknown } }).lastResponse;
    return {
      reachable: true,
      registrationStatus: active ? "active" : pending ? "pending" : "missing",
      registrationEffectiveDate: safeRegistrationDate(registration?.active_from),
      requestId: safeStripeRequestId(lastResponse?.requestId),
      checkedAt
    };
  } catch {
    return {
      reachable: false,
      registrationStatus: "unknown",
      registrationEffectiveDate: null,
      requestId: null,
      checkedAt
    };
  }
}
