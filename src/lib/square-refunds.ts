import { createHash } from "node:crypto";
import { verifySquarePosPayment } from "@/lib/square-pos";

const SQUARE_API_ORIGIN = "https://connect.squareup.com";
const SQUARE_API_VERSION = "2026-07-15";

type SquareMoney = {
  amount?: number;
  currency?: string;
};

type SquareRefund = {
  id?: string;
  status?: string;
  payment_id?: string;
  amount_money?: SquareMoney;
  reason?: string;
};

type SquareRefundResponse = {
  refund?: SquareRefund;
  errors?: Array<{ code?: string; detail?: string }>;
};

export type SquarePosRefundResult = {
  provider: "square";
  refundId: string;
  paymentId: string;
  status: "COMPLETED" | "PENDING";
  amountCents: number;
  currency: "USD";
  cardBrand: string | null;
  cardLast4: string | null;
};

function envValue(name: string) {
  return String(process.env[name] || "").trim();
}

function squareErrorMessage(payload: SquareRefundResponse, fallback: string) {
  const first = payload.errors?.[0];
  const code = String(first?.code || "").trim();
  const detail = String(first?.detail || "").trim();
  return [fallback, code, detail].filter(Boolean).join(" · ").slice(0, 320);
}

function squareRefundIdempotencyKey(seed: string) {
  return `gdg-${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
}

async function squareRefundRequest(path: string, init?: RequestInit) {
  const accessToken = envValue("SQUARE_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Square card payments are not configured yet.");

  const response = await fetch(`${SQUARE_API_ORIGIN}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {})
    },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => ({}))) as SquareRefundResponse;
  if (!response.ok) throw new Error(squareErrorMessage(payload, "Square could not process this refund."));
  return payload;
}

function validateSquareRefund(payload: SquareRefundResponse, expectedPaymentId: string, expectedAmountCents: number) {
  const refund = payload.refund;
  const refundId = String(refund?.id || "").trim();
  const paymentId = String(refund?.payment_id || "").trim();
  const status = String(refund?.status || "").trim().toUpperCase();
  const amountCents = Number(refund?.amount_money?.amount);
  const currency = String(refund?.amount_money?.currency || "").trim().toUpperCase();

  if (!refundId) throw new Error("Square returned no refund ID.");
  if (!paymentId || paymentId !== expectedPaymentId) throw new Error("Square returned a refund for a different payment.");
  if (!Number.isInteger(amountCents) || amountCents !== expectedAmountCents) throw new Error("Square returned a different refund amount than requested.");
  if (currency !== "USD") throw new Error("Square returned the refund in an unexpected currency.");
  if (status === "FAILED" || status === "REJECTED") throw new Error(`Square refund ${status.toLowerCase()}. No GameDayGrabs refund was recorded.`);
  if (status !== "COMPLETED" && status !== "PENDING") throw new Error(`Square returned an unexpected refund status: ${status || "unknown"}.`);

  return { refundId, paymentId, status: status as "COMPLETED" | "PENDING", amountCents };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refundSquarePosPayment(input: {
  transactionId: string;
  originalAmountCents: number;
  refundAmountCents: number;
  idempotencySeed: string;
  reason: string;
}): Promise<SquarePosRefundResult> {
  if (!Number.isInteger(input.refundAmountCents) || input.refundAmountCents <= 0) {
    throw new Error("The Square refund amount is invalid.");
  }

  const verified = await verifySquarePosPayment({
    transactionId: input.transactionId,
    expectedAmountCents: input.originalAmountCents
  });

  const idempotencyKey = squareRefundIdempotencyKey(input.idempotencySeed);
  let payload = await squareRefundRequest("/v2/refunds", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      payment_id: verified.paymentId,
      amount_money: {
        amount: input.refundAmountCents,
        currency: "USD"
      },
      reason: input.reason.slice(0, 190)
    })
  });

  let validated = validateSquareRefund(payload, verified.paymentId, input.refundAmountCents);
  if (validated.status === "PENDING") {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wait(750);
      payload = await squareRefundRequest(`/v2/refunds/${encodeURIComponent(validated.refundId)}`);
      validated = validateSquareRefund(payload, verified.paymentId, input.refundAmountCents);
      if (validated.status === "COMPLETED") break;
    }
  }

  return {
    provider: "square",
    refundId: validated.refundId,
    paymentId: validated.paymentId,
    status: validated.status,
    amountCents: validated.amountCents,
    currency: "USD",
    cardBrand: verified.cardBrand,
    cardLast4: verified.cardLast4
  };
}
