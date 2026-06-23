-- Add optional customer account and rewards foundations behind disabled feature flags.
-- Guest checkout, existing orders, inventory, refunds, payments, and shipping behavior are untouched.

ALTER TABLE "StorefrontCustomer" ADD COLUMN "customerAccountId" TEXT;
ALTER TABLE "StorefrontOrder" ADD COLUMN "customerAccountId" TEXT;

CREATE TABLE IF NOT EXISTS "CustomerAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "emailVerifiedAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CustomerSavedAddress" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerAccountId" TEXT NOT NULL,
  "name" TEXT,
  "street1" TEXT NOT NULL,
  "street2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "zip" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'US',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSavedAddress_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CustomerMagicLinkToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerAccountId" TEXT,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerMagicLinkToken_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RewardLedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerAccountId" TEXT NOT NULL,
  "orderId" TEXT,
  "points" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardLedgerEntry_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RewardLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RewardBalance" (
  "customerAccountId" TEXT NOT NULL PRIMARY KEY,
  "availablePoints" INTEGER NOT NULL DEFAULT 0,
  "lifetimeEarnedPoints" INTEGER NOT NULL DEFAULT 0,
  "pendingPoints" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardBalance_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_email_key" ON "CustomerAccount"("email");
CREATE INDEX IF NOT EXISTS "CustomerAccount_userId_idx" ON "CustomerAccount"("userId");
CREATE INDEX IF NOT EXISTS "CustomerAccount_email_idx" ON "CustomerAccount"("email");
CREATE INDEX IF NOT EXISTS "CustomerAccount_status_idx" ON "CustomerAccount"("status");
CREATE INDEX IF NOT EXISTS "CustomerAccount_emailVerifiedAt_idx" ON "CustomerAccount"("emailVerifiedAt");
CREATE INDEX IF NOT EXISTS "StorefrontCustomer_customerAccountId_idx" ON "StorefrontCustomer"("customerAccountId");
CREATE INDEX IF NOT EXISTS "StorefrontOrder_customerAccountId_idx" ON "StorefrontOrder"("customerAccountId");
CREATE INDEX IF NOT EXISTS "CustomerSavedAddress_customerAccountId_idx" ON "CustomerSavedAddress"("customerAccountId");
CREATE INDEX IF NOT EXISTS "CustomerSavedAddress_customerAccountId_isDefault_idx" ON "CustomerSavedAddress"("customerAccountId", "isDefault");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMagicLinkToken_tokenHash_key" ON "CustomerMagicLinkToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerMagicLinkToken_customerAccountId_idx" ON "CustomerMagicLinkToken"("customerAccountId");
CREATE INDEX IF NOT EXISTS "CustomerMagicLinkToken_email_idx" ON "CustomerMagicLinkToken"("email");
CREATE INDEX IF NOT EXISTS "CustomerMagicLinkToken_expiresAt_idx" ON "CustomerMagicLinkToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "CustomerMagicLinkToken_usedAt_idx" ON "CustomerMagicLinkToken"("usedAt");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_customerAccountId_idx" ON "RewardLedgerEntry"("customerAccountId");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_orderId_idx" ON "RewardLedgerEntry"("orderId");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_type_idx" ON "RewardLedgerEntry"("type");
CREATE INDEX IF NOT EXISTS "RewardLedgerEntry_createdAt_idx" ON "RewardLedgerEntry"("createdAt");
