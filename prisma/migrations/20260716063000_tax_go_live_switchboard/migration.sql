ALTER TABLE "StorefrontSettings"
  ADD COLUMN "taxAccountantReviewedAt" TIMESTAMP(3),
  ADD COLUMN "taxAccountantReviewedByUserId" TEXT,
  ADD COLUMN "taxAccountantReviewNote" TEXT;
