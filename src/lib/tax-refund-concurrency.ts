import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

const refundTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 20_000
} as const;

export class TaxRefundConflictError extends Error {
  readonly code = "TAX_REFUND_CONFLICT";

  constructor(message = "The refundable balance changed. Refresh the transaction and try again.") {
    super(message);
    this.name = "TaxRefundConflictError";
  }
}

export class TaxRefundAmountError extends Error {
  readonly code = "TAX_REFUND_AMOUNT_INVALID";

  constructor(message = "The requested refund exceeds the remaining refundable amount.") {
    super(message);
    this.name = "TaxRefundAmountError";
  }
}

export async function runTaxRefundTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = prisma,
  maxAttempts = 5,
  onRetry?: (details: { attempt: number; maxAttempts: number }) => void | Promise<void>
) {
  const attempts = Math.max(1, Math.min(8, Math.floor(maxAttempts)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await client.$transaction(operation, refundTransactionOptions);
    } catch (error) {
      const record = error && typeof error === "object" ? error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } : null;
      const retryable = record?.code === "P2034" || record?.meta?.code === "40001" || String(record?.message ?? "").includes("40001");
      if (!retryable || attempt === attempts - 1) throw error;
      await onRetry?.({ attempt: attempt + 1, maxAttempts: attempts });
      await new Promise((resolve) => setTimeout(resolve, Math.min(120, 15 * 2 ** attempt)));
    }
  }
  throw new Error("Tax refund transaction could not be completed.");
}

export async function lockStorefrontOrderForRefund(tx: Prisma.TransactionClient, orderId: string) {
  // SQLite is a local-only development path and does not support FOR UPDATE.
  if (process.env.DATABASE_URL?.trim().toLowerCase().startsWith("file:")) return;
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "StorefrontOrder"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;
}

export async function lockPosSaleForRefund(tx: Prisma.TransactionClient, userId: string, saleReference: string) {
  // Production and Preview use Postgres; SQLite serializes its local write transaction without row locks.
  if (process.env.DATABASE_URL?.trim().toLowerCase().startsWith("file:")) return;
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "InventorySale"
    WHERE "userId" = ${userId}
      AND "saleReference" = ${saleReference}
      AND "platform" = 'pos'
    ORDER BY "id"
    FOR UPDATE
  `;
}

type PaymentEventClient = Pick<PrismaClient, "paymentEvent">;

export type ProviderEventClaim = "claimed" | "processing" | "duplicate";
const providerEventClaimTimeoutMs = 5 * 60 * 1_000;

export async function claimProviderEvent(
  input: { eventId: string; eventType: string; orderId: string | null; provider: string; payload: string },
  client: PaymentEventClient = prisma
): Promise<ProviderEventClaim> {
  try {
    await client.paymentEvent.create({
      data: {
        orderId: input.orderId,
        provider: input.provider,
        eventId: input.eventId,
        eventType: `processing:${input.eventType}`,
        payload: input.payload
      }
    });
    return "claimed";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await client.paymentEvent.findUnique({
      where: { eventId: input.eventId },
      select: { eventType: true, receivedAt: true }
    });
    if (existing?.eventType === input.eventType) return "duplicate";
    if (
      existing?.eventType === `processing:${input.eventType}` &&
      existing.receivedAt.getTime() <= Date.now() - providerEventClaimTimeoutMs
    ) {
      const reclaimed = await client.paymentEvent.updateMany({
        where: {
          eventId: input.eventId,
          eventType: `processing:${input.eventType}`,
          receivedAt: { lte: new Date(Date.now() - providerEventClaimTimeoutMs) }
        },
        data: {
          ...(input.orderId ? { orderId: input.orderId } : {}),
          provider: input.provider,
          payload: input.payload,
          receivedAt: new Date()
        }
      });
      if (reclaimed.count === 1) return "claimed";
    }
    return "processing";
  }
}

export async function completeProviderEvent(
  input: { eventId: string; eventType: string; orderId: string | null; payload: string },
  client: PaymentEventClient = prisma
) {
  return client.paymentEvent.updateMany({
    where: { eventId: input.eventId, eventType: `processing:${input.eventType}` },
    data: {
      ...(input.orderId ? { orderId: input.orderId } : {}),
      eventType: input.eventType,
      payload: input.payload
    }
  });
}

export async function abandonProviderEvent(
  input: { eventId: string; eventType: string },
  client: PaymentEventClient = prisma
) {
  return client.paymentEvent.deleteMany({
    where: { eventId: input.eventId, eventType: `processing:${input.eventType}` }
  });
}
