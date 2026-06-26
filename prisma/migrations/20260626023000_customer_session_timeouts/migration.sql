-- Add server-side customer session records for optional timeout enforcement.
-- Stores only a token hash. Guest checkout, rewards redemption, orders, inventory, payments, refunds, and shipping behavior are untouched.

CREATE TABLE IF NOT EXISTS "CustomerSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerAccountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "userAgentSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSession_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerSession_customerAccountId_idx" ON "CustomerSession"("customerAccountId");
CREATE INDEX IF NOT EXISTS "CustomerSession_lastActivityAt_idx" ON "CustomerSession"("lastActivityAt");
CREATE INDEX IF NOT EXISTS "CustomerSession_absoluteExpiresAt_idx" ON "CustomerSession"("absoluteExpiresAt");
CREATE INDEX IF NOT EXISTS "CustomerSession_revokedAt_idx" ON "CustomerSession"("revokedAt");
