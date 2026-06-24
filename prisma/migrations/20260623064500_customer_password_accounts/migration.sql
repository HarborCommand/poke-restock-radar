-- Add optional password-based customer account support.
-- Guest checkout, rewards redemption, orders, inventory, payments, refunds, and shipping behavior are untouched.

ALTER TABLE "CustomerAccount" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CustomerPasswordResetToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerAccountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPasswordResetToken_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPasswordResetToken_tokenHash_key" ON "CustomerPasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerPasswordResetToken_customerAccountId_idx" ON "CustomerPasswordResetToken"("customerAccountId");
CREATE INDEX IF NOT EXISTS "CustomerPasswordResetToken_expiresAt_idx" ON "CustomerPasswordResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "CustomerPasswordResetToken_usedAt_idx" ON "CustomerPasswordResetToken"("usedAt");
