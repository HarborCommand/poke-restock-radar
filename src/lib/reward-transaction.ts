import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentRequestId, logMutationBreadcrumb, logServerEvent } from "@/lib/observability";

const defaultMaxAttempts = 3;

export class RewardTransactionConflictError extends Error {
  constructor() {
    super("The reward update conflicted with another request. Please retry.");
    this.name = "RewardTransactionConflictError";
  }
}

export function isRetryableRewardTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null && "code" in error)
  ) && (error as { code?: unknown }).code === "P2034";
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(100, 10 * 2 ** attempt)));
}

export async function runRewardSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = defaultMaxAttempts
) {
  const attempts = Math.max(1, Math.min(5, Math.floor(maxAttempts)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      const requestId = currentRequestId();
      if (requestId) {
        logMutationBreadcrumb({
          requestId,
          route: "internal:rewards",
          operation: "reward.transaction",
          result: "committed",
          metadata: { retryCount: attempt }
        });
      }
      return result;
    } catch (error) {
      if (!isRetryableRewardTransactionError(error)) throw error;
      const requestId = currentRequestId();
      if (attempt === attempts - 1) {
        if (requestId) {
          logServerEvent({
            requestId,
            route: "internal:rewards",
            operation: "reward.transaction",
            status: 409,
            error,
            metadata: { retryCount: attempt }
          });
        }
        throw new RewardTransactionConflictError();
      }
      if (requestId) {
        logServerEvent({
          level: "warn",
          requestId,
          route: "internal:rewards",
          operation: "reward.transaction.retry",
          status: 409,
          error,
          metadata: { retryCount: attempt + 1 }
        });
      }
      await retryDelay(attempt);
    }
  }
  throw new RewardTransactionConflictError();
}
