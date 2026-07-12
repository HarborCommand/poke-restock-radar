-- Frozen Postgres schema baseline generated from commit 8834156cec16e1d2173441e74eb35f7ce3ce829b.
-- This file is not an active Prisma migration and must never be executed against an existing database.
-- Generate only for an owner-reviewed baseline cutover; normal schema changes require additive migrations.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'FRIEND',
    "passwordHash" TEXT NOT NULL,
    "canAddSightings" BOOLEAN NOT NULL DEFAULT true,
    "canAddComps" BOOLEAN NOT NULL DEFAULT false,
    "canRunChecks" BOOLEAN NOT NULL DEFAULT false,
    "canReceivePushAlerts" BOOLEAN NOT NULL DEFAULT true,
    "preferredZone" TEXT NOT NULL DEFAULT 'MIAMI',
    "customZoneName" TEXT,
    "hideDistantStores" BOOLEAN NOT NULL DEFAULT false,
    "currentLatitude" DOUBLE PRECISION,
    "currentLongitude" DOUBLE PRECISION,
    "locationUpdatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'FRIEND',
    "canAddSightings" BOOLEAN NOT NULL DEFAULT true,
    "canAddComps" BOOLEAN NOT NULL DEFAULT false,
    "canRunChecks" BOOLEAN NOT NULL DEFAULT false,
    "canReceivePushAlerts" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "acceptedById" TEXT,

    CONSTRAINT "FriendInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retailer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "releaseId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "setName" TEXT,
    "productType" TEXT,
    "imageUrl" TEXT,
    "expectedTitleKeywords" TEXT,
    "sku" TEXT,
    "upc" TEXT,
    "dpci" TEXT,
    "retailerProductId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedFinalUrl" TEXT,
    "verificationNotes" TEXT,
    "retailPrice" DOUBLE PRECISION,
    "liveTitle" TEXT,
    "livePrice" DOUBLE PRECISION,
    "livePriceSource" TEXT,
    "livePriceVerifiedAt" TIMESTAMP(3),
    "liveStockStatus" TEXT,
    "liveStockVerifiedAt" TIMESTAMP(3),
    "liveImageUrl" TEXT,
    "liveConfidenceScore" INTEGER,
    "liveBlockedType" TEXT,
    "sellerName" TEXT,
    "sellerType" TEXT NOT NULL DEFAULT 'unknown',
    "fulfillmentType" TEXT NOT NULL DEFAULT 'unknown',
    "sellerVerified" BOOLEAN NOT NULL DEFAULT false,
    "priceStatus" TEXT NOT NULL DEFAULT 'unknown',
    "alertEligibility" TEXT NOT NULL DEFAULT 'needs_review',
    "expectedRetailPrice" DOUBLE PRECISION,
    "maxAlertPrice" DOUBLE PRECISION,
    "allowOverMsrp" BOOLEAN NOT NULL DEFAULT false,
    "targetRetailMin" DOUBLE PRECISION,
    "targetRetailMax" DOUBLE PRECISION,
    "targetRetailReason" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "stockStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "alertStatus" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "rating" TEXT NOT NULL DEFAULT 'WATCH',
    "notes" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulCheckedAt" TIMESTAMP(3),
    "monitorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkFrequencyMinutes" INTEGER NOT NULL DEFAULT 60,
    "nextCheckAt" TIMESTAMP(3),
    "lastMonitorResult" TEXT,
    "lastMonitorError" TEXT,
    "lastPageHash" TEXT,
    "lastAlertSentAt" TIMESTAMP(3),
    "requiredWords" TEXT,
    "ignoreWords" TEXT,
    "pendingAlertStatus" TEXT,
    "pendingAlertPrice" DOUBLE PRECISION,
    "pendingAlertPageHash" TEXT,
    "pendingAlertCount" INTEGER NOT NULL DEFAULT 0,
    "pendingAlertReason" TEXT,
    "pendingAlertConfidence" INTEGER,
    "pendingAlertDetectedWords" TEXT,
    "pendingAlertAt" TIMESTAMP(3),
    "sealedResaleNotes" TEXT,
    "scarcityNotes" TEXT,
    "manualPriorityOverride" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'MIAMI',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "typicalRestockDays" TEXT NOT NULL,
    "typicalRestockTimeWindow" TEXT NOT NULL,
    "vendorNotes" TEXT,
    "confidenceScore" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStorePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStorePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSighting" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productSeen" TEXT NOT NULL,
    "resultType" TEXT NOT NULL DEFAULT 'stock_seen',
    "seenAt" TIMESTAMP(3) NOT NULL,
    "quantityEstimate" TEXT NOT NULL,
    "shelfPhotoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "releaseName" TEXT,
    "productName" TEXT,
    "productType" TEXT,
    "releaseType" TEXT NOT NULL DEFAULT 'expansion',
    "officialReleaseDate" TIMESTAMP(3),
    "preorderDate" TIMESTAMP(3),
    "preorderWindowText" TEXT,
    "region" TEXT NOT NULL DEFAULT 'US',
    "retailer" TEXT,
    "productTypes" TEXT NOT NULL,
    "pokemonCenterExclusiveVersion" BOOLEAN NOT NULL DEFAULT false,
    "productImage" TEXT,
    "productUrl" TEXT,
    "chaseCards" TEXT,
    "demandRating" TEXT NOT NULL DEFAULT 'MEDIUM',
    "estimatedDemand" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "sealedProductPriority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "productLinks" TEXT,
    "supportingSources" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "lastSyncedAt" TIMESTAMP(3),
    "createdByManualEntry" BOOLEAN NOT NULL DEFAULT true,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "previousReleaseDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseSyncSource" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'custom_public_feed',
    "sourceUrl" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "confidenceDefault" TEXT NOT NULL DEFAULT 'MEDIUM',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulParseAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "parsedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseSyncSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseSyncLog" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'custom_public_feed',
    "adapter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "httpStatus" INTEGER,
    "parsedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actionUrl" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 50,
    "dedupeKey" TEXT,
    "explanation" TEXT,
    "falsePositiveAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "productId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeliveryLog" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "userId" TEXT,
    "productId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "detail" TEXT,
    "dedupeKey" TEXT,
    "priority" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "snapshotReason" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestockHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previousStatus" TEXT,
    "detectedStatus" TEXT,
    "previousPrice" DOUBLE PRECISION,
    "detectedPrice" DOUBLE PRECISION,
    "changeSummary" TEXT,
    "httpStatus" INTEGER,
    "finalUrl" TEXT,
    "responseTimeMs" INTEGER,
    "detectedWords" TEXT,
    "confidenceScore" INTEGER,
    "reason" TEXT,
    "blockedType" TEXT,
    "pageHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "notificationSummary" TEXT,

    CONSTRAINT "MonitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDiscoverySource" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "checkFrequencyMinutes" INTEGER NOT NULL DEFAULT 360,
    "nextCheckAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulCheckedAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "lastError" TEXT,
    "lastFoundCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDiscoverySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "productName" TEXT NOT NULL,
    "productType" TEXT,
    "retailerProductId" TEXT,
    "sku" TEXT,
    "upc" TEXT,
    "dpci" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "description" TEXT,
    "itemDetails" TEXT,
    "imageUrl" TEXT,
    "livePrice" DOUBLE PRECISION,
    "stockStatus" TEXT,
    "sellerName" TEXT,
    "sellerType" TEXT NOT NULL DEFAULT 'unknown',
    "fulfillmentType" TEXT NOT NULL DEFAULT 'unknown',
    "sellerVerified" BOOLEAN NOT NULL DEFAULT false,
    "priceStatus" TEXT NOT NULL DEFAULT 'unknown',
    "alertEligibility" TEXT NOT NULL DEFAULT 'needs_review',
    "expectedRetailPrice" DOUBLE PRECISION,
    "maxAlertPrice" DOUBLE PRECISION,
    "targetRetailMin" DOUBLE PRECISION,
    "targetRetailMax" DOUBLE PRECISION,
    "targetRetailReason" TEXT,
    "enrichmentStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "enrichmentReason" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "confidenceScore" INTEGER NOT NULL DEFAULT 50,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedProductId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT,
    "cardName" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "rawAveragePrice" DOUBLE PRECISION NOT NULL,
    "psa9AverageSalePrice" DOUBLE PRECISION NOT NULL,
    "psa10AverageSalePrice" DOUBLE PRECISION NOT NULL,
    "bgs95AverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bgs10AverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bgsBlackLabelAverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedEbayFee" DOUBLE PRECISION NOT NULL DEFAULT 0.1325,
    "estimatedGradingCost" DOUBLE PRECISION NOT NULL,
    "estimatedShippingCost" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "minimumProfitTarget" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "psa9EstimatedProfit" DOUBLE PRECISION NOT NULL,
    "psa10EstimatedProfit" DOUBLE PRECISION NOT NULL,
    "bgs10EstimatedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blackLabelEstimatedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxRawBuyPricePsa9" DOUBLE PRECISION NOT NULL,
    "maxRawBuyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "top10Score" INTEGER NOT NULL DEFAULT 0,
    "compConfidenceScore" INTEGER NOT NULL DEFAULT 0,
    "rating" TEXT NOT NULL DEFAULT 'WATCH',
    "dataSource" TEXT NOT NULL,
    "lastRefreshed" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "characterName" TEXT,
    "era" TEXT NOT NULL DEFAULT 'MODERN',
    "lowPop" BOOLEAN NOT NULL DEFAULT false,
    "newRelease" BOOLEAN NOT NULL DEFAULT false,
    "lowNumberedSerialized" BOOLEAN NOT NULL DEFAULT false,
    "strongCharacterDemand" BOOLEAN NOT NULL DEFAULT false,
    "ebayIncludeWords" TEXT,
    "ebayExcludeWords" TEXT,
    "ebayExactSetName" BOOLEAN NOT NULL DEFAULT true,
    "ebayCardNumberRequired" BOOLEAN NOT NULL DEFAULT true,
    "ebayRawKeywords" TEXT,
    "ebayPsa9Keywords" TEXT,
    "ebayPsa10Keywords" TEXT,
    "ebayAllowNonEnglish" BOOLEAN NOT NULL DEFAULT false,
    "lastCompAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPriceSnapshot" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rawAveragePrice" DOUBLE PRECISION NOT NULL,
    "psa9AverageSalePrice" DOUBLE PRECISION NOT NULL,
    "psa10AverageSalePrice" DOUBLE PRECISION NOT NULL,
    "bgs95AverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bgs10AverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bgsBlackLabelAverageSalePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "psa9EstimatedProfit" DOUBLE PRECISION NOT NULL,
    "psa10EstimatedProfit" DOUBLE PRECISION NOT NULL,
    "bgs10EstimatedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blackLabelEstimatedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxRawBuyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "top10Score" INTEGER NOT NULL DEFAULT 0,
    "rating" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardCompSale" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "gradeType" TEXT NOT NULL DEFAULT 'RAW',
    "soldAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "sourceUrl" TEXT,
    "saleTitle" TEXT,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "conditionNotes" TEXT,
    "sourceQuality" TEXT NOT NULL DEFAULT 'EBAY_SOLD',
    "reviewStatus" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardCompSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "top10RawToGrade" TEXT NOT NULL,
    "safestPsa9Flips" TEXT NOT NULL,
    "highestPsa10Upside" TEXT NOT NULL,
    "beckettCandidates" TEXT NOT NULL,
    "avoidOverpriced" TEXT NOT NULL,
    "bestBuy" TEXT,
    "riskiestBuy" TEXT,
    "bestUnder25Raw" TEXT,
    "bestPremiumCard" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gradingCost" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "ebaySellingFee" DOUBLE PRECISION NOT NULL DEFAULT 0.1325,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "minimumProfitTarget" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "itemType" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'sealed_packs',
    "setName" TEXT,
    "productId" TEXT,
    "cardId" TEXT,
    "cost" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalCost" DOUBLE PRECISION,
    "purchaseExtraCost" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "retailer" TEXT,
    "brand" TEXT,
    "description" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "msrp" DOUBLE PRECISION,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "receiptNumber" TEXT,
    "receiptImageUrl" TEXT,
    "orderNumber" TEXT,
    "transactionId" TEXT,
    "sourceStore" TEXT,
    "paymentMethod" TEXT,
    "exactProductUrl" TEXT,
    "upc" TEXT,
    "sku" TEXT,
    "dpci" TEXT,
    "asin" TEXT,
    "imageUrl" TEXT,
    "condition" TEXT,
    "itemStatus" TEXT NOT NULL DEFAULT 'sealed',
    "targetSellPrice" DOUBLE PRECISION,
    "minimumAcceptablePrice" DOUBLE PRECISION,
    "listingPlatform" TEXT,
    "listingStatus" TEXT NOT NULL DEFAULT 'not_listed',
    "soldPrice" DOUBLE PRECISION,
    "soldAt" TIMESTAMP(3),
    "buyerPlatform" TEXT,
    "currentMarketEstimate" DOUBLE PRECISION,
    "marketAverageSalePrice" DOUBLE PRECISION,
    "marketCompCount" INTEGER NOT NULL DEFAULT 0,
    "marketLastRefreshedAt" TIMESTAMP(3),
    "marketConfidence" TEXT NOT NULL DEFAULT 'LOW',
    "marketProvider" TEXT,
    "marketProviderProductId" TEXT,
    "marketProviderProductName" TEXT,
    "marketProviderMatchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "marketProviderConfidenceScore" INTEGER NOT NULL DEFAULT 0,
    "marketProviderMatchReason" TEXT,
    "marketProviderMatchedAt" TIMESTAMP(3),
    "marketProviderLastPricedAt" TIMESTAMP(3),
    "estimatedEbayFee" DOUBLE PRECISION,
    "estimatedShippingCost" DOUBLE PRECISION,
    "estimatedNetProfit" DOUBLE PRECISION,
    "roiPercent" DOUBLE PRECISION,
    "recommendedAction" TEXT NOT NULL DEFAULT 'HOLD',
    "recommendationReason" TEXT,
    "netProfitAfterFees" DOUBLE PRECISION,
    "publishToStore" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "publicTitle" TEXT,
    "publicDescription" TEXT,
    "publicPrice" DOUBLE PRECISION,
    "compareAtPrice" DOUBLE PRECISION,
    "publicImages" TEXT,
    "availableForSale" INTEGER,
    "maxQuantityPerOrder" INTEGER NOT NULL DEFAULT 4,
    "purchaseLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shippingProfile" TEXT NOT NULL DEFAULT 'standard',
    "packageWeightOz" DOUBLE PRECISION,
    "packageLengthIn" DOUBLE PRECISION,
    "packageWidthIn" DOUBLE PRECISION,
    "packageHeightIn" DOUBLE PRECISION,
    "shippingMetadataSource" TEXT,
    "freeShippingEligible" BOOLEAN NOT NULL DEFAULT false,
    "requiresBox" BOOLEAN NOT NULL DEFAULT false,
    "insuranceRecommended" BOOLEAN NOT NULL DEFAULT false,
    "storeStatus" TEXT NOT NULL DEFAULT 'draft',
    "localPickupAvailable" BOOLEAN NOT NULL DEFAULT true,
    "shippingAvailable" BOOLEAN NOT NULL DEFAULT true,
    "storefrontCategory" TEXT,
    "storefrontTags" TEXT,
    "publishedAt" TIMESTAMP(3),
    "authenticityProofStatus" TEXT,
    "authenticityReceiptStatus" TEXT,
    "authenticityPhotoStatus" TEXT,
    "authenticityUpcVerified" BOOLEAN,
    "authenticityNotes" TEXT,
    "expectedPlan" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryProductImage" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "showInStore" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TcgcsvProduct" (
    "id" TEXT NOT NULL,
    "tcgcsvProductId" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL DEFAULT 3,
    "groupId" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "cleanProductName" TEXT,
    "normalizedName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "productUrl" TEXT,
    "extendedData" TEXT,
    "marketPrice" DOUBLE PRECISION,
    "lowPrice" DOUBLE PRECISION,
    "midPrice" DOUBLE PRECISION,
    "highPrice" DOUBLE PRECISION,
    "directLowPrice" DOUBLE PRECISION,
    "subTypeName" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TcgcsvProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TcgcsvSyncLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "groupsFetched" INTEGER NOT NULL DEFAULT 0,
    "productsCached" INTEGER NOT NULL DEFAULT 0,
    "pricesCached" INTEGER NOT NULL DEFAULT 0,
    "itemsMatched" INTEGER NOT NULL DEFAULT 0,
    "itemsReview" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TcgcsvSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStockLot" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "purchaseExtraCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "remainingQuantity" INTEGER NOT NULL,
    "notes" TEXT,
    "receiptNumber" TEXT,
    "receiptImageUrl" TEXT,
    "orderNumber" TEXT,
    "transactionId" TEXT,
    "sourceStore" TEXT,
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySale" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "userId" TEXT,
    "customerAccountId" TEXT,
    "quantitySold" INTEGER NOT NULL,
    "soldPricePerItem" DOUBLE PRECISION NOT NULL,
    "grossSale" DOUBLE PRECISION NOT NULL,
    "platform" TEXT NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSale" DOUBLE PRECISION NOT NULL,
    "costBasis" DOUBLE PRECISION NOT NULL,
    "profitLoss" DOUBLE PRECISION NOT NULL,
    "roiPercent" DOUBLE PRECISION,
    "saleReference" TEXT,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "originalUnitPrice" DOUBLE PRECISION,
    "adjustedUnitPrice" DOUBLE PRECISION,
    "discountAmount" DOUBLE PRECISION,
    "discountReason" TEXT,
    "discountNote" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerMatchMethod" TEXT,
    "customerLinkSource" TEXT,
    "customerLinkedAt" TIMESTAMP(3),
    "customerLinkedByUserId" TEXT,
    "customerLinkReason" TEXT,
    "customerLinkNote" TEXT,
    "rewardsEligible" BOOLEAN NOT NULL DEFAULT false,
    "refundStatus" TEXT,
    "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "refundNote" TEXT,
    "refundIdempotencyKey" TEXT,
    "refundRestockedQuantity" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMarketComp" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "saleTitle" TEXT NOT NULL,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "sourceQuality" TEXT NOT NULL DEFAULT 'EBAY_SOLD',
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMarketComp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarcodeScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "upc" TEXT NOT NULL,
    "rawCode" TEXT,
    "normalizedUpc" TEXT,
    "variantsChecked" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'LOOKUP_FAILED',
    "resultType" TEXT NOT NULL DEFAULT 'manual',
    "productId" TEXT,
    "inventoryItemId" TEXT,
    "productName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarcodeScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL DEFAULT 'GameDayGrabs LLC',
    "storeLogoUrl" TEXT,
    "sportsCardsExternalUrl" TEXT,
    "contactEmail" TEXT,
    "featuredHeroProductId" TEXT,
    "homepageHeroMode" TEXT NOT NULL DEFAULT 'automatic_latest',
    "newArrivalDays" INTEGER NOT NULL DEFAULT 14,
    "showSoldOutInHero" BOOLEAN NOT NULL DEFAULT true,
    "returnPolicyText" TEXT,
    "shippingPolicyText" TEXT,
    "localPickupInstructions" TEXT,
    "announcementBanner" TEXT,
    "defaultShippingPrice" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "freeShippingThreshold" DOUBLE PRECISION,
    "socialLinks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "defaultWeightOz" DOUBLE PRECISION NOT NULL,
    "packageLengthIn" DOUBLE PRECISION,
    "packageWidthIn" DOUBLE PRECISION,
    "packageHeightIn" DOUBLE PRECISION,
    "defaultShippingCharge" DOUBLE PRECISION,
    "localPickupEligibleDefault" BOOLEAN NOT NULL DEFAULT false,
    "freeShippingEligibleDefault" BOOLEAN NOT NULL DEFAULT false,
    "requiresBoxDefault" BOOLEAN NOT NULL DEFAULT false,
    "insuranceRecommendedDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "systemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "customerAccountId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "stripeCustomerId" TEXT,
    "firstOrderAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultShippingName" TEXT,
    "defaultShippingLine1" TEXT,
    "defaultShippingLine2" TEXT,
    "defaultShippingCity" TEXT,
    "defaultShippingState" TEXT,
    "defaultShippingPostalCode" TEXT,
    "defaultShippingCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT,
    "displayName" TEXT,
    "phone" TEXT,
    "adminNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "passwordHash" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "sessionRevokedBefore" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAuthRateLimit" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAuthRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRateLimit" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "userAgentSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPasswordResetToken" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSavedAddress" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSavedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMagicLinkToken" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerMagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT,
    "customerAccountId" TEXT,
    "customerLinkSource" TEXT,
    "customerLinkedAt" TIMESTAMP(3),
    "customerLinkedByUserId" TEXT,
    "customerLinkReason" TEXT,
    "customerLinkNote" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "shippingName" TEXT,
    "shippingLine1" TEXT,
    "shippingLine2" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingPostalCode" TEXT,
    "shippingCountry" TEXT,
    "billingName" TEXT,
    "billingLine1" TEXT,
    "billingLine2" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingPostalCode" TEXT,
    "billingCountry" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'unfulfilled',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCharged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingMethodLabel" TEXT,
    "shippingRateSource" TEXT,
    "shippingPackageWeightOz" DOUBLE PRECISION,
    "shippingPackageLengthIn" DOUBLE PRECISION,
    "shippingPackageWidthIn" DOUBLE PRECISION,
    "shippingPackageHeightIn" DOUBLE PRECISION,
    "shippingPackageProfile" TEXT,
    "shippingWarnings" TEXT,
    "shippingQuoteId" TEXT,
    "shippingQuoteProvider" TEXT,
    "shippingCarrier" TEXT,
    "shippingService" TEXT,
    "shippingQuotedAmountCents" INTEGER,
    "shippingQuotedZip" TEXT,
    "shippingQuoteFallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "shippingQuoteRateProviderRef" TEXT,
    "shippingQuoteShipmentProviderRef" TEXT,
    "shippingQuoteExpiresAt" TIMESTAMP(3),
    "shippingZipMismatchReview" BOOLEAN NOT NULL DEFAULT false,
    "shippingLabelProvider" TEXT,
    "shippingLabelProviderId" TEXT,
    "shippingLabelUrl" TEXT,
    "shippingLabelFileType" TEXT,
    "shippingTrackingNumber" TEXT,
    "shippingTrackingUrl" TEXT,
    "shippingLabelCostCents" INTEGER,
    "shippingLabelCurrency" TEXT,
    "shippingLabelPurchasedAt" TIMESTAMP(3),
    "shippingLabelVoidedAt" TIMESTAMP(3),
    "shippingLabelStatus" TEXT,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stripeFeeEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roiPercent" DOUBLE PRECISION,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundStatus" TEXT,
    "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundCurrency" TEXT NOT NULL DEFAULT 'usd',
    "stripeRefundId" TEXT,
    "refundReason" TEXT,
    "refundNote" TEXT,
    "stockReturnStatus" TEXT,
    "stockReturnedAt" TIMESTAMP(3),
    "customerCancellationEmailStatus" TEXT,
    "customerCancellationEmailSentAt" TIMESTAMP(3),
    "isTestOrder" BOOLEAN NOT NULL DEFAULT false,
    "testOrderReason" TEXT,
    "testMarkedAt" TIMESTAMP(3),
    "testMarkedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "quoteToken" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "provider" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "destinationZip" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "packageWeightOz" DOUBLE PRECISION,
    "packageLengthIn" DOUBLE PRECISION,
    "packageWidthIn" DOUBLE PRECISION,
    "packageHeightIn" DOUBLE PRECISION,
    "packageProfileKey" TEXT,
    "rateProviderRef" TEXT,
    "shipmentProviderRef" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "warning" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "cartHash" TEXT,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "publicTitle" TEXT NOT NULL,
    "publicSlug" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "costBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "orderId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedgerEntry" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "orderId" TEXT,
    "points" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT,
    "availableAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "eligibleSubtotalCents" INTEGER,
    "source" TEXT,
    "reversalOfEntryId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardBalance" (
    "customerAccountId" TEXT NOT NULL,
    "availablePoints" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarnedPoints" INTEGER NOT NULL DEFAULT 0,
    "pendingPoints" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardBalance_pkey" PRIMARY KEY ("customerAccountId")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unfulfilled',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRecap" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "recapDate" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "productChecks" INTEGER NOT NULL DEFAULT 0,
    "storeVisits" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "alertsCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRecap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilterPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilterPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriorityScore" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "releaseId" TEXT,
    "buyWatchSkip" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "retailPriceScore" INTEGER NOT NULL DEFAULT 0,
    "resaleDemandScore" INTEGER NOT NULL DEFAULT 0,
    "setPopularityScore" INTEGER NOT NULL DEFAULT 0,
    "scarcityScore" INTEGER NOT NULL DEFAULT 0,
    "chaseCardScore" INTEGER NOT NULL DEFAULT 0,
    "sealedValueScore" INTEGER NOT NULL DEFAULT 0,
    "cardInvestmentScore" INTEGER NOT NULL DEFAULT 0,
    "profitablePsa9Count" INTEGER NOT NULL DEFAULT 0,
    "psa10Upside" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualOverride" TEXT,
    "reason" TEXT,
    "userNotes" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriorityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "browserPush" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "emailTo" TEXT,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "minimumPriority" TEXT NOT NULL DEFAULT 'LOW',
    "alertDigestMode" BOOLEAN NOT NULL DEFAULT false,
    "urgentOnlyMode" BOOLEAN NOT NULL DEFAULT false,
    "highPriorityOverride" BOOLEAN NOT NULL DEFAULT true,
    "watchedRetailers" TEXT,
    "watchedProducts" TEXT,
    "alertCooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserPushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_usedAt_idx" ON "PasswordResetToken"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FriendInvite_tokenHash_key" ON "FriendInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "FriendInvite_email_idx" ON "FriendInvite"("email");

-- CreateIndex
CREATE INDEX "FriendInvite_expiresAt_idx" ON "FriendInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "FriendInvite_acceptedAt_idx" ON "FriendInvite"("acceptedAt");

-- CreateIndex
CREATE INDEX "FriendInvite_revokedAt_idx" ON "FriendInvite"("revokedAt");

-- CreateIndex
CREATE INDEX "FriendInvite_createdById_idx" ON "FriendInvite"("createdById");

-- CreateIndex
CREATE INDEX "FriendInvite_acceptedById_idx" ON "FriendInvite"("acceptedById");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Retailer_name_key" ON "Retailer"("name");

-- CreateIndex
CREATE INDEX "Product_retailerId_idx" ON "Product"("retailerId");

-- CreateIndex
CREATE INDEX "Product_releaseId_idx" ON "Product"("releaseId");

-- CreateIndex
CREATE INDEX "Product_setName_idx" ON "Product"("setName");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_upc_idx" ON "Product"("upc");

-- CreateIndex
CREATE INDEX "Product_retailerProductId_idx" ON "Product"("retailerProductId");

-- CreateIndex
CREATE INDEX "Product_verificationStatus_idx" ON "Product"("verificationStatus");

-- CreateIndex
CREATE INDEX "Product_stockStatus_idx" ON "Product"("stockStatus");

-- CreateIndex
CREATE INDEX "Product_liveStockStatus_idx" ON "Product"("liveStockStatus");

-- CreateIndex
CREATE INDEX "Product_sellerType_idx" ON "Product"("sellerType");

-- CreateIndex
CREATE INDEX "Product_priceStatus_idx" ON "Product"("priceStatus");

-- CreateIndex
CREATE INDEX "Product_alertEligibility_idx" ON "Product"("alertEligibility");

-- CreateIndex
CREATE INDEX "Product_isDemoData_idx" ON "Product"("isDemoData");

-- CreateIndex
CREATE INDEX "Product_archivedAt_idx" ON "Product"("archivedAt");

-- CreateIndex
CREATE INDEX "Product_lastCheckedAt_idx" ON "Product"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "Product_lastSuccessfulCheckedAt_idx" ON "Product"("lastSuccessfulCheckedAt");

-- CreateIndex
CREATE INDEX "Product_nextCheckAt_idx" ON "Product"("nextCheckAt");

-- CreateIndex
CREATE INDEX "Product_monitorEnabled_idx" ON "Product"("monitorEnabled");

-- CreateIndex
CREATE INDEX "Product_retailerId_monitorEnabled_liveStockStatus_idx" ON "Product"("retailerId", "monitorEnabled", "liveStockStatus");

-- CreateIndex
CREATE INDEX "Store_retailerId_idx" ON "Store"("retailerId");

-- CreateIndex
CREATE INDEX "Store_zone_idx" ON "Store"("zone");

-- CreateIndex
CREATE INDEX "UserStorePreference_userId_idx" ON "UserStorePreference"("userId");

-- CreateIndex
CREATE INDEX "UserStorePreference_storeId_idx" ON "UserStorePreference"("storeId");

-- CreateIndex
CREATE INDEX "UserStorePreference_favorite_idx" ON "UserStorePreference"("favorite");

-- CreateIndex
CREATE INDEX "UserStorePreference_hidden_idx" ON "UserStorePreference"("hidden");

-- CreateIndex
CREATE UNIQUE INDEX "UserStorePreference_userId_storeId_key" ON "UserStorePreference"("userId", "storeId");

-- CreateIndex
CREATE INDEX "StoreSighting_storeId_idx" ON "StoreSighting"("storeId");

-- CreateIndex
CREATE INDEX "StoreSighting_userId_idx" ON "StoreSighting"("userId");

-- CreateIndex
CREATE INDEX "StoreSighting_resultType_idx" ON "StoreSighting"("resultType");

-- CreateIndex
CREATE INDEX "StoreSighting_seenAt_idx" ON "StoreSighting"("seenAt");

-- CreateIndex
CREATE INDEX "Release_officialReleaseDate_idx" ON "Release"("officialReleaseDate");

-- CreateIndex
CREATE INDEX "Release_preorderDate_idx" ON "Release"("preorderDate");

-- CreateIndex
CREATE INDEX "Release_status_idx" ON "Release"("status");

-- CreateIndex
CREATE INDEX "Release_needsReview_idx" ON "Release"("needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseSyncSource_sourceUrl_key" ON "ReleaseSyncSource"("sourceUrl");

-- CreateIndex
CREATE INDEX "ReleaseSyncSource_sourceType_idx" ON "ReleaseSyncSource"("sourceType");

-- CreateIndex
CREATE INDEX "ReleaseSyncSource_adapter_idx" ON "ReleaseSyncSource"("adapter");

-- CreateIndex
CREATE INDEX "ReleaseSyncSource_enabled_idx" ON "ReleaseSyncSource"("enabled");

-- CreateIndex
CREATE INDEX "ReleaseSyncSource_lastStatus_idx" ON "ReleaseSyncSource"("lastStatus");

-- CreateIndex
CREATE INDEX "ReleaseSyncLog_checkedAt_idx" ON "ReleaseSyncLog"("checkedAt");

-- CreateIndex
CREATE INDEX "ReleaseSyncLog_adapter_idx" ON "ReleaseSyncLog"("adapter");

-- CreateIndex
CREATE INDEX "ReleaseSyncLog_status_idx" ON "ReleaseSyncLog"("status");

-- CreateIndex
CREATE INDEX "Alert_read_idx" ON "Alert"("read");

-- CreateIndex
CREATE INDEX "Alert_priority_idx" ON "Alert"("priority");

-- CreateIndex
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");

-- CreateIndex
CREATE INDEX "Alert_entityType_idx" ON "Alert"("entityType");

-- CreateIndex
CREATE INDEX "Alert_entityType_productId_idx" ON "Alert"("entityType", "productId");

-- CreateIndex
CREATE INDEX "Alert_timestamp_idx" ON "Alert"("timestamp");

-- CreateIndex
CREATE INDEX "Alert_score_idx" ON "Alert"("score");

-- CreateIndex
CREATE INDEX "Alert_dedupeKey_idx" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_falsePositiveAt_idx" ON "Alert"("falsePositiveAt");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_alertId_idx" ON "NotificationDeliveryLog"("alertId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_userId_idx" ON "NotificationDeliveryLog"("userId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_productId_idx" ON "NotificationDeliveryLog"("productId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_channel_idx" ON "NotificationDeliveryLog"("channel");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_status_idx" ON "NotificationDeliveryLog"("status");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_createdAt_idx" ON "NotificationDeliveryLog"("createdAt");

-- CreateIndex
CREATE INDEX "RestockHistory_productId_idx" ON "RestockHistory"("productId");

-- CreateIndex
CREATE INDEX "RestockHistory_checkedAt_idx" ON "RestockHistory"("checkedAt");

-- CreateIndex
CREATE INDEX "MonitorLog_productId_idx" ON "MonitorLog"("productId");

-- CreateIndex
CREATE INDEX "MonitorLog_startedAt_idx" ON "MonitorLog"("startedAt");

-- CreateIndex
CREATE INDEX "MonitorLog_status_idx" ON "MonitorLog"("status");

-- CreateIndex
CREATE INDEX "ProductDiscoverySource_retailerId_idx" ON "ProductDiscoverySource"("retailerId");

-- CreateIndex
CREATE INDEX "ProductDiscoverySource_enabled_idx" ON "ProductDiscoverySource"("enabled");

-- CreateIndex
CREATE INDEX "ProductDiscoverySource_nextCheckAt_idx" ON "ProductDiscoverySource"("nextCheckAt");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_sourceId_idx" ON "ProductDiscoveryCandidate"("sourceId");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_retailerId_idx" ON "ProductDiscoveryCandidate"("retailerId");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_status_idx" ON "ProductDiscoveryCandidate"("status");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_retailerProductId_idx" ON "ProductDiscoveryCandidate"("retailerProductId");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_upc_idx" ON "ProductDiscoveryCandidate"("upc");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_dpci_idx" ON "ProductDiscoveryCandidate"("dpci");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_sellerType_idx" ON "ProductDiscoveryCandidate"("sellerType");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_priceStatus_idx" ON "ProductDiscoveryCandidate"("priceStatus");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_alertEligibility_idx" ON "ProductDiscoveryCandidate"("alertEligibility");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_enrichmentStatus_idx" ON "ProductDiscoveryCandidate"("enrichmentStatus");

-- CreateIndex
CREATE INDEX "ProductDiscoveryCandidate_createdAt_idx" ON "ProductDiscoveryCandidate"("createdAt");

-- CreateIndex
CREATE INDEX "Card_releaseId_idx" ON "Card"("releaseId");

-- CreateIndex
CREATE INDEX "Card_setName_idx" ON "Card"("setName");

-- CreateIndex
CREATE INDEX "CardPriceSnapshot_cardId_idx" ON "CardPriceSnapshot"("cardId");

-- CreateIndex
CREATE INDEX "CardPriceSnapshot_snapshotAt_idx" ON "CardPriceSnapshot"("snapshotAt");

-- CreateIndex
CREATE INDEX "CardCompSale_cardId_idx" ON "CardCompSale"("cardId");

-- CreateIndex
CREATE INDEX "CardCompSale_gradeType_idx" ON "CardCompSale"("gradeType");

-- CreateIndex
CREATE INDEX "CardCompSale_sourceQuality_idx" ON "CardCompSale"("sourceQuality");

-- CreateIndex
CREATE INDEX "CardCompSale_reviewStatus_idx" ON "CardCompSale"("reviewStatus");

-- CreateIndex
CREATE INDEX "CardCompSale_soldAt_idx" ON "CardCompSale"("soldAt");

-- CreateIndex
CREATE INDEX "CardCompSale_matchScore_idx" ON "CardCompSale"("matchScore");

-- CreateIndex
CREATE INDEX "InvestmentReport_generatedAt_idx" ON "InvestmentReport"("generatedAt");

-- CreateIndex
CREATE INDEX "InvestmentReport_userId_idx" ON "InvestmentReport"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentSettings_userId_key" ON "InvestmentSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_publicSlug_key" ON "InventoryItem"("publicSlug");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_idx" ON "InventoryItem"("productId");

-- CreateIndex
CREATE INDEX "InventoryItem_cardId_idx" ON "InventoryItem"("cardId");

-- CreateIndex
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");

-- CreateIndex
CREATE INDEX "InventoryItem_listingStatus_idx" ON "InventoryItem"("listingStatus");

-- CreateIndex
CREATE INDEX "InventoryItem_recommendedAction_idx" ON "InventoryItem"("recommendedAction");

-- CreateIndex
CREATE INDEX "InventoryItem_marketProvider_idx" ON "InventoryItem"("marketProvider");

-- CreateIndex
CREATE INDEX "InventoryItem_marketProviderProductId_idx" ON "InventoryItem"("marketProviderProductId");

-- CreateIndex
CREATE INDEX "InventoryItem_marketProviderMatchStatus_idx" ON "InventoryItem"("marketProviderMatchStatus");

-- CreateIndex
CREATE INDEX "InventoryItem_publishToStore_idx" ON "InventoryItem"("publishToStore");

-- CreateIndex
CREATE INDEX "InventoryItem_storeStatus_idx" ON "InventoryItem"("storeStatus");

-- CreateIndex
CREATE INDEX "InventoryItem_storefrontCategory_idx" ON "InventoryItem"("storefrontCategory");

-- CreateIndex
CREATE INDEX "InventoryItem_publishedAt_idx" ON "InventoryItem"("publishedAt");

-- CreateIndex
CREATE INDEX "InventoryItem_purchasedAt_idx" ON "InventoryItem"("purchasedAt");

-- CreateIndex
CREATE INDEX "InventoryProductImage_inventoryItemId_idx" ON "InventoryProductImage"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryProductImage_inventoryItemId_sortOrder_idx" ON "InventoryProductImage"("inventoryItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "InventoryProductImage_isPrimary_idx" ON "InventoryProductImage"("isPrimary");

-- CreateIndex
CREATE INDEX "InventoryProductImage_showInStore_idx" ON "InventoryProductImage"("showInStore");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryProductImage_inventoryItemId_url_key" ON "InventoryProductImage"("inventoryItemId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "TcgcsvProduct_tcgcsvProductId_key" ON "TcgcsvProduct"("tcgcsvProductId");

-- CreateIndex
CREATE INDEX "TcgcsvProduct_categoryId_idx" ON "TcgcsvProduct"("categoryId");

-- CreateIndex
CREATE INDEX "TcgcsvProduct_groupId_idx" ON "TcgcsvProduct"("groupId");

-- CreateIndex
CREATE INDEX "TcgcsvProduct_normalizedName_idx" ON "TcgcsvProduct"("normalizedName");

-- CreateIndex
CREATE INDEX "TcgcsvProduct_groupName_idx" ON "TcgcsvProduct"("groupName");

-- CreateIndex
CREATE INDEX "TcgcsvProduct_lastSyncedAt_idx" ON "TcgcsvProduct"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "TcgcsvSyncLog_startedAt_idx" ON "TcgcsvSyncLog"("startedAt");

-- CreateIndex
CREATE INDEX "TcgcsvSyncLog_status_idx" ON "TcgcsvSyncLog"("status");

-- CreateIndex
CREATE INDEX "InventoryStockLot_inventoryItemId_idx" ON "InventoryStockLot"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryStockLot_purchasedAt_idx" ON "InventoryStockLot"("purchasedAt");

-- CreateIndex
CREATE INDEX "InventoryStockLot_remainingQuantity_idx" ON "InventoryStockLot"("remainingQuantity");

-- CreateIndex
CREATE INDEX "InventorySale_inventoryItemId_idx" ON "InventorySale"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventorySale_userId_idx" ON "InventorySale"("userId");

-- CreateIndex
CREATE INDEX "InventorySale_customerAccountId_idx" ON "InventorySale"("customerAccountId");

-- CreateIndex
CREATE INDEX "InventorySale_platform_idx" ON "InventorySale"("platform");

-- CreateIndex
CREATE INDEX "InventorySale_saleReference_idx" ON "InventorySale"("saleReference");

-- CreateIndex
CREATE INDEX "InventorySale_paymentMethod_idx" ON "InventorySale"("paymentMethod");

-- CreateIndex
CREATE INDEX "InventorySale_customerEmail_idx" ON "InventorySale"("customerEmail");

-- CreateIndex
CREATE INDEX "InventorySale_customerPhone_idx" ON "InventorySale"("customerPhone");

-- CreateIndex
CREATE INDEX "InventorySale_customerMatchMethod_idx" ON "InventorySale"("customerMatchMethod");

-- CreateIndex
CREATE INDEX "InventorySale_customerLinkSource_idx" ON "InventorySale"("customerLinkSource");

-- CreateIndex
CREATE INDEX "InventorySale_customerLinkedByUserId_idx" ON "InventorySale"("customerLinkedByUserId");

-- CreateIndex
CREATE INDEX "InventorySale_rewardsEligible_idx" ON "InventorySale"("rewardsEligible");

-- CreateIndex
CREATE INDEX "InventorySale_refundStatus_idx" ON "InventorySale"("refundStatus");

-- CreateIndex
CREATE INDEX "InventorySale_refundIdempotencyKey_idx" ON "InventorySale"("refundIdempotencyKey");

-- CreateIndex
CREATE INDEX "InventorySale_soldAt_idx" ON "InventorySale"("soldAt");

-- CreateIndex
CREATE INDEX "InventoryMarketComp_inventoryItemId_idx" ON "InventoryMarketComp"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryMarketComp_sourceQuality_idx" ON "InventoryMarketComp"("sourceQuality");

-- CreateIndex
CREATE INDEX "InventoryMarketComp_soldAt_idx" ON "InventoryMarketComp"("soldAt");

-- CreateIndex
CREATE INDEX "BarcodeScan_userId_idx" ON "BarcodeScan"("userId");

-- CreateIndex
CREATE INDEX "BarcodeScan_upc_idx" ON "BarcodeScan"("upc");

-- CreateIndex
CREATE INDEX "BarcodeScan_rawCode_idx" ON "BarcodeScan"("rawCode");

-- CreateIndex
CREATE INDEX "BarcodeScan_normalizedUpc_idx" ON "BarcodeScan"("normalizedUpc");

-- CreateIndex
CREATE INDEX "BarcodeScan_createdAt_idx" ON "BarcodeScan"("createdAt");

-- CreateIndex
CREATE INDEX "BarcodeScan_productId_idx" ON "BarcodeScan"("productId");

-- CreateIndex
CREATE INDEX "BarcodeScan_inventoryItemId_idx" ON "BarcodeScan"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontSettings_userId_key" ON "StorefrontSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProfile_key_key" ON "ShippingProfile"("key");

-- CreateIndex
CREATE INDEX "ShippingProfile_userId_idx" ON "ShippingProfile"("userId");

-- CreateIndex
CREATE INDEX "ShippingProfile_active_idx" ON "ShippingProfile"("active");

-- CreateIndex
CREATE INDEX "ShippingProfile_systemDefault_idx" ON "ShippingProfile"("systemDefault");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontCustomer_email_key" ON "StorefrontCustomer"("email");

-- CreateIndex
CREATE INDEX "StorefrontCustomer_userId_idx" ON "StorefrontCustomer"("userId");

-- CreateIndex
CREATE INDEX "StorefrontCustomer_customerAccountId_idx" ON "StorefrontCustomer"("customerAccountId");

-- CreateIndex
CREATE INDEX "StorefrontCustomer_email_idx" ON "StorefrontCustomer"("email");

-- CreateIndex
CREATE INDEX "StorefrontCustomer_stripeCustomerId_idx" ON "StorefrontCustomer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_email_key" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "CustomerAccount_userId_idx" ON "CustomerAccount"("userId");

-- CreateIndex
CREATE INDEX "CustomerAccount_email_idx" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "CustomerAccount_normalizedEmail_idx" ON "CustomerAccount"("normalizedEmail");

-- CreateIndex
CREATE INDEX "CustomerAccount_status_idx" ON "CustomerAccount"("status");

-- CreateIndex
CREATE INDEX "CustomerAccount_sessionRevokedBefore_idx" ON "CustomerAccount"("sessionRevokedBefore");

-- CreateIndex
CREATE INDEX "CustomerAccount_emailVerifiedAt_idx" ON "CustomerAccount"("emailVerifiedAt");

-- CreateIndex
CREATE INDEX "CustomerAuthRateLimit_action_idx" ON "CustomerAuthRateLimit"("action");

-- CreateIndex
CREATE INDEX "CustomerAuthRateLimit_emailKeyHash_idx" ON "CustomerAuthRateLimit"("emailKeyHash");

-- CreateIndex
CREATE INDEX "CustomerAuthRateLimit_clientKeyHash_idx" ON "CustomerAuthRateLimit"("clientKeyHash");

-- CreateIndex
CREATE INDEX "CustomerAuthRateLimit_windowStart_idx" ON "CustomerAuthRateLimit"("windowStart");

-- CreateIndex
CREATE INDEX "CustomerAuthRateLimit_blockedUntil_idx" ON "CustomerAuthRateLimit"("blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAuthRateLimit_action_emailKeyHash_clientKeyHash_win_key" ON "CustomerAuthRateLimit"("action", "emailKeyHash", "clientKeyHash", "windowStart");

-- CreateIndex
CREATE INDEX "PublicRateLimit_action_idx" ON "PublicRateLimit"("action");

-- CreateIndex
CREATE INDEX "PublicRateLimit_scope_idx" ON "PublicRateLimit"("scope");

-- CreateIndex
CREATE INDEX "PublicRateLimit_keyHash_idx" ON "PublicRateLimit"("keyHash");

-- CreateIndex
CREATE INDEX "PublicRateLimit_windowStart_idx" ON "PublicRateLimit"("windowStart");

-- CreateIndex
CREATE INDEX "PublicRateLimit_blockedUntil_idx" ON "PublicRateLimit"("blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PublicRateLimit_action_rule_keyHash_windowStart_key" ON "PublicRateLimit"("action", "rule", "keyHash", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerSession_customerAccountId_idx" ON "CustomerSession"("customerAccountId");

-- CreateIndex
CREATE INDEX "CustomerSession_lastActivityAt_idx" ON "CustomerSession"("lastActivityAt");

-- CreateIndex
CREATE INDEX "CustomerSession_absoluteExpiresAt_idx" ON "CustomerSession"("absoluteExpiresAt");

-- CreateIndex
CREATE INDEX "CustomerSession_revokedAt_idx" ON "CustomerSession"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPasswordResetToken_tokenHash_key" ON "CustomerPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerPasswordResetToken_customerAccountId_idx" ON "CustomerPasswordResetToken"("customerAccountId");

-- CreateIndex
CREATE INDEX "CustomerPasswordResetToken_expiresAt_idx" ON "CustomerPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "CustomerPasswordResetToken_usedAt_idx" ON "CustomerPasswordResetToken"("usedAt");

-- CreateIndex
CREATE INDEX "CustomerSavedAddress_customerAccountId_idx" ON "CustomerSavedAddress"("customerAccountId");

-- CreateIndex
CREATE INDEX "CustomerSavedAddress_customerAccountId_isDefault_idx" ON "CustomerSavedAddress"("customerAccountId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMagicLinkToken_tokenHash_key" ON "CustomerMagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerMagicLinkToken_customerAccountId_idx" ON "CustomerMagicLinkToken"("customerAccountId");

-- CreateIndex
CREATE INDEX "CustomerMagicLinkToken_email_idx" ON "CustomerMagicLinkToken"("email");

-- CreateIndex
CREATE INDEX "CustomerMagicLinkToken_expiresAt_idx" ON "CustomerMagicLinkToken"("expiresAt");

-- CreateIndex
CREATE INDEX "CustomerMagicLinkToken_usedAt_idx" ON "CustomerMagicLinkToken"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_orderNumber_key" ON "StorefrontOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_stripeCheckoutSessionId_key" ON "StorefrontOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "StorefrontOrder_userId_idx" ON "StorefrontOrder"("userId");

-- CreateIndex
CREATE INDEX "StorefrontOrder_customerId_idx" ON "StorefrontOrder"("customerId");

-- CreateIndex
CREATE INDEX "StorefrontOrder_customerAccountId_idx" ON "StorefrontOrder"("customerAccountId");

-- CreateIndex
CREATE INDEX "StorefrontOrder_customerLinkSource_idx" ON "StorefrontOrder"("customerLinkSource");

-- CreateIndex
CREATE INDEX "StorefrontOrder_customerLinkedByUserId_idx" ON "StorefrontOrder"("customerLinkedByUserId");

-- CreateIndex
CREATE INDEX "StorefrontOrder_status_idx" ON "StorefrontOrder"("status");

-- CreateIndex
CREATE INDEX "StorefrontOrder_paymentStatus_idx" ON "StorefrontOrder"("paymentStatus");

-- CreateIndex
CREATE INDEX "StorefrontOrder_fulfillmentStatus_idx" ON "StorefrontOrder"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "StorefrontOrder_refundStatus_idx" ON "StorefrontOrder"("refundStatus");

-- CreateIndex
CREATE INDEX "StorefrontOrder_isTestOrder_idx" ON "StorefrontOrder"("isTestOrder");

-- CreateIndex
CREATE INDEX "StorefrontOrder_createdAt_idx" ON "StorefrontOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingQuote_quoteToken_key" ON "ShippingQuote"("quoteToken");

-- CreateIndex
CREATE INDEX "ShippingQuote_userId_idx" ON "ShippingQuote"("userId");

-- CreateIndex
CREATE INDEX "ShippingQuote_orderId_idx" ON "ShippingQuote"("orderId");

-- CreateIndex
CREATE INDEX "ShippingQuote_expiresAt_idx" ON "ShippingQuote"("expiresAt");

-- CreateIndex
CREATE INDEX "ShippingQuote_destinationZip_idx" ON "ShippingQuote"("destinationZip");

-- CreateIndex
CREATE INDEX "ShippingQuote_cartHash_idx" ON "ShippingQuote"("cartHash");

-- CreateIndex
CREATE INDEX "StorefrontOrderItem_orderId_idx" ON "StorefrontOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "StorefrontOrderItem_inventoryItemId_idx" ON "StorefrontOrderItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockReservation_inventoryItemId_idx" ON "StockReservation"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_stripeCheckoutSessionId_idx" ON "StockReservation"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "StockReservation_status_idx" ON "StockReservation"("status");

-- CreateIndex
CREATE INDEX "StockReservation_expiresAt_idx" ON "StockReservation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_eventId_key" ON "PaymentEvent"("eventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_idx" ON "PaymentEvent"("orderId");

-- CreateIndex
CREATE INDEX "PaymentEvent_eventType_idx" ON "PaymentEvent"("eventType");

-- CreateIndex
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedgerEntry_idempotencyKey_key" ON "RewardLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_customerAccountId_idx" ON "RewardLedgerEntry"("customerAccountId");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_orderId_idx" ON "RewardLedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_type_idx" ON "RewardLedgerEntry"("type");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_status_idx" ON "RewardLedgerEntry"("status");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_availableAt_idx" ON "RewardLedgerEntry"("availableAt");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_source_idx" ON "RewardLedgerEntry"("source");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_reversalOfEntryId_idx" ON "RewardLedgerEntry"("reversalOfEntryId");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_createdAt_idx" ON "RewardLedgerEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_orderId_key" ON "Fulfillment"("orderId");

-- CreateIndex
CREATE INDEX "DailyRecap_userId_idx" ON "DailyRecap"("userId");

-- CreateIndex
CREATE INDEX "DailyRecap_recapDate_idx" ON "DailyRecap"("recapDate");

-- CreateIndex
CREATE INDEX "DailyRecap_createdAt_idx" ON "DailyRecap"("createdAt");

-- CreateIndex
CREATE INDEX "SavedFilterPreset_userId_idx" ON "SavedFilterPreset"("userId");

-- CreateIndex
CREATE INDEX "SavedFilterPreset_section_idx" ON "SavedFilterPreset"("section");

-- CreateIndex
CREATE INDEX "ProductPriorityScore_productId_idx" ON "ProductPriorityScore"("productId");

-- CreateIndex
CREATE INDEX "ProductPriorityScore_releaseId_idx" ON "ProductPriorityScore"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_userId_key" ON "NotificationSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserPushSubscription_endpoint_key" ON "BrowserPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "BrowserPushSubscription_userId_idx" ON "BrowserPushSubscription"("userId");

-- CreateIndex
CREATE INDEX "BrowserPushSubscription_disabledAt_idx" ON "BrowserPushSubscription"("disabledAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendInvite" ADD CONSTRAINT "FriendInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendInvite" ADD CONSTRAINT "FriendInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStorePreference" ADD CONSTRAINT "UserStorePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStorePreference" ADD CONSTRAINT "UserStorePreference_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSighting" ADD CONSTRAINT "StoreSighting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSighting" ADD CONSTRAINT "StoreSighting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockHistory" ADD CONSTRAINT "RestockHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorLog" ADD CONSTRAINT "MonitorLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiscoverySource" ADD CONSTRAINT "ProductDiscoverySource_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiscoveryCandidate" ADD CONSTRAINT "ProductDiscoveryCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProductDiscoverySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiscoveryCandidate" ADD CONSTRAINT "ProductDiscoveryCandidate_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPriceSnapshot" ADD CONSTRAINT "CardPriceSnapshot_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCompSale" ADD CONSTRAINT "CardCompSale_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentReport" ADD CONSTRAINT "InvestmentReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentSettings" ADD CONSTRAINT "InvestmentSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProductImage" ADD CONSTRAINT "InventoryProductImage_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockLot" ADD CONSTRAINT "InventoryStockLot_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySale" ADD CONSTRAINT "InventorySale_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySale" ADD CONSTRAINT "InventorySale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySale" ADD CONSTRAINT "InventorySale_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMarketComp" ADD CONSTRAINT "InventoryMarketComp_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeScan" ADD CONSTRAINT "BarcodeScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeScan" ADD CONSTRAINT "BarcodeScan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeScan" ADD CONSTRAINT "BarcodeScan_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSettings" ADD CONSTRAINT "StorefrontSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingProfile" ADD CONSTRAINT "ShippingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontCustomer" ADD CONSTRAINT "StorefrontCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontCustomer" ADD CONSTRAINT "StorefrontCustomer_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPasswordResetToken" ADD CONSTRAINT "CustomerPasswordResetToken_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSavedAddress" ADD CONSTRAINT "CustomerSavedAddress_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMagicLinkToken" ADD CONSTRAINT "CustomerMagicLinkToken_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "StorefrontCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingQuote" ADD CONSTRAINT "ShippingQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrderItem" ADD CONSTRAINT "StorefrontOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrderItem" ADD CONSTRAINT "StorefrontOrderItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedgerEntry" ADD CONSTRAINT "RewardLedgerEntry_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedgerEntry" ADD CONSTRAINT "RewardLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBalance" ADD CONSTRAINT "RewardBalance_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecap" ADD CONSTRAINT "DailyRecap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilterPreset" ADD CONSTRAINT "SavedFilterPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriorityScore" ADD CONSTRAINT "ProductPriorityScore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserPushSubscription" ADD CONSTRAINT "BrowserPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
