-- Add durable public storefront API abuse protection.
-- Stores only hashed limiter keys. No plaintext IP addresses, emails, order numbers, cart contents, tokens, or payment data are stored.

CREATE TABLE IF NOT EXISTS "PublicRateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PublicRateLimit_action_rule_keyHash_windowStart_key"
  ON "PublicRateLimit"("action", "rule", "keyHash", "windowStart");
CREATE INDEX IF NOT EXISTS "PublicRateLimit_action_idx" ON "PublicRateLimit"("action");
CREATE INDEX IF NOT EXISTS "PublicRateLimit_scope_idx" ON "PublicRateLimit"("scope");
CREATE INDEX IF NOT EXISTS "PublicRateLimit_keyHash_idx" ON "PublicRateLimit"("keyHash");
CREATE INDEX IF NOT EXISTS "PublicRateLimit_windowStart_idx" ON "PublicRateLimit"("windowStart");
CREATE INDEX IF NOT EXISTS "PublicRateLimit_blockedUntil_idx" ON "PublicRateLimit"("blockedUntil");
