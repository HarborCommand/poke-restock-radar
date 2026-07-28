-- Additive receipt-email delivery persistence for storefront and POS receipts.
-- No existing order, sale, customer, inventory, tax, reward, or payment data is modified.
-- Automatic paid storefront order-confirmation/receipt idempotency remains on PaymentEvent; this table tracks POS initial sends and manual receipt resends/status.

CREATE TABLE "ReceiptEmailDelivery" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "recipientEmailNormalized" TEXT NOT NULL,
  "recipientEmailMasked" TEXT NOT NULL,
  "deliveryType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "providerMessageId" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "sanitizedFailureCode" TEXT,
  "sanitizedFailureMessage" TEXT,
  "requestedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReceiptEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiptEmailDelivery_idempotencyKey_key" ON "ReceiptEmailDelivery"("idempotencyKey");
CREATE INDEX "ReceiptEmailDelivery_sourceType_sourceId_idx" ON "ReceiptEmailDelivery"("sourceType", "sourceId");
CREATE INDEX "ReceiptEmailDelivery_sourceType_sourceId_deliveryType_idx" ON "ReceiptEmailDelivery"("sourceType", "sourceId", "deliveryType");
CREATE INDEX "ReceiptEmailDelivery_status_idx" ON "ReceiptEmailDelivery"("status");
CREATE INDEX "ReceiptEmailDelivery_recipientEmailNormalized_idx" ON "ReceiptEmailDelivery"("recipientEmailNormalized");
CREATE INDEX "ReceiptEmailDelivery_requestedByUserId_idx" ON "ReceiptEmailDelivery"("requestedByUserId");
CREATE INDEX "ReceiptEmailDelivery_createdAt_idx" ON "ReceiptEmailDelivery"("createdAt");
