const SQUARE_API_ORIGIN = "https://connect.squareup.com";
const SQUARE_API_VERSION = "2026-07-15";
const SQUARE_PAYMENT_REFERENCE_PREFIX = "square:";

export type SquarePosPublicConfig = {
  enabled: boolean;
  applicationId: string | null;
  locationId: string | null;
  callbackUrl: string;
};

type SquareMoney = {
  amount?: number;
  currency?: string;
};

type SquareOrderResponse = {
  order?: {
    id?: string;
    location_id?: string;
    tenders?: Array<{
      id?: string;
      payment_id?: string;
    }>;
  };
  errors?: Array<{ code?: string; detail?: string }>;
};

type SquarePaymentResponse = {
  payment?: {
    id?: string;
    status?: string;
    source_type?: string;
    location_id?: string;
    order_id?: string;
    amount_money?: SquareMoney;
    total_money?: SquareMoney;
    receipt_number?: string;
    card_details?: {
      status?: string;
      entry_method?: string;
      card?: {
        card_brand?: string;
        last_4?: string;
      };
    };
  };
  errors?: Array<{ code?: string; detail?: string }>;
};

export type VerifiedSquarePosPayment = {
  transactionId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  locationId: string;
  receiptNumber: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
};

function envValue(name: string) {
  return String(process.env[name] || "").trim();
}

function configuredCallbackUrl() {
  return envValue("SQUARE_POS_CALLBACK_URL") || "https://www.gamedaygrabs.com/pos";
}

export function getSquarePosPublicConfig(): SquarePosPublicConfig {
  const applicationId = envValue("SQUARE_APPLICATION_ID");
  const locationId = envValue("SQUARE_LOCATION_ID");
  const accessToken = envValue("SQUARE_ACCESS_TOKEN");
  return {
    enabled: Boolean(applicationId && locationId && accessToken),
    applicationId: applicationId || null,
    locationId: locationId || null,
    callbackUrl: configuredCallbackUrl()
  };
}

export function parseSquarePaymentReference(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized.toLowerCase().startsWith(SQUARE_PAYMENT_REFERENCE_PREFIX)) return null;
  const transactionId = normalized.slice(SQUARE_PAYMENT_REFERENCE_PREFIX.length).trim();
  if (!transactionId || transactionId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(transactionId)) return null;
  return transactionId;
}

function squareErrorMessage(payload: { errors?: Array<{ code?: string; detail?: string }> }, fallback: string) {
  const first = payload.errors?.[0];
  const code = String(first?.code || "").trim();
  const detail = String(first?.detail || "").trim();
  return [fallback, code, detail].filter(Boolean).join(" · ").slice(0, 280);
}

async function squareGet<T extends { errors?: Array<{ code?: string; detail?: string }> }>(path: string): Promise<T> {
  const accessToken = envValue("SQUARE_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Square card payments are not configured yet.");

  const response = await fetch(`${SQUARE_API_ORIGIN}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new Error(squareErrorMessage(payload, "Square could not verify this card payment."));
  }
  return payload;
}

export async function verifySquarePosPayment(input: {
  transactionId: string;
  expectedAmountCents: number;
}): Promise<VerifiedSquarePosPayment> {
  const config = getSquarePosPublicConfig();
  if (!config.enabled || !config.locationId) {
    throw new Error("Square card payments are not configured yet.");
  }

  const expectedAmountCents = Math.trunc(input.expectedAmountCents);
  if (!Number.isFinite(expectedAmountCents) || expectedAmountCents <= 0) {
    throw new Error("The Square payment amount is invalid.");
  }

  const transactionId = String(input.transactionId || "").trim();
  if (!transactionId || transactionId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(transactionId)) {
    throw new Error("The Square transaction reference is invalid.");
  }

  // For Point of Sale API card payments, Square documents that the returned
  // transaction_id can be used as the Order ID. The order exposes the Payment ID.
  const orderPayload = await squareGet<SquareOrderResponse>(`/v2/orders/${encodeURIComponent(transactionId)}`);
  const order = orderPayload.order;
  if (!order?.id) throw new Error("Square could not find the completed card payment.");
  if (order.location_id && order.location_id !== config.locationId) {
    throw new Error("The Square payment was processed at a different location.");
  }

  const paymentId = order.tenders?.map((tender) => String(tender.payment_id || "").trim()).find(Boolean);
  if (!paymentId) throw new Error("Square returned no card payment for this transaction.");

  const paymentPayload = await squareGet<SquarePaymentResponse>(`/v2/payments/${encodeURIComponent(paymentId)}`);
  const payment = paymentPayload.payment;
  if (!payment?.id) throw new Error("Square could not retrieve the completed card payment.");
  if (payment.status !== "COMPLETED") throw new Error("The Square card payment is not completed yet.");
  if (payment.source_type && payment.source_type !== "CARD") {
    throw new Error("The Square transaction was not completed as a card payment.");
  }
  if (payment.location_id !== config.locationId) {
    throw new Error("The Square payment was processed at a different location.");
  }
  if (payment.order_id && payment.order_id !== transactionId) {
    throw new Error("The Square payment does not match this transaction.");
  }

  const money = payment.total_money ?? payment.amount_money;
  const amountCents = Number(money?.amount);
  const currency = String(money?.currency || "").toUpperCase();
  if (!Number.isInteger(amountCents) || amountCents !== expectedAmountCents) {
    throw new Error("The Square payment amount does not match the POS total.");
  }
  if (currency !== "USD") throw new Error("The Square payment currency does not match the POS sale.");

  return {
    transactionId,
    paymentId: payment.id,
    amountCents,
    currency,
    locationId: payment.location_id,
    receiptNumber: payment.receipt_number || null,
    cardBrand: payment.card_details?.card?.card_brand || null,
    cardLast4: payment.card_details?.card?.last_4 || null
  };
}
