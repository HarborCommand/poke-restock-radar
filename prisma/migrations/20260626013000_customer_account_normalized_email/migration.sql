ALTER TABLE "CustomerAccount" ADD COLUMN "normalizedEmail" TEXT;

CREATE INDEX IF NOT EXISTS "CustomerAccount_normalizedEmail_idx" ON "CustomerAccount"("normalizedEmail");
