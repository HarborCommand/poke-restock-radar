import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (!isRetryableRewardTransactionError(error)) throw error;
      if (attempt === attempts - 1) throw new RewardTransactionConflictError();
      await retryDelay(attempt);
    }
  }
  throw new RewardTransactionConflictError();
}
