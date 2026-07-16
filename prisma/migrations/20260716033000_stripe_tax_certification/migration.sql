CREATE TABLE "TaxCertificationEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contractStatus" TEXT NOT NULL,
    "providerMode" TEXT NOT NULL,
    "safeProviderReference" TEXT,
    "expectedAmountCents" INTEGER,
    "actualAmountCents" INTEGER,
    "requestId" TEXT,
    "buildCommit" TEXT NOT NULL,
    "detailCode" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxCertificationEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxCertificationEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaxCertificationEvidence_userId_scenario_buildCommit_providerMode_key" ON "TaxCertificationEvidence"("userId", "scenario", "buildCommit", "providerMode");
CREATE INDEX "TaxCertificationEvidence_userId_status_idx" ON "TaxCertificationEvidence"("userId", "status");
CREATE INDEX "TaxCertificationEvidence_userId_runAt_idx" ON "TaxCertificationEvidence"("userId", "runAt");
