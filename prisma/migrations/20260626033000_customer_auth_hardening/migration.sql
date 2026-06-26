-- Add customer authentication hardening primitives.
-- Stores only hashed limiter keys and a session revocation timestamp. No plaintext emails, IP addresses, passwords, tokens, or payment data are stored.

ALTER TABLE "CustomerAccount" ADD COLUMN "sessionRevokedBefore" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CustomerAuthRateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "emailKeyHash" TEXT NOT NULL,
  "clientKeyHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAuthRateLimit_action_emailKeyHash_clientKeyHash_windowStart_key"
  ON "CustomerAuthRateLimit"("action", "emailKeyHash", "clientKeyHash", "windowStart");
CREATE INDEX IF NOT EXISTS "CustomerAccount_sessionRevokedBefore_idx" ON "CustomerAccount"("sessionRevokedBefore");
CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_action_idx" ON "CustomerAuthRateLimit"("action");
CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_emailKeyHash_idx" ON "CustomerAuthRateLimit"("emailKeyHash");
CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_clientKeyHash_idx" ON "CustomerAuthRateLimit"("clientKeyHash");
CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_windowStart_idx" ON "CustomerAuthRateLimit"("windowStart");
CREATE INDEX IF NOT EXISTS "CustomerAuthRateLimit_blockedUntil_idx" ON "CustomerAuthRateLimit"("blockedUntil");
