CREATE TABLE "RewardAuditFinding" (
    "id" TEXT NOT NULL,
    "findingFingerprint" TEXT NOT NULL,
    "findingCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "sourceType" TEXT,
    "sourceReferenceHash" TEXT,
    "rewardLedgerEntryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metadataJson" TEXT,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardAuditFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardAuditFinding_findingFingerprint_key" ON "RewardAuditFinding"("findingFingerprint");
CREATE INDEX "RewardAuditFinding_findingCode_idx" ON "RewardAuditFinding"("findingCode");
CREATE INDEX "RewardAuditFinding_severity_idx" ON "RewardAuditFinding"("severity");
CREATE INDEX "RewardAuditFinding_customerAccountId_idx" ON "RewardAuditFinding"("customerAccountId");
CREATE INDEX "RewardAuditFinding_sourceType_idx" ON "RewardAuditFinding"("sourceType");
CREATE INDEX "RewardAuditFinding_status_idx" ON "RewardAuditFinding"("status");
CREATE INDEX "RewardAuditFinding_firstDetectedAt_idx" ON "RewardAuditFinding"("firstDetectedAt");
CREATE INDEX "RewardAuditFinding_lastDetectedAt_idx" ON "RewardAuditFinding"("lastDetectedAt");
