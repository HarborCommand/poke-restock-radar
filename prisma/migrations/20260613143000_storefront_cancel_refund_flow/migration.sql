ALTER TABLE "StorefrontOrder" ADD COLUMN "refundStatus" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StorefrontOrder" ADD COLUMN "refundCurrency" TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE "StorefrontOrder" ADD COLUMN "stripeRefundId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "refundNote" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "stockReturnStatus" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "stockReturnedAt" TIMESTAMP(3);
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerCancellationEmailStatus" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerCancellationEmailSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "StorefrontOrder_refundStatus_idx" ON "StorefrontOrder"("refundStatus");
