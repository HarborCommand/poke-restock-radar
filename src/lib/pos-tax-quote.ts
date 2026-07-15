import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const POS_TAX_QUOTE_VERSION = 1;
const POS_TAX_QUOTE_TTL_MS = 5 * 60 * 1000;
const LOCAL_QUOTE_SECRET = "local-pos-tax-quote-secret-change-before-sharing";

type PosTaxQuoteTokenPayload = {
  version: number;
  userBinding: string;
  fingerprint: string;
  expiresAt: number;
};

export class PosTaxQuoteConflictError extends Error {
  readonly code = "POS_TAX_QUOTE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "PosTaxQuoteConflictError";
  }
}

export type PosTaxFingerprintInput = {
  userId: string;
  idempotencyKey: string;
  selectedCustomerAccountId: string | null;
  fulfillmentMode: "in_person";
  taxExempt: boolean;
  taxExemptReason: string | null;
  taxExemptionReference: string | null;
  items: Array<{
    inventoryItemId: string;
    quantity: number;
    originalUnitPriceCents: number;
    adjustedUnitPriceCents: number;
    discountReason: string | null;
    taxable: boolean;
    taxCategory: string;
  }>;
  profile: {
    runtimeEnabled: boolean;
    profileEnabled: boolean;
    country: string;
    state: string;
    county: string | null;
    stateRateBasisPoints: number;
    countyRateBasisPoints: number;
    effectiveAt: string | null;
    sourceNote: string | null;
  };
};

function quoteSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new Error("POS tax quote signing is unavailable.");
  }
  return secret || LOCAL_QUOTE_SECRET;
}

function sign(body: string) {
  return createHmac("sha256", quoteSecret()).update(`pos-tax-quote:${body}`).digest("base64url");
}

function bindUser(userId: string) {
  return createHmac("sha256", quoteSecret()).update(`pos-tax-quote-user:${userId}`).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function posTaxCartFingerprint(input: PosTaxFingerprintInput) {
  const canonical = {
    ...input,
    idempotencyKey: input.idempotencyKey.trim(),
    selectedCustomerAccountId: input.selectedCustomerAccountId?.trim() || null,
    taxExemptReason: input.taxExemptReason?.trim() || null,
    taxExemptionReference: input.taxExemptionReference?.trim() || null,
    items: [...input.items]
      .map((item) => ({ ...item, discountReason: item.discountReason?.trim() || null }))
      .sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId))
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url");
}

export function createPosTaxQuoteToken(userId: string, fingerprint: string, now = Date.now()) {
  const payload: PosTaxQuoteTokenPayload = {
    version: POS_TAX_QUOTE_VERSION,
    userBinding: bindUser(userId),
    fingerprint,
    expiresAt: now + POS_TAX_QUOTE_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    quoteId: `${body}.${sign(body)}`,
    quoteVersion: POS_TAX_QUOTE_VERSION,
    cartFingerprint: fingerprint,
    expiresAt: new Date(payload.expiresAt).toISOString()
  };
}

export function verifyPosTaxQuoteToken(token: string, userId: string, now = Date.now()) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !safeEqual(signature, sign(body))) {
    throw new PosTaxQuoteConflictError("POS tax quote is invalid. Refresh the tax calculation before completing the sale.");
  }

  let payload: PosTaxQuoteTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PosTaxQuoteTokenPayload;
  } catch {
    throw new PosTaxQuoteConflictError("POS tax quote is invalid. Refresh the tax calculation before completing the sale.");
  }

  const maximumExpiration = now + POS_TAX_QUOTE_TTL_MS + 60_000;
  if (
    payload.version !== POS_TAX_QUOTE_VERSION ||
    typeof payload.userBinding !== "string" ||
    !safeEqual(payload.userBinding, bindUser(userId)) ||
    !/^[A-Za-z0-9_-]{40,60}$/.test(payload.fingerprint) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt > maximumExpiration
  ) {
    throw new PosTaxQuoteConflictError("POS tax quote is invalid. Refresh the tax calculation before completing the sale.");
  }
  if (payload.expiresAt <= now) {
    throw new PosTaxQuoteConflictError("POS tax quote expired. Refresh the tax calculation before completing the sale.");
  }
  return payload;
}

export function assertPosTaxQuoteMatches(payload: PosTaxQuoteTokenPayload, fingerprint: string) {
  if (!safeEqual(payload.fingerprint, fingerprint)) {
    throw new PosTaxQuoteConflictError("POS tax quote is stale. Refresh the tax calculation before completing the sale.");
  }
}
