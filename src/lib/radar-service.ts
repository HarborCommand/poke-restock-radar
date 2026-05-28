import { Prisma } from "@prisma/client";
import { listAccessOverview } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getAppHealth } from "@/lib/health";
import { deliverAlert, notificationSummary } from "@/lib/notifications";
import { exactProductActionUrl, matchProductIdentity, productReadyForBuyAlerts } from "@/lib/product-identity";
import { runProductDiscoveryCheck, validateDiscoverySourceUrl } from "@/lib/product-discovery";
import { productSearchConfig, searchProductsByUpc, type ProductSearchCandidate } from "@/lib/product-search";
import { detectRetailerPrice, detectTargetAvailability, fetchTargetRedskyLiveSignal } from "@/lib/retailer-page-signals";
import { retailerTemplates, validateRetailerUrl } from "@/lib/retailer-templates";
import { getStorefrontSettings, listStorefrontOrders, storefrontSummary } from "@/lib/storefront";
import { compactLookupText, normalizeUPC } from "@/lib/upc";
import { productCreateSchema, releaseCreateSchema, storeCreateSchema } from "@/lib/validation";
import { ebayConnectionStatus, ebayMode, fetchLastThreeEbayComps, fetchLastThreeInventoryEbayComps, testEbayConnection } from "@/lib/ebay";
import {
  calculateCardProfit,
  calculateMaxRawBuyPrice,
  daysUntil,
  predictStoreRestock,
  rateCard
} from "@/lib/calculations";
import type {
  AlertDTO,
  AlertAnalyticsDTO,
  CardDTO,
  CardCompSaleDTO,
  CompSourceQuality,
  DataQualityWarningDTO,
  DashboardDTO,
  GradeType,
  InvestmentSettingsDTO,
  InvestmentReportDTO,
  InvestmentReportItemDTO,
  InventoryItemDTO,
  InventoryMarketCompDTO,
  InventorySaleDTO,
  InventoryStockLotDTO,
  InventorySummaryDTO,
  DailyRecapDTO,
  MonitorAccuracyStatsDTO,
  MonitorLogDTO,
  NotificationSettingsDTO,
  OwnerLaunchChecklistItemDTO,
  Priority,
  ProductDTO,
  ProductDiscoveryCandidateDTO,
  ProductDiscoverySourceDTO,
  ProductPriorityScoreDTO,
  ProductVerificationStatus,
  ProductStatus,
  Rating,
  ReleaseDTO,
  RetailerDTO,
  SavedFilterPresetDTO,
  SetupChecklistItemDTO,
  SessionUser,
  ScannerStatusDTO,
  SightingDTO,
  AlertCalibrationItemDTO,
  BarcodeScanDTO,
  StoreDTO,
  StoreVisitResult,
  UpcLookupDebugDTO,
  UpcLookupFailureDTO,
  UpcLookupProductDTO,
  UpcLookupResultDTO,
  UserAreaPreferencesDTO,
  Zone,
  ZoneOptionDTO
} from "@/types/radar";

const productInclude = {
  retailer: { select: { id: true, name: true, website: true } },
  release: {
    select: {
      id: true,
      setName: true,
      pokemonCenterExclusiveVersion: true,
      demandRating: true,
      estimatedDemand: true,
      sealedProductPriority: true
    }
  }
} satisfies Prisma.ProductInclude;

let inventoryMetadataSchemaReady: Promise<void> | null = null;

async function ensureProductionInventoryMetadataColumns() {
  if (process.env.NODE_ENV !== "production") return;
  inventoryMetadataSchemaReady ??= (async () => {
    const columns = [
      ['"brand"', "TEXT"],
      ['"description"', "TEXT"],
      ['"manufacturer"', "TEXT"],
      ['"model"', "TEXT"],
      ['"msrp"', "DOUBLE PRECISION"]
    ];
    for (const [columnName, columnType] of columns) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS ${columnName} ${columnType}`);
    }
  })().catch((error) => {
    inventoryMetadataSchemaReady = null;
    throw error;
  });
  await inventoryMetadataSchemaReady;
}

const productDiscoverySourceInclude = {
  retailer: { select: { name: true } }
} satisfies Prisma.ProductDiscoverySourceInclude;

const productDiscoveryCandidateInclude = {
  retailer: { select: { name: true } },
  source: { select: { name: true } }
} satisfies Prisma.ProductDiscoveryCandidateInclude;

const storeInclude = {
  retailer: { select: { id: true, name: true, website: true } },
  sightings: {
    orderBy: { seenAt: "desc" as const },
    take: 40
  }
} satisfies Prisma.StoreInclude;

export const zoneOptions: ZoneOptionDTO[] = [
  { value: "MIAMI", label: "Miami" },
  { value: "FORT_LAUDERDALE", label: "Fort Lauderdale" },
  { value: "ORLANDO", label: "Orlando" },
  { value: "TAMPA", label: "Tampa" },
  { value: "JACKSONVILLE", label: "Jacksonville" },
  { value: "CUSTOM", label: "Custom" }
];

const gradeTypes: GradeType[] = ["RAW", "PSA_9", "PSA_10", "BGS_9_5", "BGS_10", "BGS_BLACK_LABEL"];

function zoneLabel(zone: string | null | undefined, customZoneName?: string | null) {
  if (zone === "CUSTOM" && customZoneName) return customZoneName;
  return zoneOptions.find((option) => option.value === zone)?.label ?? "Miami";
}

function distanceMilesBetween(
  from: { latitude?: number | null; longitude?: number | null },
  to: { latitude?: number | null; longitude?: number | null }
) {
  if (
    from.latitude === null ||
    from.latitude === undefined ||
    from.longitude === null ||
    from.longitude === undefined ||
    to.latitude === null ||
    to.latitude === undefined ||
    to.longitude === null ||
    to.longitude === undefined
  ) {
    return null;
  }
  const radians = Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = (to.latitude - from.latitude) * radians;
  const dLon = (to.longitude - from.longitude) * radians;
  const lat1 = from.latitude * radians;
  const lat2 = to.latitude * radians;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const monitorLogInclude = {
  product: { select: { name: true } }
} satisfies Prisma.MonitorLogInclude;

const cardInclude = {
  release: { select: { id: true, setName: true } },
  compSales: {
    orderBy: { soldAt: "desc" as const },
    select: {
      id: true,
      cardId: true,
      soldAt: true,
      source: true,
      sourceQuality: true,
      gradeType: true,
      salePrice: true,
      sourceUrl: true,
      saleTitle: true,
      matchScore: true,
      conditionNotes: true,
      reviewStatus: true,
      rejectedAt: true
    }
  }
} satisfies Prisma.CardInclude;

const compSaleInclude = {
  card: { select: { cardName: true, setName: true, cardNumber: true } }
} satisfies Prisma.CardCompSaleInclude;

const inventoryItemInclude = {
  product: {
    select: {
      id: true,
      name: true,
      retailer: { select: { name: true } },
      url: true,
      verifiedFinalUrl: true,
      retailerProductId: true,
      sku: true,
      upc: true,
      dpci: true,
      setName: true,
      productType: true,
      liveImageUrl: true,
      imageUrl: true,
      livePrice: true,
      liveStockStatus: true,
      stockStatus: true,
      priority: true,
      rating: true,
      sealedResaleNotes: true,
      scarcityNotes: true,
      manualPriorityOverride: true
    }
  },
  card: {
    select: {
      id: true,
      cardName: true,
      rawAveragePrice: true,
      psa9AverageSalePrice: true,
      psa10AverageSalePrice: true,
      psa9EstimatedProfit: true,
      psa10EstimatedProfit: true,
      rating: true
    }
  },
  marketComps: {
    orderBy: { soldAt: "desc" as const },
    take: 3
  },
  stockLots: {
    orderBy: { purchasedAt: "desc" as const }
  },
  sales: {
    orderBy: { soldAt: "desc" as const }
  }
} satisfies Prisma.InventoryItemInclude;

function recentCompCount(compSales: Array<{ soldAt: Date }>) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  return compSales.filter((sale) => sale.soldAt.getTime() >= cutoff).length;
}

function computeTop10Score(input: {
  rawAveragePrice: number;
  psa9EstimatedProfit: number;
  psa10EstimatedProfit: number;
  minimumProfitTarget: number;
  compCount: number;
  recentCompCount: number;
  strongCharacterDemand: boolean;
  lowPop: boolean;
  lowNumberedSerialized: boolean;
  newRelease: boolean;
}) {
  let score = 0;
  if (input.psa9EstimatedProfit >= input.minimumProfitTarget) score += 40;
  else if (input.psa9EstimatedProfit > 0) score += 18;

  score += Math.min(30, Math.max(0, Math.round(input.psa10EstimatedProfit / 4)));
  if (input.rawAveragePrice > 0 && input.rawAveragePrice <= 25) score += 15;
  else if (input.rawAveragePrice <= 75) score += 9;
  else if (input.rawAveragePrice <= 150) score += 4;

  if (input.recentCompCount >= 4) score += 12;
  else if (input.recentCompCount >= 2) score += 8;
  else if (input.compCount > 0) score += 4;

  if (input.strongCharacterDemand) score += 10;
  if (input.lowPop) score += 8;
  if (input.lowNumberedSerialized) score += 8;
  if (input.newRelease) score += 4;
  return Math.max(0, Math.min(100, score));
}

function sourceQualityWeight(sourceQuality: string | null | undefined) {
  if (sourceQuality === "EBAY_SOLD") return 1;
  if (sourceQuality === "TCGPLAYER") return 0.85;
  if (sourceQuality === "PRICECHARTING") return 0.75;
  return 0.45;
}

function computeCardConfidence(input: {
  rawAveragePrice: number;
  psa9AverageSalePrice: number;
  psa10AverageSalePrice: number;
  bgs10AverageSalePrice: number;
  bgsBlackLabelAverageSalePrice: number;
  compSales: Array<{ soldAt: Date; sourceQuality?: string | null }>;
}) {
  const compCount = input.compSales.length;
  const countScore = Math.min(35, compCount * 5);
  const recentCount = recentCompCount(input.compSales);
  const freshnessScore = Math.min(25, recentCount * 6 + (compCount > 0 ? 4 : 0));
  const qualityAverage = compCount
    ? input.compSales.reduce((sum, sale) => sum + sourceQualityWeight(sale.sourceQuality), 0) / compCount
    : 0.45;
  const sourceScore = Math.round(25 * qualityAverage);
  const gradedValues = [
    input.psa9AverageSalePrice,
    input.psa10AverageSalePrice,
    input.bgs10AverageSalePrice,
    input.bgsBlackLabelAverageSalePrice
  ].filter((value) => value > 0);
  const gradedAverage = average(gradedValues) ?? 0;
  const spreadRatio = input.rawAveragePrice > 0 && gradedAverage > 0 ? gradedAverage / input.rawAveragePrice : 0;
  const spreadScore = spreadRatio >= 1.2 && spreadRatio <= 8 ? 15 : spreadRatio > 8 && spreadRatio <= 15 ? 10 : spreadRatio > 15 ? 5 : 6;
  return Math.max(0, Math.min(100, countScore + freshnessScore + sourceScore + spreadScore));
}

function scoreFromPriority(priority: string | null | undefined, high: number, medium: number, low = 2) {
  if (priority === "HIGH") return high;
  if (priority === "MEDIUM") return medium;
  return low;
}

function includesAny(text: string | null | undefined, terms: string[]) {
  const normalized = (text || "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

type ProductScoreInput = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type ReleaseScoreInput = Prisma.ReleaseGetPayload<Record<string, never>>;
type CardScoreInput = Prisma.CardGetPayload<{ include: typeof cardInclude }>;

function computeProductPriorityScore(
  product: ProductScoreInput,
  release: ReleaseScoreInput | null,
  cardsInSet: CardScoreInput[]
): ProductPriorityScoreDTO {
  const retailPriceScore =
    product.retailPrice === null
      ? 2
      : product.retailPrice <= 30
        ? 12
        : product.retailPrice <= 60
          ? 9
          : product.retailPrice <= 120
            ? 5
            : 2;
  const statusScore = ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product.stockStatus)
    ? 25
    : ["PRICE_CHANGE", "PAGE_UPDATED"].includes(product.stockStatus)
      ? 10
      : product.stockStatus === "SOLD_OUT"
        ? 2
        : 0;
  const demand = release?.estimatedDemand || release?.demandRating || product.priority;
  const resaleDemandScore = scoreFromPriority(demand, 15, 8);
  const setPopularityScore = scoreFromPriority(release?.sealedProductPriority || release?.priority || product.priority, 10, 6);
  const chaseCardScore = Math.min(
    12,
    (release?.chaseCards ? 4 : 0) +
      cardsInSet.filter((card) => card.strongCharacterDemand || card.top10Score >= 70).length * 3
  );
  const profitablePsa9Count = cardsInSet.filter((card) => card.psa9EstimatedProfit >= card.minimumProfitTarget).length;
  const psa10Upside = Number(
    cardsInSet.reduce((best, card) => Math.max(best, card.psa10EstimatedProfit), 0).toFixed(2)
  );
  const cardInvestmentScore = Math.min(24, profitablePsa9Count * 5 + Math.max(0, Math.round(psa10Upside / 35)));
  const sealedValueScore =
    scoreFromPriority(release?.sealedProductPriority || product.priority, 8, 4, 1) +
    (includesAny(product.sealedResaleNotes, ["premium", "exclusive", "resale", "sealed", "allocation"]) ? 4 : 0);
  const scarcityScore =
    (product.release?.pokemonCenterExclusiveVersion || release?.pokemonCenterExclusiveVersion ? 5 : 0) +
    (includesAny(product.scarcityNotes, ["scarce", "limited", "allocation", "exclusive", "short print"]) ? 5 : 0);
  const manualOverride = (product.manualPriorityOverride || product.rating || null) as ProductPriorityScoreDTO["manualOverride"];
  const manualScore = manualOverride === "BUY" ? 14 : manualOverride === "SKIP" ? -35 : 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      retailPriceScore +
        statusScore +
        resaleDemandScore +
        setPopularityScore +
        chaseCardScore +
        cardInvestmentScore +
        sealedValueScore +
        scarcityScore +
        manualScore
    )
  );
  const buyWatchSkip: Rating =
    manualOverride === "SKIP" ? "SKIP" : score >= 70 ? "BUY" : score >= 40 ? "WATCH" : "SKIP";
  const setName = release?.setName || product.setName || product.name;
  const reasons = [
    `${setName} has ${profitablePsa9Count} profitable PSA 9 target${profitablePsa9Count === 1 ? "" : "s"}`,
    psa10Upside > 0 ? `best PSA 10 upside is $${psa10Upside}` : "PSA 10 upside is not established",
    `product is ${product.stockStatus.replaceAll("_", " ").toLowerCase()}`,
    `${demand.toLowerCase()} estimated demand`
  ];
  if (release?.pokemonCenterExclusiveVersion || product.release?.pokemonCenterExclusiveVersion) {
    reasons.push("Pokemon Center exclusive version tracked");
  }
  if (manualOverride && manualOverride !== "WATCH") reasons.push(`manual override is ${manualOverride.toLowerCase()}`);

  return {
    buyWatchSkip,
    score,
    retailPriceScore,
    resaleDemandScore,
    setPopularityScore,
    scarcityScore,
    chaseCardScore,
    sealedValueScore,
    cardInvestmentScore,
    profitablePsa9Count,
    psa10Upside,
    manualOverride,
    reason: `${buyWatchSkip === "BUY" ? "High" : buyWatchSkip === "WATCH" ? "Medium" : "Low"} priority because ${reasons.join(
      " and "
    )}.`,
    computedAt: new Date().toISOString()
  };
}

function productToDTO(
  product: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
  priorityScore: ProductPriorityScoreDTO | null = null
): ProductDTO {
  return {
    id: product.id,
    name: product.name,
    retailerId: product.retailerId,
    retailerName: product.retailer.name,
    releaseId: product.releaseId,
    releaseName: product.release?.setName ?? null,
    setName: product.setName,
    productType: product.productType,
    imageUrl: product.imageUrl,
    expectedTitleKeywords: product.expectedTitleKeywords,
    url: product.url,
    sku: product.sku,
    upc: product.upc,
    dpci: product.dpci,
    retailerProductId: product.retailerProductId,
    verificationStatus: product.verificationStatus as ProductVerificationStatus,
    verifiedAt: product.verifiedAt?.toISOString() ?? null,
    verifiedFinalUrl: product.verifiedFinalUrl,
    verificationNotes: product.verificationNotes,
    retailPrice: product.retailPrice,
    liveTitle: product.liveTitle,
    livePrice: product.livePrice,
    livePriceSource: product.livePriceSource,
    livePriceVerifiedAt: product.livePriceVerifiedAt?.toISOString() ?? null,
    liveStockStatus: product.liveStockStatus as ProductStatus | null,
    liveStockVerifiedAt: product.liveStockVerifiedAt?.toISOString() ?? null,
    liveImageUrl: product.liveImageUrl,
    liveConfidenceScore: product.liveConfidenceScore,
    liveBlockedType: product.liveBlockedType,
    isDemoData: product.isDemoData,
    stockStatus: product.stockStatus as ProductStatus,
    alertStatus: product.alertStatus,
    priority: product.priority as Priority,
    rating: product.rating as Rating,
    notes: product.notes,
    lastCheckedAt: product.lastCheckedAt?.toISOString() ?? null,
    lastSuccessfulCheckedAt: product.lastSuccessfulCheckedAt?.toISOString() ?? null,
    monitorEnabled: product.monitorEnabled,
    checkFrequencyMinutes: product.checkFrequencyMinutes,
    nextCheckAt: product.nextCheckAt?.toISOString() ?? null,
    lastMonitorResult: product.lastMonitorResult,
    lastMonitorError: product.lastMonitorError,
    lastAlertSentAt: product.lastAlertSentAt?.toISOString() ?? null,
    requiredWords: product.requiredWords,
    ignoreWords: product.ignoreWords,
    pendingAlertStatus: product.pendingAlertStatus,
    pendingAlertCount: product.pendingAlertCount,
    pendingAlertReason: product.pendingAlertReason,
    pendingAlertConfidence: product.pendingAlertConfidence,
    pendingAlertDetectedWords: product.pendingAlertDetectedWords,
    pendingAlertAt: product.pendingAlertAt?.toISOString() ?? null,
    sealedResaleNotes: product.sealedResaleNotes,
    scarcityNotes: product.scarcityNotes,
    manualPriorityOverride: product.manualPriorityOverride as Rating | null,
    archivedAt: product.archivedAt?.toISOString() ?? null,
    pokemonCenterExclusiveVersion: product.release?.pokemonCenterExclusiveVersion ?? false,
    priorityScore,
    updatedAt: product.updatedAt.toISOString()
  };
}

function storeToDTO(
  store: Prisma.StoreGetPayload<{ include: typeof storeInclude }>,
  preference?: { favorite: boolean; hidden: boolean } | null,
  preferredZone: Zone = "MIAMI",
  customZoneName?: string | null,
  userLocation?: { latitude?: number | null; longitude?: number | null }
): StoreDTO {
  const distanceMiles = userLocation
    ? distanceMilesBetween(userLocation, { latitude: store.latitude, longitude: store.longitude })
    : null;
  const prediction = predictStoreRestock({
    typicalRestockDays: store.typicalRestockDays,
    typicalRestockTimeWindow: store.typicalRestockTimeWindow,
    confidenceScore: store.confidenceScore,
    sightings: store.sightings.map((sighting) => ({
      seenAt: sighting.seenAt,
      resultType: sighting.resultType as StoreVisitResult
    }))
  });

  return {
    id: store.id,
    retailerId: store.retailerId,
    retailerName: store.retailer.name,
    storeName: store.storeName,
    address: store.address,
    city: store.city,
    state: store.state,
    zone: store.zone as Zone,
    zoneLabel: zoneLabel(store.zone, customZoneName),
    latitude: store.latitude,
    longitude: store.longitude,
    distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles * 10) / 10,
    isFavorite: Boolean(preference?.favorite),
    hiddenByUser: Boolean(preference?.hidden),
    distanceRank: distanceMiles === null ? (store.zone === preferredZone ? 0 : preference?.favorite ? 1 : 999) : distanceMiles,
    notes: store.notes,
    typicalRestockDays: store.typicalRestockDays,
    typicalRestockTimeWindow: store.typicalRestockTimeWindow,
    vendorNotes: store.vendorNotes,
    confidenceScore: store.confidenceScore,
    prediction
  };
}

function sightingToDTO(
  sighting: Prisma.StoreSightingGetPayload<{
    include: { store: { select: { storeName: true } }; user: { select: { name: true } } };
  }>
): SightingDTO {
  return {
    id: sighting.id,
    storeId: sighting.storeId,
    userId: sighting.userId,
    storeName: sighting.store.storeName,
    productSeen: sighting.productSeen,
    resultType: sighting.resultType as StoreVisitResult,
    seenAt: sighting.seenAt.toISOString(),
    quantityEstimate: sighting.quantityEstimate,
    shelfPhotoUrl: sighting.shelfPhotoUrl,
    notes: sighting.notes,
    userName: sighting.user.name
  };
}

function releaseToDTO(
  release: Prisma.ReleaseGetPayload<Record<string, never>>,
  metrics: { productCount: number; cardCount: number; profitablePsa9Count: number; psa10Upside: number } = {
    productCount: 0,
    cardCount: 0,
    profitablePsa9Count: 0,
    psa10Upside: 0
  }
): ReleaseDTO {
  return {
    id: release.id,
    setName: release.setName,
    productType: release.productType,
    officialReleaseDate: release.officialReleaseDate.toISOString(),
    preorderDate: release.preorderDate?.toISOString() ?? null,
    productTypes: release.productTypes,
    pokemonCenterExclusiveVersion: release.pokemonCenterExclusiveVersion,
    chaseCards: release.chaseCards,
    demandRating: release.demandRating as Priority,
    estimatedDemand: release.estimatedDemand as Priority,
    priority: release.priority as Priority,
    sealedProductPriority: release.sealedProductPriority as Priority,
    notes: release.notes,
    productLinks: release.productLinks,
    daysUntilRelease: daysUntil(release.officialReleaseDate),
    daysUntilPreorder: release.preorderDate ? daysUntil(release.preorderDate) : null,
    ...metrics
  };
}

function cardToDTO(card: Prisma.CardGetPayload<{ include: typeof cardInclude }>): CardDTO {
  const acceptedCompSales = card.compSales.filter((sale) => sale.reviewStatus !== "REJECTED");
  const compCount = acceptedCompSales.length;
  const compsForGrade = (gradeType: GradeType) =>
    acceptedCompSales.filter((sale) => ((sale.gradeType || "RAW") as GradeType) === gradeType);
  const lastThreeComps = gradeTypes
    .flatMap((gradeType) => compsForGrade(gradeType).slice(0, 3))
    .map((sale) => ({
      id: sale.id,
      cardId: card.id,
      cardName: card.cardName,
      setName: card.setName,
      cardNumber: card.cardNumber,
      gradeType: (sale.gradeType || "RAW") as GradeType,
      salePrice: sale.salePrice,
      soldAt: sale.soldAt.toISOString(),
      source: sale.source,
      sourceQuality: (sale.sourceQuality || "EBAY_SOLD") as CompSourceQuality,
      sourceUrl: sale.sourceUrl,
      saleTitle: sale.saleTitle,
      matchScore: sale.matchScore,
      conditionNotes: sale.conditionNotes,
      reviewStatus: (sale.reviewStatus || "ACCEPTED") as "ACCEPTED" | "REJECTED",
      rejectedAt: sale.rejectedAt?.toISOString() ?? null
    }));
  return {
    id: card.id,
    releaseId: card.releaseId,
    releaseName: card.release?.setName ?? null,
    cardName: card.cardName,
    setName: card.setName,
    cardNumber: card.cardNumber,
    rarity: card.rarity,
    rawAveragePrice: card.rawAveragePrice,
    psa9AverageSalePrice: card.psa9AverageSalePrice,
    psa10AverageSalePrice: card.psa10AverageSalePrice,
    bgs95AverageSalePrice: card.bgs95AverageSalePrice,
    bgs10AverageSalePrice: card.bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice: card.bgsBlackLabelAverageSalePrice,
    estimatedEbayFee: card.estimatedEbayFee,
    estimatedGradingCost: card.estimatedGradingCost,
    estimatedShippingCost: card.estimatedShippingCost,
    minimumProfitTarget: card.minimumProfitTarget,
    psa9EstimatedProfit: card.psa9EstimatedProfit,
    psa10EstimatedProfit: card.psa10EstimatedProfit,
    bgs10EstimatedProfit: card.bgs10EstimatedProfit,
    blackLabelEstimatedProfit: card.blackLabelEstimatedProfit,
    maxRawBuyPricePsa9: card.maxRawBuyPricePsa9,
    maxRawBuyPrice: card.maxRawBuyPrice,
    top10Score: card.top10Score,
    compConfidenceScore: card.compConfidenceScore,
    rating: card.rating as Rating,
    dataSource: card.dataSource,
    lastRefreshed: card.lastRefreshed.toISOString(),
    notes: card.notes,
    characterName: card.characterName,
    era: card.era as CardDTO["era"],
    lowPop: card.lowPop,
    newRelease: card.newRelease,
    lowNumberedSerialized: card.lowNumberedSerialized,
    strongCharacterDemand: card.strongCharacterDemand,
    ebayIncludeWords: card.ebayIncludeWords,
    ebayExcludeWords: card.ebayExcludeWords,
    ebayExactSetName: card.ebayExactSetName,
    ebayCardNumberRequired: card.ebayCardNumberRequired,
    ebayRawKeywords: card.ebayRawKeywords,
    ebayPsa9Keywords: card.ebayPsa9Keywords,
    ebayPsa10Keywords: card.ebayPsa10Keywords,
    ebayAllowNonEnglish: card.ebayAllowNonEnglish,
    lastCompAt: card.lastCompAt?.toISOString() ?? null,
    compCount,
    recentCompCount: recentCompCount(acceptedCompSales),
    rawCompCount: compsForGrade("RAW").length,
    psa9CompCount: compsForGrade("PSA_9").length,
    psa10CompCount: compsForGrade("PSA_10").length,
    lastThreeComps
  };
}

function alertToDTO(alert: Prisma.AlertGetPayload<Record<string, never>>): AlertDTO {
  return {
    id: alert.id,
    title: alert.title,
    reason: alert.reason,
    priority: alert.priority as Priority,
    timestamp: alert.timestamp.toISOString(),
    entityType: alert.entityType,
    entityId: alert.entityId,
    actionUrl: alert.actionUrl,
    read: alert.read,
    score: alert.score,
    dedupeKey: alert.dedupeKey,
    explanation: alert.explanation,
    falsePositiveAt: alert.falsePositiveAt?.toISOString() ?? null,
    suppressedAt: alert.suppressedAt?.toISOString() ?? null,
    cooldownUntil: alert.cooldownUntil?.toISOString() ?? null
  };
}

function retailerToDTO(retailer: Prisma.RetailerGetPayload<Record<string, never>>): RetailerDTO {
  return {
    id: retailer.id,
    name: retailer.name,
    website: retailer.website
  };
}

function productDiscoverySourceToDTO(
  source: Prisma.ProductDiscoverySourceGetPayload<{ include: typeof productDiscoverySourceInclude }>
): ProductDiscoverySourceDTO {
  return {
    id: source.id,
    retailerId: source.retailerId,
    retailerName: source.retailer.name,
    name: source.name,
    url: source.url,
    notes: source.notes,
    enabled: source.enabled,
    checkFrequencyMinutes: source.checkFrequencyMinutes,
    nextCheckAt: source.nextCheckAt?.toISOString() ?? null,
    lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
    lastSuccessfulCheckedAt: source.lastSuccessfulCheckedAt?.toISOString() ?? null,
    lastResult: source.lastResult,
    lastError: source.lastError,
    lastFoundCount: source.lastFoundCount
  };
}

function productDiscoveryCandidateToDTO(
  candidate: Prisma.ProductDiscoveryCandidateGetPayload<{ include: typeof productDiscoveryCandidateInclude }>
): ProductDiscoveryCandidateDTO {
  return {
    id: candidate.id,
    sourceId: candidate.sourceId,
    sourceName: candidate.source.name,
    retailerId: candidate.retailerId,
    retailerName: candidate.retailer.name,
    url: candidate.url,
    finalUrl: candidate.finalUrl,
    productName: candidate.productName,
    productType: candidate.productType,
    retailerProductId: candidate.retailerProductId,
    imageUrl: candidate.imageUrl,
    livePrice: candidate.livePrice,
    stockStatus: candidate.stockStatus as ProductStatus | null,
    confidenceScore: candidate.confidenceScore,
    reason: candidate.reason,
    status: candidate.status as ProductDiscoveryCandidateDTO["status"],
    approvedProductId: candidate.approvedProductId,
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
    ignoredAt: candidate.ignoredAt?.toISOString() ?? null,
    createdAt: candidate.createdAt.toISOString()
  };
}

function setupChecklist(input: {
  productCount: number;
  storeCount: number;
  releaseCount: number;
  externalAlertsConfigured: boolean;
  monitorRunCount: number;
}): SetupChecklistItemDTO[] {
  return [
    {
      id: "products",
      label: "Add 3 products",
      detail: `${input.productCount}/3 official product URLs tracked`,
      complete: input.productCount >= 3,
      tab: "products"
    },
    {
      id: "stores",
      label: "Add 3 stores",
      detail: `${input.storeCount}/3 local stores saved`,
      complete: input.storeCount >= 3,
      tab: "stores"
    },
    {
      id: "release",
      label: "Add 1 release",
      detail: `${input.releaseCount}/1 release calendar item saved`,
      complete: input.releaseCount >= 1,
      tab: "releases"
    },
    {
      id: "notifications",
      label: "Configure push/SMS/email",
      detail: input.externalAlertsConfigured ? "External alert channel enabled" : "Enable browser push, SMS, or email",
      complete: input.externalAlertsConfigured,
      tab: "alerts"
    },
    {
      id: "monitor",
      label: "Run first monitor check",
      detail: input.monitorRunCount ? `${input.monitorRunCount} monitor run logged` : "Run Due Checks or Run Check Now",
      complete: input.monitorRunCount > 0,
      tab: "products"
    }
  ];
}

function dataQualityWarnings(input: {
  products: ProductDTO[];
  cards: CardDTO[];
  notificationSettings: NotificationSettingsDTO;
}): DataQualityWarningDTO[] {
  const warnings: DataQualityWarningDTO[] = [];
  const alertsConfigured =
    input.notificationSettings.inApp ||
    input.notificationSettings.browserPush ||
    input.notificationSettings.email ||
    input.notificationSettings.sms;
  if (!alertsConfigured) {
    warnings.push({
      id: "alerts-none",
      severity: "HIGH",
      title: "No alert settings enabled",
      detail: "Enable at least one alert channel so restock changes are visible.",
      tab: "alerts"
    });
  }

  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const product of input.products) {
    if (!product.url) {
      warnings.push({
        id: `product-url-${product.id}`,
        severity: "HIGH",
        title: `${product.name} is missing a URL`,
        detail: "Every monitored product needs an official public retailer URL.",
        tab: "products",
        entityId: product.id
      });
    }
    if (!product.sku && !product.upc && !product.dpci && !product.retailerProductId) {
      warnings.push({
        id: `product-id-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} is missing SKU/UPC/DPCI/product ID`,
        detail: "Add an identifier to make restocks, store hunts, and imports easier to reconcile.",
        tab: "products",
        entityId: product.id
      });
    }
    if (product.verificationStatus === "SEARCH_OR_CATEGORY_LINK") {
      warnings.push({
        id: `product-search-link-${product.id}`,
        severity: "HIGH",
        title: `${product.name} is using a search/category link`,
        detail: "Search link only — replace with exact product URL.",
        tab: "products",
        entityId: product.id
      });
    }
    if (product.verificationStatus === "NEEDS_IDENTIFIERS") {
      warnings.push({
        id: `product-needs-identifiers-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} needs UPC/SKU/DPCI/TCIN before alerts`,
        detail: "Add an identifier and run Verify Exact Product before enabling Buy alerts.",
        tab: "products",
        entityId: product.id
      });
    }
    if (product.verificationStatus === "VERIFIED_URL") {
      warnings.push({
        id: `product-reverify-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} needs exact-product reverification`,
        detail: "Older URL-only verification is not enough for Buy alerts. Run Verify Exact Product.",
        tab: "products",
        entityId: product.id
      });
    }
    if (product.verificationStatus === "POSSIBLE_MISMATCH") {
      warnings.push({
        id: `product-verify-${product.id}`,
        severity: "HIGH",
        title: `${product.name} may not match its tracked URL`,
        detail: product.verificationNotes || "Verify this product link before trusting monitor alerts.",
        tab: "products",
        entityId: product.id
      });
    }
    if (product.livePrice === null) {
      warnings.push({
        id: `product-live-price-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} price is not verified`,
        detail: product.isDemoData
          ? "Seed/demo price is labeled as demo data until a retailer page confirms a live price."
          : "Run Verify Exact Product or Run Check Now to collect the live retailer price.",
        tab: "products",
        entityId: product.id
      });
    }
    if (!product.liveStockStatus) {
      warnings.push({
        id: `product-live-stock-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} stock is not verified`,
        detail: "Buy alerts require exact product match plus live stock/preorder/add-to-cart evidence from the retailer page.",
        tab: "products",
        entityId: product.id
      });
    }
    if (!product.liveImageUrl) {
      warnings.push({
        id: `product-live-image-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} image is not verified`,
        detail: "Run Verify Exact Product to cache a retailer product image. Cards fall back to the retailer logo until then.",
        tab: "products",
        entityId: product.id
      });
    }
    if (!product.releaseId && !product.setName) {
      warnings.push({
        id: `product-release-${product.id}`,
        severity: "MEDIUM",
        title: `${product.name} is not linked to a release`,
        detail: "Link products to a release or set so priority scoring can use chase-card and demand data.",
        tab: "products",
        entityId: product.id
      });
    }
    if (
      product.monitorEnabled &&
      (!product.lastSuccessfulCheckedAt || new Date(product.lastSuccessfulCheckedAt).getTime() < staleCutoff)
    ) {
      warnings.push({
        id: `product-stale-${product.id}`,
        severity: "LOW",
        title: `${product.name} has no successful check in 24h`,
        detail: "Run a manual check, tune required/ignore words, or verify cron is reaching the public page.",
        tab: "products",
        entityId: product.id
      });
    }
  }

  for (const card of input.cards) {
    if (card.rawCompCount < 3) {
      warnings.push({
        id: `card-raw-comps-${card.id}`,
        severity: "MEDIUM",
        title: `${card.cardName} has fewer than 3 raw comps`,
        detail: `Only ${card.rawCompCount} raw completed sale${card.rawCompCount === 1 ? "" : "s"} found. Refresh eBay comps or add manual sold URLs.`,
        tab: "cards",
        entityId: card.id
      });
    }
    if (card.psa9CompCount < 3) {
      warnings.push({
        id: `card-psa9-comps-${card.id}`,
        severity: "MEDIUM",
        title: `${card.cardName} has fewer than 3 PSA 9 comps`,
        detail: `Only ${card.psa9CompCount} PSA 9 completed sale${card.psa9CompCount === 1 ? "" : "s"} found. Profit confidence is limited.`,
        tab: "cards",
        entityId: card.id
      });
    }
    if (card.psa10CompCount < 3) {
      warnings.push({
        id: `card-psa10-comps-${card.id}`,
        severity: "MEDIUM",
        title: `${card.cardName} has fewer than 3 PSA 10 comps`,
        detail: `Only ${card.psa10CompCount} PSA 10 completed sale${card.psa10CompCount === 1 ? "" : "s"} found. Upside confidence is limited.`,
        tab: "cards",
        entityId: card.id
      });
    }
  }

  return warnings.slice(0, 30);
}

function ownerLaunchChecklist(input: {
  products: ProductDTO[];
  stores: StoreDTO[];
  releases: ReleaseDTO[];
  cards: CardDTO[];
  alerts: AlertDTO[];
  monitorLogs: MonitorLogDTO[];
  notificationSettings: NotificationSettingsDTO;
  health: DashboardDTO["health"];
  dailyRecaps: DailyRecapDTO[];
  inventory: InventoryItemDTO[];
  users: DashboardDTO["users"];
}): OwnerLaunchChecklistItemDTO[] {
  const now = Date.now();
  const recentMonitorRun = input.monitorLogs.some((log) => new Date(log.startedAt).getTime() > now - 24 * 60 * 60 * 1000);
  const externalProviderConfigured = Boolean(input.health?.providers.email.configured || input.health?.providers.sms.configured);
  const externalChannelEnabled =
    (input.notificationSettings.email && Boolean(input.notificationSettings.emailTo)) ||
    (input.notificationSettings.sms && Boolean(input.notificationSettings.phone));
  const pushReady = Boolean(input.health?.providers.push.configured && input.notificationSettings.browserPush);
  const friendCount = input.users.filter((user) => user.role === "FRIEND" && !user.disabledAt).length;
  const actionableAlerts = input.alerts.filter((alert) => !alert.read && !alert.suppressedAt).length;
  const calibratedProducts = input.products.filter(
    (product) => product.monitorEnabled && (product.requiredWords || product.ignoreWords || product.lastSuccessfulCheckedAt)
  ).length;

  return [
    {
      id: "real-products",
      label: "Real watchlist loaded",
      detail: `${input.products.length}/6 products tracked; target your live ETBs, boosters, and bundles first`,
      complete: input.products.length >= 6,
      severity: input.products.length >= 3 ? "MEDIUM" : "HIGH",
      tab: "products"
    },
    {
      id: "real-stores",
      label: "Local store route ready",
      detail: `${input.stores.length}/3 stores saved for morning Field Mode decisions`,
      complete: input.stores.length >= 3,
      severity: input.stores.length >= 1 ? "MEDIUM" : "HIGH",
      tab: "stores"
    },
    {
      id: "release-card-context",
      label: "Release and card context linked",
      detail: `${input.releases.length} releases and ${input.cards.length} cards available for priority scoring`,
      complete: input.releases.length >= 1 && input.cards.length >= 5,
      severity: input.releases.length >= 1 ? "MEDIUM" : "HIGH",
      tab: input.releases.length >= 1 ? "cards" : "releases"
    },
    {
      id: "monitor-cron",
      label: "Cron and monitor checks active",
      detail: recentMonitorRun
        ? `Recent monitor run logged; ${input.health?.monitor.dueProductCount ?? 0} products currently due`
        : "Run due checks and verify Vercel cron logs within the last 24 hours",
      complete: Boolean(input.health?.monitor.monitorJobSecretConfigured && input.health?.monitor.vercelCronSecretConfigured && recentMonitorRun),
      severity: recentMonitorRun ? "MEDIUM" : "HIGH",
      tab: "products"
    },
    {
      id: "push-alerts",
      label: "Fast push alerts ready",
      detail: pushReady ? "VAPID is configured and browser push is enabled for this Admin" : "Enable browser push and allow permission on your phone",
      complete: pushReady,
      severity: pushReady ? "LOW" : "HIGH",
      tab: "alerts"
    },
    {
      id: "sms-email",
      label: "Backup alert channel configured",
      detail: externalProviderConfigured
        ? externalChannelEnabled
          ? "Email or SMS provider is configured and enabled for this user"
          : "Provider exists; enable email or SMS in notification settings"
        : "Add SMTP or Twilio env vars if you want non-browser backup alerts",
      complete: externalProviderConfigured && externalChannelEnabled,
      severity: externalProviderConfigured ? "MEDIUM" : "LOW",
      tab: "alerts"
    },
    {
      id: "calibration",
      label: "Detection tuning started",
      detail: `${calibratedProducts}/${input.products.filter((product) => product.monitorEnabled).length} monitored products have checks or tuning words`,
      complete: calibratedProducts >= Math.min(3, input.products.filter((product) => product.monitorEnabled).length),
      severity: calibratedProducts ? "MEDIUM" : "HIGH",
      tab: "products"
    },
    {
      id: "friend-access",
      label: "Friend access tested",
      detail: friendCount ? `${friendCount} active friend account${friendCount === 1 ? "" : "s"}` : "Create one invite and verify Friend permissions",
      complete: friendCount > 0,
      severity: "LOW",
      tab: "alerts"
    },
    {
      id: "daily-rhythm",
      label: "Daily workflow started",
      detail: `${input.dailyRecaps.length} recaps and ${input.inventory.length} inventory entries logged`,
      complete: input.dailyRecaps.length > 0 || input.inventory.length > 0,
      severity: "LOW",
      tab: "dashboard"
    },
    {
      id: "backup-routine",
      label: "Backup routine ready",
      detail: "JSON and Postgres backup commands are documented; run before resets and weekly during launch",
      complete: true,
      severity: "LOW",
      tab: "dashboard"
    },
    {
      id: "alert-inbox",
      label: "Alert inbox reviewed",
      detail: actionableAlerts ? `${actionableAlerts} unread actionable alerts need review` : "No unread actionable alerts",
      complete: actionableAlerts === 0,
      severity: actionableAlerts ? "MEDIUM" : "LOW",
      tab: "alerts"
    }
  ];
}

function addCalibrationItem(
  items: AlertCalibrationItemDTO[],
  item: Omit<AlertCalibrationItemDTO, "id">
) {
  const key = `${item.category}:${item.productId || item.title}`.toLowerCase();
  if (items.some((existing) => existing.id === key)) return;
  items.push({ id: key, ...item });
}

function alertCalibrationItems(input: {
  products: ProductDTO[];
  monitorLogs: MonitorLogDTO[];
  alerts: AlertDTO[];
}): AlertCalibrationItemDTO[] {
  const items: AlertCalibrationItemDTO[] = [];
  const productsById = new Map(input.products.map((product) => [product.id, product]));
  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const product of input.products) {
    if (product.monitorEnabled && (!product.lastSuccessfulCheckedAt || new Date(product.lastSuccessfulCheckedAt).getTime() < staleCutoff)) {
      addCalibrationItem(items, {
        severity: product.lastMonitorError ? "HIGH" : "MEDIUM",
        category: "Stale check",
        title: `${product.name} needs a fresh successful check`,
        detail: product.lastSuccessfulCheckedAt
          ? `Last successful check was ${product.lastSuccessfulCheckedAt.slice(0, 10)}.`
          : "No successful public-page check has been logged yet.",
        recommendation: "Run Check Now, then add required/ignore words if the page text is noisy.",
        productId: product.id,
        productName: product.name,
        retailerName: product.retailerName,
        lastSeenAt: product.lastCheckedAt,
        tab: "products"
      });
    }
    if (product.pendingAlertStatus && product.pendingAlertCount > 0) {
      addCalibrationItem(items, {
        severity: "HIGH",
        category: "Pending confirmation",
        title: `${product.name} is waiting for a second matching check`,
        detail: `${product.pendingAlertStatus} held at confidence ${product.pendingAlertConfidence ?? 0}.`,
        recommendation: "Run another manual check or force alert only after visually confirming the public page.",
        productId: product.id,
        productName: product.name,
        retailerName: product.retailerName,
        lastSeenAt: product.pendingAlertAt,
        tab: "products"
      });
    }
  }

  for (const log of input.monitorLogs) {
    const product = log.productId ? productsById.get(log.productId) : null;
    if (log.status === "BLOCKED" || log.blockedType) {
      addCalibrationItem(items, {
        severity: "HIGH",
        category: log.blockedType === "CAPTCHA_ROBOT_PAGE" ? "Captcha/robot page" : "Blocked page",
        title: `${log.productName || "A monitored product"} returned a blocked page`,
        detail: `${log.blockedType || "Blocked"} at HTTP ${log.httpStatus ?? "unknown"} with confidence ${log.confidenceScore ?? 0}.`,
        recommendation: "Do not alert from blocked pages. Pause monitoring or check less often for this product.",
        productId: log.productId,
        productName: log.productName,
        retailerName: product?.retailerName ?? null,
        lastSeenAt: log.startedAt,
        tab: "products"
      });
    } else if ((log.confidenceScore ?? 100) < 60) {
      addCalibrationItem(items, {
        severity: log.alertSent ? "HIGH" : "MEDIUM",
        category: "Low confidence",
        title: `${log.productName || "A monitored product"} has low-confidence detection`,
        detail: `${log.detectedStatus || log.status} scored ${log.confidenceScore ?? 0}; detected words: ${log.detectedWords || "none"}.`,
        recommendation: "Add required words for real buy signals and ignore words for promos, ads, or recommendations.",
        productId: log.productId,
        productName: log.productName,
        retailerName: product?.retailerName ?? null,
        lastSeenAt: log.startedAt,
        tab: "products"
      });
    }
  }

  const falsePositiveCounts = new Map<string, number>();
  for (const alert of input.alerts) {
    if (alert.falsePositiveAt && alert.entityId) {
      falsePositiveCounts.set(alert.entityId, (falsePositiveCounts.get(alert.entityId) ?? 0) + 1);
    }
    if (alert.suppressedAt && alert.entityId) {
      const product = productsById.get(alert.entityId);
      addCalibrationItem(items, {
        severity: "LOW",
        category: "Suppressed duplicate",
        title: `${alert.title} was suppressed`,
        detail: alert.explanation || alert.reason,
        recommendation: "If this was useful, shorten the cooldown or disable digest/urgent-only mode for this product.",
        productId: alert.entityId,
        productName: product?.name ?? null,
        retailerName: product?.retailerName ?? null,
        lastSeenAt: alert.suppressedAt,
        tab: "alerts"
      });
    }
  }

  for (const [productId, count] of falsePositiveCounts) {
    if (count < 2) continue;
    const product = productsById.get(productId);
    addCalibrationItem(items, {
      severity: "HIGH",
      category: "Repeated false positives",
      title: `${product?.name || "A product"} has ${count} false-positive alerts`,
      detail: "The current detector is too broad for this page.",
      recommendation: "Add stricter required words, ignore misleading page text, or pause the monitor until tuned.",
      productId,
      productName: product?.name ?? null,
      retailerName: product?.retailerName ?? null,
      lastSeenAt: null,
      tab: "alerts"
    });
  }

  return items
    .sort((a, b) => scoreFromPriority(b.severity, 3, 2, 1) - scoreFromPriority(a.severity, 3, 2, 1))
    .slice(0, 20);
}

function monitorLogToDTO(log: Prisma.MonitorLogGetPayload<{ include: typeof monitorLogInclude }>): MonitorLogDTO {
  return {
    id: log.id,
    productId: log.productId,
    productName: log.product?.name ?? null,
    runType: log.runType,
    status: log.status as MonitorLogDTO["status"],
    previousStatus: log.previousStatus,
    detectedStatus: log.detectedStatus,
    previousPrice: log.previousPrice,
    detectedPrice: log.detectedPrice,
    changeSummary: log.changeSummary,
    httpStatus: log.httpStatus,
    startedAt: log.startedAt.toISOString(),
    finishedAt: log.finishedAt?.toISOString() ?? null,
    durationMs: log.durationMs,
    error: log.error,
    alertSent: log.alertSent,
    notificationSummary: log.notificationSummary,
    finalUrl: log.finalUrl,
    responseTimeMs: log.responseTimeMs,
    detectedWords: log.detectedWords,
    confidenceScore: log.confidenceScore,
    reason: log.reason,
    blockedType: log.blockedType
  };
}

async function monitorAccuracyStats(): Promise<MonitorAccuracyStatsDTO> {
  const [totalChecks, successfulChecks, blockedChecks, falsePositives, confirmedRestocks] = await Promise.all([
    prisma.monitorLog.count(),
    prisma.monitorLog.count({ where: { status: { in: ["SUCCESS", "CHANGED", "FORCED_ALERT"] } } }),
    prisma.monitorLog.count({ where: { status: "BLOCKED" } }),
    prisma.monitorLog.count({ where: { status: "FALSE_POSITIVE" } }),
    prisma.restockHistory.count({ where: { status: { in: ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"] } } })
  ]);
  return { totalChecks, successfulChecks, blockedChecks, falsePositives, confirmedRestocks };
}

function notificationSettingsToDTO(
  settings: Prisma.NotificationSettingsGetPayload<Record<string, never>>
): NotificationSettingsDTO {
  return {
    id: settings.id,
    inApp: settings.inApp,
    email: settings.email,
    sms: settings.sms,
    browserPush: settings.browserPush,
    phone: settings.phone,
    emailTo: settings.emailTo,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    minimumPriority: settings.minimumPriority as Priority,
    alertDigestMode: settings.alertDigestMode,
    urgentOnlyMode: settings.urgentOnlyMode,
    highPriorityOverride: settings.highPriorityOverride,
    watchedRetailers: settings.watchedRetailers,
    watchedProducts: settings.watchedProducts,
    alertCooldownMinutes: settings.alertCooldownMinutes
  };
}

async function alertAnalytics(): Promise<AlertAnalyticsDTO> {
  const [totalAlerts, unreadAlerts, highPriorityAlerts, falsePositiveAlerts, suppressedAlerts, aggregate] =
    await Promise.all([
      prisma.alert.count(),
      prisma.alert.count({ where: { read: false } }),
      prisma.alert.count({ where: { priority: "HIGH" } }),
      prisma.alert.count({ where: { falsePositiveAt: { not: null } } }),
      prisma.alert.count({ where: { suppressedAt: { not: null } } }),
      prisma.alert.aggregate({ _avg: { score: true } })
    ]);
  return {
    totalAlerts,
    unreadAlerts,
    highPriorityAlerts,
    falsePositiveAlerts,
    suppressedAlerts,
    averageScore: Math.round(aggregate._avg.score ?? 0)
  };
}

function investmentSettingsToDTO(settings: Prisma.InvestmentSettingsGetPayload<Record<string, never>>): InvestmentSettingsDTO {
  return {
    id: settings.id,
    gradingCost: settings.gradingCost,
    ebaySellingFee: settings.ebaySellingFee,
    shippingCost: settings.shippingCost,
    minimumProfitTarget: settings.minimumProfitTarget
  };
}

function inventoryMarketCompToDTO(comp: Prisma.InventoryMarketCompGetPayload<Record<string, never>>): InventoryMarketCompDTO {
  return {
    id: comp.id,
    inventoryItemId: comp.inventoryItemId,
    saleTitle: comp.saleTitle,
    salePrice: comp.salePrice,
    soldAt: comp.soldAt.toISOString(),
    sourceUrl: comp.sourceUrl,
    sourceQuality: (comp.sourceQuality || "EBAY_SOLD") as CompSourceQuality,
    matchScore: comp.matchScore,
    notes: comp.notes,
    createdAt: comp.createdAt.toISOString()
  };
}

function barcodeScanToDTO(scan: Prisma.BarcodeScanGetPayload<Record<string, never>>): BarcodeScanDTO {
  return {
    id: scan.id,
    upc: scan.upc,
    source: scan.source,
    status: scan.status as BarcodeScanDTO["status"],
    resultType: scan.resultType,
    productId: scan.productId,
    inventoryItemId: scan.inventoryItemId,
    productName: scan.productName,
    notes: scan.notes,
    createdAt: scan.createdAt.toISOString()
  };
}

function inventoryStockLotToDTO(lot: Prisma.InventoryStockLotGetPayload<Record<string, never>>): InventoryStockLotDTO {
  return {
    id: lot.id,
    inventoryItemId: lot.inventoryItemId,
    purchasedAt: lot.purchasedAt.toISOString(),
    source: lot.source,
    quantity: lot.quantity,
    costPerUnit: lot.costPerUnit,
    purchaseExtraCost: lot.purchaseExtraCost,
    totalCost: lot.totalCost,
    remainingQuantity: lot.remainingQuantity,
    notes: lot.notes,
    receiptNumber: lot.receiptNumber,
    receiptImageUrl: lot.receiptImageUrl,
    orderNumber: lot.orderNumber,
    transactionId: lot.transactionId,
    sourceStore: lot.sourceStore,
    paymentMethod: lot.paymentMethod,
    createdAt: lot.createdAt.toISOString()
  };
}

function inventorySaleToDTO(
  sale: Prisma.InventorySaleGetPayload<Record<string, never>>,
  itemName = ""
): InventorySaleDTO {
  return {
    id: sale.id,
    inventoryItemId: sale.inventoryItemId,
    itemName,
    quantitySold: sale.quantitySold,
    soldPricePerItem: sale.soldPricePerItem,
    grossSale: sale.grossSale,
    platform: sale.platform,
    fees: sale.fees,
    shippingCost: sale.shippingCost,
    netSale: sale.netSale,
    costBasis: sale.costBasis,
    profitLoss: sale.profitLoss,
    roiPercent: sale.roiPercent,
    soldAt: sale.soldAt.toISOString(),
    notes: sale.notes,
    createdAt: sale.createdAt.toISOString()
  };
}

type InventoryItemWithInclude = Prisma.InventoryItemGetPayload<{ include: typeof inventoryItemInclude }>;

function roundedMoney(value: number | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toFixed(2));
}

function inventoryCompStats(comps: Array<{ salePrice: number }>) {
  const prices = comps.map((comp) => comp.salePrice).filter((price) => Number.isFinite(price));
  if (!prices.length) {
    return { average: null, lowest: null, highest: null };
  }
  return {
    average: average(prices),
    lowest: roundedMoney(Math.min(...prices)),
    highest: roundedMoney(Math.max(...prices))
  };
}

function latestInventoryCompEnteredAt(comps: Array<{ createdAt: Date }>) {
  return comps.reduce<Date | null>((latest, comp) => {
    if (!latest || comp.createdAt.getTime() > latest.getTime()) return comp.createdAt;
    return latest;
  }, null);
}

function inventoryQuantitySold(item: InventoryItemWithInclude) {
  return item.sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
}

function inventoryQuantityOwned(item: InventoryItemWithInclude) {
  const quantitySold = inventoryQuantitySold(item);
  const lotRemaining = item.stockLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  return item.stockLots.length ? lotRemaining : Math.max(0, item.quantity - quantitySold);
}

function inventoryMsrpFallbackCost(item: Pick<InventoryItemWithInclude, "msrp">) {
  return item.msrp && item.msrp > 0 ? item.msrp : null;
}

function inventoryStoredTotalCost(item: Pick<InventoryItemWithInclude, "cost" | "quantity" | "purchaseExtraCost" | "totalCost">) {
  return item.totalCost ?? item.cost * item.quantity + (item.purchaseExtraCost ?? 0);
}

function inventoryEffectiveTotalCost(item: Pick<InventoryItemWithInclude, "cost" | "quantity" | "purchaseExtraCost" | "totalCost" | "msrp">) {
  const storedTotalCost = inventoryStoredTotalCost(item);
  const msrpCost = inventoryMsrpFallbackCost(item);
  if (storedTotalCost > 0 || !msrpCost || item.quantity <= 0) return storedTotalCost;
  return msrpCost * item.quantity + (item.purchaseExtraCost ?? 0);
}

function inventoryEffectiveAverageCost(item: Pick<InventoryItemWithInclude, "cost" | "quantity" | "purchaseExtraCost" | "totalCost" | "msrp">) {
  if (item.cost > 0) return item.cost;
  const totalCost = inventoryEffectiveTotalCost(item);
  if (item.quantity > 0) return totalCost / item.quantity;
  return item.cost > 0 ? item.cost : inventoryMsrpFallbackCost(item) ?? item.cost;
}

function inventoryLotUnitCost(item: Pick<InventoryItemWithInclude, "msrp">, lot: { costPerUnit: number; totalCost: number; quantity: number }) {
  if (lot.costPerUnit > 0) return lot.costPerUnit;
  if (lot.totalCost > 0 && lot.quantity > 0) return lot.totalCost / lot.quantity;
  return inventoryMsrpFallbackCost(item) ?? lot.costPerUnit;
}

function inventoryOwnedCostBasis(item: InventoryItemWithInclude) {
  if (item.stockLots.length) {
    return item.stockLots.reduce((sum, lot) => {
      return sum + inventoryLotUnitCost(item, lot) * lot.remainingQuantity;
    }, 0);
  }
  return inventoryEffectiveAverageCost(item) * inventoryQuantityOwned(item);
}

function inventoryOwnedAverageCost(item: InventoryItemWithInclude) {
  const quantityOwned = inventoryQuantityOwned(item);
  if (quantityOwned <= 0) return inventoryEffectiveAverageCost(item);
  return inventoryOwnedCostBasis(item) / quantityOwned;
}

function parseJsonStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function inventoryItemToDTO(item: Prisma.InventoryItemGetPayload<{ include: typeof inventoryItemInclude }>): InventoryItemDTO {
  const totalCost = inventoryEffectiveTotalCost(item);
  const quantitySold = inventoryQuantitySold(item);
  const quantityOwned = inventoryQuantityOwned(item);
  const averageCost = inventoryOwnedAverageCost(item);
  const totalSalesGross = item.sales.reduce((sum, sale) => sum + sale.grossSale, 0);
  const totalSalesNet = item.sales.reduce((sum, sale) => sum + sale.netSale, 0);
  const realizedProfitLoss = item.sales.reduce((sum, sale) => sum + sale.profitLoss, 0);
  const realizedRoiPercent = item.sales.reduce((sum, sale) => sum + sale.costBasis, 0);
  const ownedCostBasis = inventoryOwnedCostBasis(item);
  const compStats = inventoryCompStats(item.marketComps);
  const realCompCount = item.marketComps.length;
  const hasRealMarketComps = realCompCount > 0;
  const marketUnitEstimate = hasRealMarketComps ? compStats.average : null;
  const marketLastRefreshedAt = hasRealMarketComps ? latestInventoryCompEnteredAt(item.marketComps) ?? item.marketLastRefreshedAt : null;
  const grossMarketValue = marketUnitEstimate === null ? null : marketUnitEstimate * quantityOwned;
  const netMarketValue = grossMarketValue === null ? null : grossMarketValue - (item.estimatedEbayFee ?? 0) - (item.estimatedShippingCost ?? 0);
  const marketProfitLoss = netMarketValue === null ? null : netMarketValue - ownedCostBasis;
  const marketRoiPercent = marketProfitLoss === null || ownedCostBasis <= 0 ? null : (marketProfitLoss / ownedCostBasis) * 100;
  return {
    id: item.id,
    itemType: item.itemType,
    itemName: item.itemName,
    category: item.category,
    setName: item.setName,
    productId: item.productId,
    linkedProductName: item.product?.name ?? null,
    linkedProductRetailer: item.product?.retailer?.name ?? null,
    linkedProductLivePrice: item.product?.livePrice ?? null,
    linkedProductLiveStockStatus: (item.product?.liveStockStatus as ProductStatus | null | undefined) ?? null,
    cardId: item.cardId,
    cost: item.cost,
    quantity: item.quantity,
    quantityOwned,
    quantitySold,
    averageCost,
    totalCost,
    purchaseExtraCost: item.purchaseExtraCost,
    source: item.source,
    retailer: item.retailer,
    brand: item.brand,
    description: item.description,
    manufacturer: item.manufacturer,
    model: item.model,
    msrp: item.msrp,
    purchasedAt: item.purchasedAt.toISOString(),
    receiptNumber: item.receiptNumber,
    receiptImageUrl: item.receiptImageUrl,
    orderNumber: item.orderNumber,
    transactionId: item.transactionId,
    sourceStore: item.sourceStore,
    paymentMethod: item.paymentMethod,
    exactProductUrl: item.exactProductUrl,
    upc: item.upc,
    sku: item.sku,
    dpci: item.dpci,
    asin: item.asin,
    imageUrl: item.imageUrl || item.product?.liveImageUrl || item.product?.imageUrl || null,
    condition: item.condition,
    itemStatus: item.itemStatus,
    targetSellPrice: item.targetSellPrice,
    minimumAcceptablePrice: item.minimumAcceptablePrice,
    listingPlatform: item.listingPlatform,
    listingStatus: item.listingStatus,
    soldPrice: item.soldPrice,
    soldAt: item.soldAt?.toISOString() ?? null,
    buyerPlatform: item.buyerPlatform,
    currentMarketEstimate: hasRealMarketComps ? marketUnitEstimate : item.currentMarketEstimate,
    marketAverageSalePrice: hasRealMarketComps ? marketUnitEstimate : null,
    marketLowestRecentComp: compStats.lowest,
    marketHighestRecentComp: compStats.highest,
    marketAverageLast3: compStats.average,
    marketCompCount: realCompCount,
    marketLastRefreshedAt: marketLastRefreshedAt?.toISOString() ?? null,
    marketConfidence: hasRealMarketComps ? item.marketConfidence : "NONE",
    grossMarketValue: roundedMoney(grossMarketValue),
    netMarketValue: roundedMoney(netMarketValue),
    marketProfitLoss: roundedMoney(marketProfitLoss),
    marketRoiPercent: roundedMoney(marketRoiPercent),
    estimatedEbayFee: item.estimatedEbayFee,
    estimatedShippingCost: item.estimatedShippingCost,
    estimatedNetProfit: item.estimatedNetProfit,
    roiPercent: item.roiPercent,
    recommendedAction: item.recommendedAction,
    recommendationReason: item.recommendationReason,
    netProfitAfterFees: item.netProfitAfterFees,
    publishToStore: item.publishToStore,
    publicSlug: item.publicSlug,
    publicTitle: item.publicTitle,
    publicDescription: item.publicDescription,
    publicPrice: item.publicPrice,
    compareAtPrice: item.compareAtPrice,
    publicImages: parseJsonStringArray(item.publicImages),
    availableForSale: item.availableForSale,
    maxQuantityPerOrder: item.maxQuantityPerOrder,
    shippingProfile: item.shippingProfile,
    storeStatus: item.storeStatus as InventoryItemDTO["storeStatus"],
    localPickupAvailable: item.localPickupAvailable,
    shippingAvailable: item.shippingAvailable,
    storefrontCategory: item.storefrontCategory,
    storefrontTags: parseJsonStringArray(item.storefrontTags),
    totalSalesGross,
    totalSalesNet,
    realizedProfitLoss,
    realizedRoiPercent: realizedRoiPercent > 0 ? (realizedProfitLoss / realizedRoiPercent) * 100 : null,
    businessProfitLoss: marketProfitLoss === null ? realizedProfitLoss : realizedProfitLoss + marketProfitLoss,
    lastThreeComps: item.marketComps.map(inventoryMarketCompToDTO),
    stockLots: item.stockLots.map(inventoryStockLotToDTO),
    sales: item.sales.map((sale) => inventorySaleToDTO(sale, item.itemName)),
    expectedPlan: item.expectedPlan,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

function summarizeInventory(items: InventoryItemDTO[]): InventorySummaryDTO {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const allSales = items.flatMap((item) => item.sales);
  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);
  const currentInventoryValue = items.reduce((sum, item) => sum + (item.netMarketValue ?? 0), 0);
  const totalSalesGross = allSales.reduce((sum, sale) => sum + sale.grossSale, 0);
  const totalSalesNet = allSales.reduce((sum, sale) => sum + sale.netSale, 0);
  const realizedProfitLoss = allSales.reduce((sum, sale) => sum + sale.profitLoss, 0);
  const estimatedProfit = items.reduce((sum, item) => sum + (item.businessProfitLoss ?? item.marketProfitLoss ?? item.estimatedNetProfit ?? 0), 0);
  const netProfitLoss = totalSalesNet + currentInventoryValue - totalCost;
  const quantityByCategoryMap = new Map<string, number>();
  const profitByPlatformMap = new Map<string, { profit: number; sales: number }>();
  for (const item of items) quantityByCategoryMap.set(item.category, (quantityByCategoryMap.get(item.category) ?? 0) + item.quantityOwned);
  for (const sale of allSales) {
    const platform = sale.platform || "other";
    const current = profitByPlatformMap.get(platform) ?? { profit: 0, sales: 0 };
    current.profit += sale.profitLoss;
    current.sales += sale.grossSale;
    profitByPlatformMap.set(platform, current);
  }
  const withProfit = items.filter((item) => item.businessProfitLoss !== null || item.estimatedNetProfit !== null);
  const sortedByProfit = [...withProfit].sort(
    (a, b) => (b.businessProfitLoss ?? b.marketProfitLoss ?? b.estimatedNetProfit ?? 0) - (a.businessProfitLoss ?? a.marketProfitLoss ?? a.estimatedNetProfit ?? 0)
  );
  const isAfter = (date: string, cutoff: Date) => new Date(date).getTime() >= cutoff.getTime();
  return {
    totalSpent: totalCost,
    totalCost,
    currentInventoryValue,
    estimatedMarketValue: currentInventoryValue,
    totalSalesGross,
    totalSalesNet,
    estimatedProfit,
    realizedProfitLoss,
    netProfitLoss,
    totalRoiPercent: totalCost > 0 ? (netProfitLoss / totalCost) * 100 : null,
    itemsOwned: items.reduce((sum, item) => sum + item.quantityOwned, 0),
    itemsSold: allSales.reduce((sum, sale) => sum + sale.quantitySold, 0),
    spendingThisWeek: items.filter((item) => isAfter(item.purchasedAt, weekStart)).reduce((sum, item) => sum + item.totalCost, 0),
    spendingThisMonth: items.filter((item) => isAfter(item.purchasedAt, monthStart)).reduce((sum, item) => sum + item.totalCost, 0),
    salesThisWeek: allSales.filter((sale) => isAfter(sale.soldAt, weekStart)).reduce((sum, sale) => sum + sale.grossSale, 0),
    salesThisMonth: allSales.filter((sale) => isAfter(sale.soldAt, monthStart)).reduce((sum, sale) => sum + sale.grossSale, 0),
    profitByPlatform: [...profitByPlatformMap.entries()].map(([platform, values]) => ({ platform, ...values })),
    quantityByCategory: [...quantityByCategoryMap.entries()].map(([category, quantity]) => ({ category, quantity })),
    bestItem: sortedByProfit[0] ?? null,
    worstItem: sortedByProfit.at(-1) ?? null,
    sellNowCount: items.filter((item) => item.recommendedAction === "SELL_NOW" || item.recommendedAction === "LIST_HIGH").length,
    holdCount: items.filter((item) => item.recommendedAction === "HOLD").length,
    missingMarketDataCount: items.filter((item) => item.marketCompCount === 0).length
  };
}

function dailyRecapToDTO(recap: Prisma.DailyRecapGetPayload<Record<string, never>>): DailyRecapDTO {
  return {
    id: recap.id,
    recapDate: recap.recapDate.toISOString(),
    summary: recap.summary,
    productChecks: recap.productChecks,
    storeVisits: recap.storeVisits,
    purchases: recap.purchases,
    alertsCreated: recap.alertsCreated,
    createdAt: recap.createdAt.toISOString()
  };
}

function savedFilterPresetToDTO(preset: Prisma.SavedFilterPresetGetPayload<Record<string, never>>): SavedFilterPresetDTO {
  return {
    id: preset.id,
    name: preset.name,
    section: preset.section,
    filters: preset.filters,
    createdAt: preset.createdAt.toISOString()
  };
}

function cardCompSaleToDTO(sale: Prisma.CardCompSaleGetPayload<{ include: typeof compSaleInclude }>): CardCompSaleDTO {
  return {
    id: sale.id,
    cardId: sale.cardId,
    cardName: sale.card.cardName,
    setName: sale.card.setName,
    cardNumber: sale.card.cardNumber,
    gradeType: (sale.gradeType || sale.grade) as GradeType,
    salePrice: sale.salePrice,
    soldAt: sale.soldAt.toISOString(),
    source: sale.source,
    sourceQuality: (sale.sourceQuality || "EBAY_SOLD") as CompSourceQuality,
    sourceUrl: sale.sourceUrl || sale.url,
    saleTitle: sale.saleTitle,
    matchScore: sale.matchScore,
    conditionNotes: sale.conditionNotes || sale.notes,
    reviewStatus: (sale.reviewStatus || "ACCEPTED") as "ACCEPTED" | "REJECTED",
    rejectedAt: sale.rejectedAt?.toISOString() ?? null
  };
}

function average(values: number[]) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function gradeLabel(gradeType: GradeType) {
  return gradeType.replaceAll("_", " ");
}

function sourceQualityLabel(sourceQuality: CompSourceQuality) {
  if (sourceQuality === "PRICECHARTING") return "PriceCharting";
  if (sourceQuality === "TCGPLAYER") return "TCGPlayer";
  if (sourceQuality === "MANUAL_ESTIMATE") return "Manual estimate";
  return "eBay sold";
}

function reportItemFromCard(card: CardDTO, reason: string): InvestmentReportItemDTO {
  return {
    cardId: card.id,
    cardName: card.cardName,
    setName: card.setName,
    cardNumber: card.cardNumber,
    rawAveragePrice: card.rawAveragePrice,
    psa9AverageSalePrice: card.psa9AverageSalePrice,
    psa10AverageSalePrice: card.psa10AverageSalePrice,
    bgs10AverageSalePrice: card.bgs10AverageSalePrice,
    psa9EstimatedProfit: card.psa9EstimatedProfit,
    psa10EstimatedProfit: card.psa10EstimatedProfit,
    bgs10EstimatedProfit: card.bgs10EstimatedProfit,
    blackLabelEstimatedProfit: card.blackLabelEstimatedProfit,
    maxRawBuyPrice: card.maxRawBuyPrice,
    rating: card.rating,
    top10Score: card.top10Score,
    compConfidenceScore: card.compConfidenceScore,
    reason
  };
}

function parseReportItems(value: string): InvestmentReportItemDTO[] {
  try {
    const parsed = JSON.parse(value) as InvestmentReportItemDTO[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseReportItem(value: string | null): InvestmentReportItemDTO | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as InvestmentReportItemDTO;
  } catch {
    return null;
  }
}

function investmentReportToDTO(
  report: Prisma.InvestmentReportGetPayload<Record<string, never>>
): InvestmentReportDTO {
  return {
    id: report.id,
    title: report.title,
    generatedAt: report.generatedAt.toISOString(),
    periodStart: report.periodStart.toISOString(),
    periodEnd: report.periodEnd.toISOString(),
    top10RawToGrade: parseReportItems(report.top10RawToGrade),
    safestPsa9Flips: parseReportItems(report.safestPsa9Flips),
    highestPsa10Upside: parseReportItems(report.highestPsa10Upside),
    beckettCandidates: parseReportItems(report.beckettCandidates),
    avoidOverpriced: parseReportItems(report.avoidOverpriced),
    bestBuy: parseReportItem(report.bestBuy),
    riskiestBuy: parseReportItem(report.riskiestBuy),
    bestUnder25Raw: parseReportItem(report.bestUnder25Raw),
    bestPremiumCard: parseReportItem(report.bestPremiumCard),
    notes: report.notes
  };
}

function toReportJson(value: InvestmentReportItemDTO[] | InvestmentReportItemDTO | null) {
  return JSON.stringify(value);
}

export async function ensureNotificationSettings(currentUser: SessionUser) {
  return prisma.notificationSettings.upsert({
    where: { userId: currentUser.id },
    update: {},
    create: {
      userId: currentUser.id,
      inApp: true,
      email: false,
      sms: false,
      browserPush: false,
      emailTo: currentUser.email,
      minimumPriority: "LOW"
    }
  });
}

export async function ensureInvestmentSettings(currentUser: SessionUser) {
  return prisma.investmentSettings.upsert({
    where: { userId: currentUser.id },
    update: {},
    create: {
      userId: currentUser.id,
      gradingCost: 20,
      ebaySellingFee: 0.1325,
      shippingCost: 5,
      minimumProfitTarget: 20
    }
  });
}

export async function updateUserAreaPreferences(
  currentUser: SessionUser,
  input: {
    preferredZone: Zone;
    customZoneName?: string;
    hideDistantStores: boolean;
    currentLatitude?: number;
    currentLongitude?: number;
  }
) {
  const hasLocation = input.currentLatitude !== undefined && input.currentLongitude !== undefined;
  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      preferredZone: input.preferredZone,
      customZoneName: input.preferredZone === "CUSTOM" ? input.customZoneName || "My Area" : null,
      hideDistantStores: input.hideDistantStores,
      ...(hasLocation
        ? {
            currentLatitude: input.currentLatitude,
            currentLongitude: input.currentLongitude,
            locationUpdatedAt: new Date()
          }
        : {})
    },
    select: {
      preferredZone: true,
      customZoneName: true,
      hideDistantStores: true,
      currentLatitude: true,
      currentLongitude: true,
      locationUpdatedAt: true
    }
  });
  return {
    preferredZone: user.preferredZone as Zone,
    customZoneName: user.customZoneName,
    hideDistantStores: user.hideDistantStores,
    currentLatitude: user.currentLatitude,
    currentLongitude: user.currentLongitude,
    locationUpdatedAt: user.locationUpdatedAt?.toISOString() ?? null
  };
}

export async function updateStorePreference(
  currentUser: SessionUser,
  input: { storeId: string; favorite?: boolean; hidden?: boolean }
) {
  const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
  if (!store) throw new Error("Store not found");
  const preference = await prisma.userStorePreference.upsert({
    where: { userId_storeId: { userId: currentUser.id, storeId: input.storeId } },
    update: {
      ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
      ...(input.hidden === undefined ? {} : { hidden: input.hidden })
    },
    create: {
      userId: currentUser.id,
      storeId: input.storeId,
      favorite: input.favorite ?? false,
      hidden: input.hidden ?? false
    }
  });
  return preference;
}

function releaseForProduct(product: ProductScoreInput, releases: ReleaseScoreInput[]) {
  if (product.releaseId) {
    const explicit = releases.find((release) => release.id === product.releaseId);
    if (explicit) return explicit;
  }
  if (product.setName) {
    const bySet = releases.find((release) => release.setName.toLowerCase() === product.setName?.toLowerCase());
    if (bySet) return bySet;
  }
  return releases.find((release) => product.name.toLowerCase().includes(release.setName.toLowerCase())) ?? null;
}

function releaseMetrics(
  release: ReleaseScoreInput,
  products: ProductScoreInput[],
  cards: CardScoreInput[]
) {
  const releaseProducts = products.filter((product) => releaseForProduct(product, [release])?.id === release.id);
  const releaseCards = cards.filter(
    (card) => card.releaseId === release.id || card.setName.toLowerCase() === release.setName.toLowerCase()
  );
  return {
    productCount: releaseProducts.length,
    cardCount: releaseCards.length,
    profitablePsa9Count: releaseCards.filter((card) => card.psa9EstimatedProfit >= card.minimumProfitTarget).length,
    psa10Upside: Number(releaseCards.reduce((best, card) => Math.max(best, card.psa10EstimatedProfit), 0).toFixed(2))
  };
}

async function createAlertOnce(input: {
  title: string;
  reason: string;
  priority: Priority;
  entityType: string;
  entityId: string;
  actionUrl?: string | null;
  productId?: string | null;
}) {
  const dedupeKey = `${input.entityType}:${input.entityId}:${input.title}`.toLowerCase();
  const existing = await prisma.alert.findFirst({
    where: {
      dedupeKey,
      read: false
    }
  });
  if (existing) return;
  await prisma.alert.create({
    data: {
      title: input.title,
      reason: input.reason,
      priority: input.priority,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl: input.actionUrl,
      productId: input.productId,
      dedupeKey,
      score: input.priority === "HIGH" ? 85 : input.priority === "MEDIUM" ? 60 : 35,
      explanation: `Created because ${input.reason}`
    }
  });
}

async function refreshReleaseAlerts(releases: ReleaseScoreInput[]) {
  for (const release of releases) {
    const releaseDays = daysUntil(release.officialReleaseDate);
    const preorderDays = release.preorderDate ? daysUntil(release.preorderDate) : null;
    const actionUrl = release.productLinks
      ?.split(/[\n,]/)
      .map((item) => item.trim())
      .find(Boolean);
    if (releaseDays >= 0 && releaseDays <= 7) {
      await createAlertOnce({
        title: `${release.setName} releases within 7 days`,
        reason: `${release.setName} releases on ${release.officialReleaseDate.toISOString().slice(0, 10)}.`,
        priority: release.priority as Priority,
        entityType: "RELEASE",
        entityId: release.id,
        actionUrl
      });
    }
    if (preorderDays !== null && preorderDays >= 0 && preorderDays <= 1) {
      await createAlertOnce({
        title: `${release.setName} preorder window ${preorderDays === 0 ? "today" : "tomorrow"}`,
        reason: `${release.setName} preorder date is ${release.preorderDate!.toISOString().slice(0, 10)}.`,
        priority: "HIGH",
        entityType: "RELEASE",
        entityId: release.id,
        actionUrl
      });
    }
  }
}

async function refreshProductPriorityScores(
  products: ProductScoreInput[],
  releases: ReleaseScoreInput[],
  cards: CardScoreInput[]
) {
  const scores = new Map<string, ProductPriorityScoreDTO>();
  if (!products.length) return scores;
  const data = products.map((product) => {
    const release = releaseForProduct(product, releases);
    const cardsInSet = cards.filter((card) => {
      if (release && (card.releaseId === release.id || card.setName.toLowerCase() === release.setName.toLowerCase())) {
        return true;
      }
      return product.setName ? card.setName.toLowerCase() === product.setName.toLowerCase() : false;
    });
    const score = computeProductPriorityScore(product, release, cardsInSet);
    scores.set(product.id, score);
    return {
      productId: product.id,
      releaseId: release?.id ?? product.releaseId ?? null,
      buyWatchSkip: score.buyWatchSkip,
      score: score.score,
      retailPriceScore: score.retailPriceScore,
      resaleDemandScore: score.resaleDemandScore,
      setPopularityScore: score.setPopularityScore,
      scarcityScore: score.scarcityScore,
      chaseCardScore: score.chaseCardScore,
      sealedValueScore: score.sealedValueScore,
      cardInvestmentScore: score.cardInvestmentScore,
      profitablePsa9Count: score.profitablePsa9Count,
      psa10Upside: score.psa10Upside,
      manualOverride: score.manualOverride,
      reason: score.reason,
      userNotes: product.notes,
      computedAt: new Date()
    };
  });

  await prisma.productPriorityScore.deleteMany({ where: { productId: { in: products.map((product) => product.id) } } });
  await prisma.productPriorityScore.createMany({ data });

  for (const product of products) {
    const score = scores.get(product.id);
    if (
      !score ||
      score.score < 70 ||
      !["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product.stockStatus) ||
      !productReadyForBuyAlerts(product)
    ) {
      continue;
    }
    const actionUrl = exactProductActionUrl(product);
    await createAlertOnce({
      title: `High-priority chase live: ${product.name}`,
      reason: score.reason,
      priority: "HIGH",
      entityType: "PRODUCT",
      entityId: product.id,
      productId: product.id,
      actionUrl: actionUrl ?? undefined
    });
  }
  return scores;
}

export async function listDashboard(currentUser: SessionUser): Promise<DashboardDTO> {
  await ensureProductionInventoryMetadataColumns();
  await autoLinkInventoryProducts(currentUser);
  await backfillMissingMsrpInventoryCosts(currentUser);
  const [
    retailers,
    products,
    stores,
    sightings,
    releases,
    cards,
    cardCompSales,
    monitorLogs,
    notificationSettings,
    investmentSettings,
    investmentReports,
    inventory,
    barcodeScans,
    dailyRecaps,
    savedFilterPresets,
    storePreferences,
    productDiscoverySources,
    productDiscoveryCandidates,
    activeProductsScanned,
    liveRestocksDetectedToday
  ] =
    await Promise.all([
    prisma.retailer.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { archivedAt: null },
      include: productInclude,
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
    }),
    prisma.store.findMany({ include: storeInclude, orderBy: { storeName: "asc" } }),
    prisma.storeSighting.findMany({
      include: {
        store: { select: { storeName: true } },
        user: { select: { name: true } }
      },
      orderBy: { seenAt: "desc" },
      take: 20
    }),
    prisma.release.findMany({ orderBy: { officialReleaseDate: "asc" } }),
    prisma.card.findMany({ include: cardInclude, orderBy: [{ top10Score: "desc" }, { psa10EstimatedProfit: "desc" }] }),
    prisma.cardCompSale.findMany({ include: compSaleInclude, orderBy: { soldAt: "desc" }, take: 60 }),
    prisma.monitorLog.findMany({ include: monitorLogInclude, orderBy: { startedAt: "desc" }, take: 50 }),
    ensureNotificationSettings(currentUser),
    ensureInvestmentSettings(currentUser),
    prisma.investmentReport.findMany({ orderBy: { generatedAt: "desc" }, take: 12 }),
    prisma.inventoryItem.findMany({
      where: { OR: [{ userId: null }, { userId: currentUser.id }] },
      include: inventoryItemInclude,
      orderBy: { purchasedAt: "desc" },
      take: 200
    }),
    prisma.barcodeScan.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.dailyRecap.findMany({
      where: { OR: [{ userId: null }, { userId: currentUser.id }] },
      orderBy: { recapDate: "desc" },
      take: 14
    }),
    prisma.savedFilterPreset.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      take: 40
    }),
    prisma.userStorePreference.findMany({ where: { userId: currentUser.id } }),
    prisma.productDiscoverySource.findMany({
      include: productDiscoverySourceInclude,
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.productDiscoveryCandidate.findMany({
      include: productDiscoveryCandidateInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 80
    }),
    prisma.product.count({ where: { monitorEnabled: true, archivedAt: null } }),
    prisma.restockHistory.count({
      where: {
        status: { in: ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"] },
        checkedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      }
    })
  ]);
  const accessOverview =
    currentUser.role === "ADMIN"
      ? await listAccessOverview()
      : { users: [], friendInvites: [], auditLogs: [] };

  await refreshReleaseAlerts(releases);
  const priorityScoreMap = await refreshProductPriorityScores(products, releases, cards);
  const alerts = await prisma.alert.findMany({
    where: { OR: [{ userId: null }, { userId: currentUser.id }] },
    orderBy: { timestamp: "desc" },
    take: 50
  });

  const preferenceMap = new Map(storePreferences.map((preference) => [preference.storeId, preference]));
  const preferredZone = (currentUser.preferredZone || "MIAMI") as Zone;
  const areaPreferences: UserAreaPreferencesDTO = {
    preferredZone,
    customZoneName: currentUser.customZoneName ?? null,
    hideDistantStores: Boolean(currentUser.hideDistantStores),
    currentLatitude: currentUser.currentLatitude ?? null,
    currentLongitude: currentUser.currentLongitude ?? null,
    locationUpdatedAt: currentUser.locationUpdatedAt ?? null,
    favoriteStoreIds: storePreferences.filter((preference) => preference.favorite).map((preference) => preference.storeId),
    hiddenStoreIds: storePreferences.filter((preference) => preference.hidden).map((preference) => preference.storeId)
  };
  const userLocation =
    areaPreferences.currentLatitude !== null && areaPreferences.currentLongitude !== null
      ? { latitude: areaPreferences.currentLatitude, longitude: areaPreferences.currentLongitude }
      : undefined;
  const storeDTOs = stores
    .map((store) => storeToDTO(store, preferenceMap.get(store.id), preferredZone, currentUser.customZoneName, userLocation))
    .filter(
      (store) =>
        !store.hiddenByUser &&
        (!areaPreferences.hideDistantStores ||
          store.isFavorite ||
          areaPreferences.preferredZone === "CUSTOM" ||
          store.zone === preferredZone)
    )
    .sort(
      (a, b) =>
        Number(b.isFavorite) - Number(a.isFavorite) ||
        a.distanceRank - b.distanceRank ||
        b.prediction.confidenceScore - a.prediction.confidenceScore ||
        a.storeName.localeCompare(b.storeName)
    );
  const checkTodayStores = storeDTOs
    .filter((store) => store.prediction.isLikelyToday || store.prediction.probability === "HIGH")
    .sort(
      (a, b) =>
        Number(b.isFavorite) - Number(a.isFavorite) ||
        a.distanceRank - b.distanceRank ||
        Number(b.prediction.isLikelyToday) - Number(a.prediction.isLikelyToday) ||
        b.prediction.confidenceScore - a.prediction.confidenceScore ||
        b.prediction.overdueScore - a.prediction.overdueScore ||
        a.storeName.localeCompare(b.storeName)
    );
  const productDTOs = products
    .map((product) => productToDTO(product, priorityScoreMap.get(product.id) ?? null))
    .sort((a, b) => (b.priorityScore?.score ?? 0) - (a.priorityScore?.score ?? 0));
  const cardDTOs = cards.map(cardToDTO);
  const alertDTOs = alerts.map(alertToDTO);
  const releaseDTOs = releases.map((release) => releaseToDTO(release, releaseMetrics(release, products, cards)));
  const health = currentUser.role === "ADMIN" ? await getAppHealth(currentUser) : null;
  const accuracyStats = await monitorAccuracyStats();
  const alertStats = await alertAnalytics();
  const notificationSettingsDTO = notificationSettingsToDTO(notificationSettings);
  const pendingDiscoveryCount = productDiscoveryCandidates.filter((candidate) => candidate.status === "PENDING").length;
  const activeDiscoverySourcesScanned = productDiscoverySources.filter((source) => source.enabled).length;
  const nextDiscoveryCheck = productDiscoverySources
    .map((source) => source.nextCheckAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const nextProductCheck = products
    .map((product) => product.nextCheckAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const nextScan = [nextProductCheck, nextDiscoveryCheck]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const scannerStatus: ScannerStatusDTO = {
    activeProductsScanned,
    activeDiscoverySourcesScanned,
    cronActive: Boolean(
      monitorLogs.some(
        (log) =>
          log.runType === "DUE_JOB" &&
          Date.now() - log.startedAt.getTime() <= 15 * 60 * 1000
      )
    ),
    lastScanTime: monitorLogs[0]?.startedAt.toISOString() ?? null,
    nextScanEstimate: nextScan?.toISOString() ?? null,
    newFindsPendingReview: pendingDiscoveryCount,
    liveRestocksDetectedToday
  };
  const setup = setupChecklist({
    productCount: productDTOs.length,
    storeCount: storeDTOs.length,
    releaseCount: releaseDTOs.length,
    externalAlertsConfigured:
      notificationSettingsDTO.browserPush || notificationSettingsDTO.email || notificationSettingsDTO.sms,
    monitorRunCount: monitorLogs.length
  });
  const qualityWarnings = dataQualityWarnings({ products: productDTOs, cards: cardDTOs, notificationSettings: notificationSettingsDTO });
  const monitorLogDTOs = monitorLogs.map(monitorLogToDTO);
  const inventoryDTOs = inventory.map(inventoryItemToDTO);
  const launchChecklist = ownerLaunchChecklist({
    products: productDTOs,
    stores: storeDTOs,
    releases: releaseDTOs,
    cards: cardDTOs,
    alerts: alertDTOs,
    monitorLogs: monitorLogDTOs,
    notificationSettings: notificationSettingsDTO,
    health,
    dailyRecaps: dailyRecaps.map(dailyRecapToDTO),
    inventory: inventoryDTOs,
    users: accessOverview.users
  });
  const calibrationQueue = alertCalibrationItems({
    products: productDTOs,
    monitorLogs: monitorLogDTOs,
    alerts: alertDTOs
  });
  const [storefrontOrders, storefrontStats, storefrontSettings] = await Promise.all([
    listStorefrontOrders(currentUser),
    storefrontSummary(currentUser),
    getStorefrontSettings()
  ]);

  return {
    currentUser,
    zoneOptions,
    userAreaPreferences: areaPreferences,
    users: accessOverview.users,
    friendInvites: accessOverview.friendInvites,
    auditLogs: accessOverview.auditLogs,
    dailyPlan: {
      topProducts: productDTOs.filter((product) => (product.priorityScore?.score ?? 0) >= 40).slice(0, 5),
      storesToCheck: checkTodayStores.slice(0, 5),
      latestAlerts: alertDTOs.slice(0, 5),
      newestReleases: releaseDTOs.slice(0, 5),
      bestCards: cardDTOs.slice(0, 5)
    },
    inventory: inventoryDTOs,
    inventorySummary: summarizeInventory(inventoryDTOs),
    storefrontOrders,
    storefrontSummary: storefrontStats,
    storefrontSettings,
    barcodeScans: barcodeScans.map(barcodeScanToDTO),
    dailyRecaps: dailyRecaps.map(dailyRecapToDTO),
    savedFilterPresets: savedFilterPresets.map(savedFilterPresetToDTO),
    retailers: retailers.map(retailerToDTO),
    retailerTemplates,
    products: productDTOs,
    todaysChaseList: productDTOs.filter((product) => (product.priorityScore?.score ?? 0) >= 40).slice(0, 8),
    stores: storeDTOs,
    checkTodayStores,
    sightings: sightings.map(sightingToDTO),
    releases: releaseDTOs,
    releaseCountdowns: releaseDTOs
      .filter((release) => release.daysUntilRelease >= 0 || (release.daysUntilPreorder ?? 9999) >= 0)
      .slice(0, 6),
    cards: cardDTOs,
    top10Watchlist: cardDTOs.slice(0, 10),
    cardCompSales: cardCompSales.map(cardCompSaleToDTO),
    investmentReports: investmentReports.map(investmentReportToDTO),
    ebayStatus: ebayConnectionStatus(),
    alerts: alertDTOs,
    monitorLogs: monitorLogDTOs,
    monitorAccuracyStats: accuracyStats,
    scannerStatus,
    productDiscoverySources: productDiscoverySources.map(productDiscoverySourceToDTO),
    productDiscoveryCandidates: productDiscoveryCandidates.map(productDiscoveryCandidateToDTO),
    alertAnalytics: alertStats,
    notificationSettings: notificationSettingsDTO,
    investmentSettings: investmentSettingsToDTO(investmentSettings),
    health,
    setupChecklist: setup,
    dataQualityWarnings: qualityWarnings,
    ownerLaunchChecklist: launchChecklist,
    alertCalibrationItems: calibrationQueue,
    stats: {
      actionableProducts: productDTOs.filter((product) =>
        ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product.stockStatus)
      ).length,
      unreadAlerts: alertDTOs.filter((alert) => !alert.read).length,
      highProbabilityStores: storeDTOs.filter((store) => store.prediction.probability === "HIGH").length,
      profitablePsa10Cards: cardDTOs.filter((card) => card.psa10EstimatedProfit > 0).length
    }
  };
}

export async function createProduct(input: {
  name: string;
  retailerId: string;
  releaseId?: string;
  setName?: string;
  productType?: string;
  imageUrl?: string;
  expectedTitleKeywords?: string;
  url: string;
  sku?: string;
  upc?: string;
  dpci?: string;
  retailerProductId?: string;
  retailPrice?: number;
  stockStatus: ProductStatus;
  priority: Priority;
  rating: Exclude<Rating, "AVOID">;
  monitorEnabled?: boolean;
  checkFrequencyMinutes?: number;
  requiredWords?: string;
  ignoreWords?: string;
  sealedResaleNotes?: string;
  scarcityNotes?: string;
  manualPriorityOverride?: Exclude<Rating, "AVOID">;
  notes?: string;
}) {
  const retailer = await prisma.retailer.findUnique({ where: { id: input.retailerId }, select: { name: true } });
  if (!retailer) throw new Error("Retailer not found");
  validateRetailerUrl(retailer.name, input.url);
  const checkFrequencyMinutes = input.checkFrequencyMinutes ?? 60;
  const product = await prisma.product.create({
    data: {
      ...input,
      releaseId: input.releaseId,
      manualPriorityOverride: input.manualPriorityOverride ?? input.rating,
      monitorEnabled: input.monitorEnabled ?? true,
      checkFrequencyMinutes,
      alertStatus: false,
      nextCheckAt: new Date(Date.now() + checkFrequencyMinutes * 60 * 1000)
    },
    include: productInclude
  });

  await prisma.restockHistory.create({
    data: {
      productId: product.id,
      status: product.stockStatus,
      price: product.retailPrice,
      snapshotReason: "Manual product created"
    }
  });

  return productToDTO(product);
}

export async function createProductDiscoverySource(input: {
  retailerId: string;
  name: string;
  url: string;
  notes?: string;
  enabled: boolean;
  checkFrequencyMinutes: number;
}) {
  const retailer = await prisma.retailer.findUnique({ where: { id: input.retailerId }, select: { name: true } });
  if (!retailer) throw new Error("Retailer not found");
  validateDiscoverySourceUrl(retailer.name, input.url);
  const source = await prisma.productDiscoverySource.create({
    data: {
      retailerId: input.retailerId,
      name: input.name,
      url: input.url,
      notes: input.notes,
      enabled: input.enabled,
      checkFrequencyMinutes: input.checkFrequencyMinutes,
      nextCheckAt: new Date()
    },
    include: productDiscoverySourceInclude
  });
  return productDiscoverySourceToDTO(source);
}

export async function runProductDiscoverySourceNow(sourceId: string) {
  return runProductDiscoveryCheck(sourceId, true);
}

export async function reviewProductDiscoveryCandidate(
  candidateId: string,
  input: {
    action: "approve" | "ignore";
    priority: Priority;
    rating: Exclude<Rating, "AVOID">;
    checkFrequencyMinutes: number;
    notes?: string;
  }
) {
  const candidate = await prisma.productDiscoveryCandidate.findUnique({
    where: { id: candidateId },
    include: productDiscoveryCandidateInclude
  });
  if (!candidate) throw new Error("Discovery candidate not found");
  if (candidate.status !== "PENDING") throw new Error("Discovery candidate has already been reviewed");

  if (input.action === "ignore") {
    const ignored = await prisma.productDiscoveryCandidate.update({
      where: { id: candidateId },
      data: { status: "IGNORED", reviewedAt: new Date(), ignoredAt: new Date() },
      include: productDiscoveryCandidateInclude
    });
    return { candidate: productDiscoveryCandidateToDTO(ignored), product: null };
  }

  validateRetailerUrl(candidate.retailer.name, candidate.url);
  const existingProduct = await prisma.product.findFirst({
    where: {
      retailerId: candidate.retailerId,
      OR: [
        { url: candidate.url },
        ...(candidate.retailerProductId ? [{ retailerProductId: candidate.retailerProductId }] : [])
      ]
    },
    include: productInclude
  });

  const product =
    existingProduct ??
    (await prisma.product.create({
      data: {
        retailerId: candidate.retailerId,
        name: candidate.productName,
        url: candidate.url,
        productType: candidate.productType,
        imageUrl: candidate.imageUrl,
        expectedTitleKeywords: candidate.productName
          .split(/[^a-zA-Z0-9]+/)
          .filter((part) => part.length >= 4)
          .slice(0, 8)
          .join(", "),
        retailerProductId: candidate.retailerProductId,
        retailPrice: candidate.livePrice,
        stockStatus: "UNAVAILABLE",
        priority: input.priority,
        rating: input.rating,
        manualPriorityOverride: input.rating,
        monitorEnabled: true,
        checkFrequencyMinutes: input.checkFrequencyMinutes,
        nextCheckAt: new Date(),
        notes: input.notes || `Approved from discovery source ${candidate.source.name}. Exact monitor must verify before alerts.`
      },
      include: productInclude
    }));

  const reviewed = await prisma.productDiscoveryCandidate.update({
    where: { id: candidateId },
    data: {
      status: "APPROVED",
      approvedProductId: product.id,
      reviewedAt: new Date()
    },
    include: productDiscoveryCandidateInclude
  });

  if (!existingProduct) {
    await prisma.restockHistory.create({
      data: {
        productId: product.id,
        status: product.stockStatus,
        price: product.retailPrice,
        snapshotReason: "Discovery candidate approved as watched product"
      }
    });
  }

  return {
    candidate: productDiscoveryCandidateToDTO(reviewed),
    product: productToDTO(product)
  };
}

export async function updateProductManualStatus(
  productId: string,
  input: {
    name: string;
    retailerId: string;
    releaseId?: string;
    setName?: string;
    productType?: string;
    imageUrl?: string;
    expectedTitleKeywords?: string;
    url: string;
    sku?: string;
    upc?: string;
    dpci?: string;
    retailerProductId?: string;
    stockStatus: ProductStatus;
    retailPrice?: number;
    priority: Priority;
    rating: Exclude<Rating, "AVOID">;
    monitorEnabled: boolean;
    checkFrequencyMinutes: number;
    requiredWords?: string;
    ignoreWords?: string;
    sealedResaleNotes?: string;
    scarcityNotes?: string;
    manualPriorityOverride?: Exclude<Rating, "AVOID">;
    notes?: string;
    reason?: string;
  }
) {
  const before = await prisma.product.findUnique({ where: { id: productId } });
  if (!before) throw new Error("Product not found");
  const retailer = await prisma.retailer.findUnique({ where: { id: input.retailerId }, select: { name: true } });
  if (!retailer) throw new Error("Retailer not found");
  validateRetailerUrl(retailer.name, input.url);
  const identityChanged =
    before.url !== input.url ||
    before.name !== input.name ||
    before.expectedTitleKeywords !== (input.expectedTitleKeywords ?? null) ||
    before.sku !== (input.sku ?? null) ||
    before.upc !== (input.upc ?? null) ||
    before.dpci !== (input.dpci ?? null) ||
    before.retailerProductId !== (input.retailerProductId ?? null);

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      name: input.name,
      retailerId: input.retailerId,
      releaseId: input.releaseId ?? null,
      setName: input.setName,
      productType: input.productType,
      imageUrl: input.imageUrl,
      expectedTitleKeywords: input.expectedTitleKeywords,
      url: input.url,
      sku: input.sku,
      upc: input.upc,
      dpci: input.dpci,
      retailerProductId: input.retailerProductId,
      verificationStatus: identityChanged ? "UNVERIFIED" : before.verificationStatus,
      verifiedAt: identityChanged ? null : before.verifiedAt,
      verifiedFinalUrl: identityChanged ? null : before.verifiedFinalUrl,
      verificationNotes: identityChanged ? "Product identity changed. Run Verify Exact Product before alerts." : before.verificationNotes,
      stockStatus: input.stockStatus,
      retailPrice: input.retailPrice,
      priority: input.priority,
      rating: input.rating,
      manualPriorityOverride: input.manualPriorityOverride ?? input.rating,
      monitorEnabled: input.monitorEnabled,
      checkFrequencyMinutes: input.checkFrequencyMinutes,
      requiredWords: input.requiredWords,
      ignoreWords: input.ignoreWords,
      nextCheckAt: new Date(Date.now() + input.checkFrequencyMinutes * 60 * 1000),
      notes: input.notes,
      sealedResaleNotes: input.sealedResaleNotes,
      scarcityNotes: input.scarcityNotes,
      lastCheckedAt: new Date(),
      lastSuccessfulCheckedAt: new Date(),
      pendingAlertStatus: null,
      pendingAlertPrice: null,
      pendingAlertPageHash: null,
      pendingAlertCount: 0,
      pendingAlertReason: null,
      pendingAlertConfidence: null,
      pendingAlertDetectedWords: null,
      pendingAlertAt: null,
      alertStatus: ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE", "PRICE_CHANGE", "PAGE_UPDATED"].includes(
        input.stockStatus
      ) && !identityChanged && productReadyForBuyAlerts(before)
    },
    include: productInclude
  });

  await prisma.restockHistory.create({
    data: {
      productId,
      status: input.stockStatus,
      price: product.retailPrice,
      snapshotReason: input.reason || "Manual Phase 1 status update"
    }
  });

  const alertWorthy =
    before.stockStatus !== input.stockStatus &&
    ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE", "PRICE_CHANGE", "PAGE_UPDATED"].includes(input.stockStatus) &&
    productReadyForBuyAlerts(product);

  if (alertWorthy) {
    const actionUrl = exactProductActionUrl(product);
    await prisma.alert.create({
      data: {
        title: `${product.name}: ${input.stockStatus.replaceAll("_", " ").toLowerCase()}`,
        reason: input.reason || `Manual status changed from ${before.stockStatus} to ${input.stockStatus}.`,
        priority: input.priority,
        entityType: "PRODUCT",
        entityId: product.id,
        productId: product.id,
        actionUrl
      }
    });
  }

  return productToDTO(product);
}

function normalizeUrlHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function nextProductCheckAt(minutes: number) {
  return new Date(Date.now() + Math.max(minutes, 5) * 60 * 1000);
}

function extractHtmlTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = ogTitle || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  return title.replace(/\s+/g, " ").trim().slice(0, 180);
}

function extractVisiblePrice(html: string) {
  const match = html.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{2})?/);
  return match?.[0].replace(/\s+/g, "") ?? null;
}

function stockStatusFromCue(cue: string | null): ProductStatus | null {
  if (!cue) return null;
  const normalized = cue.toLowerCase();
  if (normalized.includes("preorder") || normalized.includes("pre-order")) return "PREORDER_LIVE";
  if (normalized.includes("add to cart") || normalized.includes("add-to-cart") || normalized.includes("ship it")) {
    return "ADD_TO_CART_AVAILABLE";
  }
  if (normalized.includes("in stock") || normalized.includes("available now")) return "IN_STOCK";
  if (normalized.includes("sold out") || normalized.includes("out of stock")) return "SOLD_OUT";
  if (normalized.includes("unavailable") || normalized.includes("currently unavailable")) return "UNAVAILABLE";
  return null;
}

function isBlockedRetailPage(html: string, status: number) {
  const normalized = html.toLowerCase();
  if (status === 403 || status === 429) return "HTTP_BLOCKED";
  if (normalized.includes("captcha") || normalized.includes("robot check") || normalized.includes("are you a human")) {
    return "CAPTCHA_OR_ROBOT";
  }
  if (normalized.includes("queue") && normalized.includes("wait")) return "QUEUE";
  return null;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function absoluteProductImageUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    const decoded = decodeHtmlAttribute(value);
    if (!/^https?:\/\//i.test(decoded) && !decoded.startsWith("/")) return null;
    const parsed = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractProductImage(html: string, finalUrl: string) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for (const pattern of metaPatterns) {
    const imageUrl = absoluteProductImageUrl(html.match(pattern)?.[1], finalUrl);
    if (imageUrl) return imageUrl;
  }

  const jsonLdImage =
    html.match(/"image"\s*:\s*"([^"]+)"/i)?.[1] ||
    html.match(/"image"\s*:\s*\[\s*"([^"]+)"/i)?.[1];
  const structuredImage = absoluteProductImageUrl(jsonLdImage, finalUrl);
  if (structuredImage) return structuredImage;

  const publicCdnImage = html
    .match(/https?:\\?\/\\?\/[^"'\s<>]+(?:jpg|jpeg|png|webp)[^"'\s<>]*/i)?.[0]
    ?.replace(/\\\//g, "/");
  return absoluteProductImageUrl(publicCdnImage, finalUrl);
}

async function validateProductImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const response = await fetch(value, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.6" }
    });
    const type = response.headers.get("content-type") || "";
    const length = Number(response.headers.get("content-length") || "0");
    if (response.ok && type.toLowerCase().startsWith("image/") && (!length || length > 128)) {
      return response.url || value;
    }
  } catch {
    // Some retail CDNs reject HEAD; fall back to a small GET below.
  }

  try {
    const response = await fetch(value, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.6",
        Range: "bytes=0-2047"
      }
    });
    const type = response.headers.get("content-type") || "";
    if ((response.ok || response.status === 206) && type.toLowerCase().startsWith("image/")) {
      return response.url || value;
    }
  } catch {
    return null;
  }

  return null;
}

function detectStockCue(html: string, retailerName: string) {
  const template = retailerTemplates.find((item) => item.retailerName === retailerName);
  const normalized = html.toLowerCase();
  const cues = template
    ? [
        ...template.statusWords.inStock,
        ...template.statusWords.addToCart,
        ...template.statusWords.preorder,
        ...template.statusWords.soldOut,
        ...template.statusWords.unavailable
      ]
    : ["in stock", "add to cart", "sold out", "out of stock", "preorder"];
  return cues.find((cue) => normalized.includes(cue.toLowerCase())) ?? null;
}

export async function verifyProductLink(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: productInclude
  });
  if (!product) throw new Error("Product not found");

  const started = Date.now();
  try {
    const response = await fetch(product.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "PokeRestockRadar/0.4 product-link-verifier (+manual-checkout-only)"
      }
    });
    const html = await response.text();
    const finalUrl = response.url || product.url;
    const sameRetailerHost = normalizeUrlHost(finalUrl) === normalizeUrlHost(product.url);
    const titleText = extractHtmlTitle(html);
    const targetAvailability = product.retailer.name.toLowerCase().includes("target") ? detectTargetAvailability(html) : null;
    const targetApiSignal = product.retailer.name.toLowerCase().includes("target")
      ? await fetchTargetRedskyLiveSignal({
          html,
          finalUrl,
          retailerProductId: product.retailerProductId,
          userAgent: "PokeRestockRadar/0.4 product-link-verifier (+manual-checkout-only)",
          fallbackAvailability: targetAvailability ?? {
            status: null,
            stockText: null,
            addToCartEnabled: null,
            confidenceScore: 0,
            reason: "Target page availability was not parsed.",
            detectedWords: []
          }
        }).catch(() => null)
      : null;
    const visiblePriceValue = targetApiSignal?.price ?? detectRetailerPrice(html, product.retailer.name);
    const visiblePrice = visiblePriceValue === null ? extractVisiblePrice(html) : `$${visiblePriceValue.toFixed(2)}`;
    const productImageUrl = targetApiSignal?.imageUrl || extractProductImage(html, finalUrl);
    const stockCue = detectStockCue(html, product.retailer.name);
    const liveStockStatus = targetApiSignal?.availability.status ?? targetAvailability?.status ?? stockStatusFromCue(stockCue);
    const redirectedAway = !sameRetailerHost;
    const blockedType = isBlockedRetailPage(html, response.status);
    const identity = matchProductIdentity({
      product: {
        retailerName: product.retailer.name,
        name: product.name,
        url: product.url,
        expectedTitleKeywords: product.expectedTitleKeywords,
        upc: product.upc,
        sku: product.sku,
        dpci: product.dpci,
        retailerProductId: product.retailerProductId,
        retailPrice: product.retailPrice
      },
      finalUrl,
      html,
      titleText,
      httpStatus: response.status
    });
    const verifiedProductImageUrl =
      identity.readyForAlert && !redirectedAway && !blockedType ? await validateProductImageUrl(productImageUrl) : null;
    const verificationStatus = blockedType
      ? "POSSIBLE_MISMATCH"
      : redirectedAway
      ? "POSSIBLE_MISMATCH"
      : identity.verificationStatus;
    const liveConfidenceScore = blockedType
      ? 0
      : identity.readyForAlert && !redirectedAway
      ? Math.min(
          98,
          58 +
            (identity.productIdVerified ? 10 : 0) +
            (verifiedProductImageUrl ? 10 : 0) +
            (visiblePriceValue !== null ? 10 : 0) +
            (liveStockStatus ? 10 : 0)
        )
      : Math.min(25, identity.matchedTitleKeywords.length * 5 + identity.matchedIdentifiers.length * 10);
    const now = new Date();
    const notes = [
      `HTTP ${response.status}`,
      `Final URL ${finalUrl}`,
      titleText ? `Product title text: ${titleText}` : "Product title text not found",
      identity.productIdVerified ? "Retailer product ID verified" : "Retailer product ID not verified",
      verifiedProductImageUrl ? `Product image validated from exact page` : "Product image unavailable or not valid",
      visiblePrice ? `Visible price cue: ${visiblePrice}` : "Visible price cue not found",
      targetApiSignal?.availability.stockText
        ? `Stock cue: ${targetApiSignal.availability.stockText}`
        : targetAvailability?.stockText
        ? `Stock cue: ${targetAvailability.stockText}`
        : stockCue
        ? `Stock cue: ${stockCue}`
        : "Stock cue not found",
      targetApiSignal || targetAvailability
        ? `Add-to-cart enabled: ${
            (targetApiSignal?.availability.addToCartEnabled ?? targetAvailability?.addToCartEnabled) === null
              ? "unknown"
              : targetApiSignal?.availability.addToCartEnabled ?? targetAvailability?.addToCartEnabled
          }`
        : null,
      targetApiSignal?.availability.reason
        ? `Availability reason: ${targetApiSignal.availability.reason}`
        : targetAvailability?.reason
        ? `Availability reason: ${targetAvailability.reason}`
        : null,
      targetApiSignal?.source ? `Live data source: ${targetApiSignal.source}` : null,
      `Response ${Date.now() - started}ms`,
      blockedType ? `Blocked page signal: ${blockedType}` : null,
      `Expected title keywords: ${identity.titleKeywords.join(", ") || "none"}`,
      identity.matchedIdentifiers.length ? `Matched identifiers: ${identity.matchedIdentifiers.join(", ")}` : "No stored identifier matched",
      identity.missingIdentifiers.length ? `Missing identifiers: ${identity.missingIdentifiers.join(", ")}` : null,
      redirectedAway ? "Warning: final URL host differs from tracked URL host" : null,
      ...identity.notes
    ]
      .filter(Boolean)
      .join(". ");

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        verificationStatus,
        verifiedAt: now,
        verifiedFinalUrl: finalUrl,
        verificationNotes: notes,
        retailerProductId: product.retailerProductId || identity.retailerProductIdFromUrl,
        imageUrl: identity.readyForAlert && !redirectedAway && verifiedProductImageUrl ? verifiedProductImageUrl : product.imageUrl,
        retailPrice: visiblePriceValue !== null && liveConfidenceScore >= 70 ? visiblePriceValue : product.retailPrice,
        liveTitle: titleText || null,
        livePrice: visiblePriceValue,
        livePriceSource: visiblePriceValue === null ? null : "Retailer page",
        livePriceVerifiedAt: visiblePriceValue === null ? undefined : now,
        liveStockStatus,
        liveStockVerifiedAt: liveStockStatus === null ? undefined : now,
        liveImageUrl: verifiedProductImageUrl,
        liveConfidenceScore,
        liveBlockedType: blockedType,
        isDemoData: visiblePriceValue !== null || liveStockStatus !== null ? false : product.isDemoData,
        lastCheckedAt: now,
        lastSuccessfulCheckedAt: blockedType ? product.lastSuccessfulCheckedAt : now,
        nextCheckAt: nextProductCheckAt(product.checkFrequencyMinutes),
        lastMonitorError: blockedType ? `Blocked during verification: ${blockedType}` : null,
        lastMonitorResult: `Product link verification: ${verificationStatus}. ${notes}`
      },
      include: productInclude
    });
    return productToDTO(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product link verification failed.";
    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        verificationStatus: "POSSIBLE_MISMATCH",
        verifiedAt: new Date(),
        verificationNotes: message,
        lastCheckedAt: new Date(),
        lastMonitorError: message
      },
      include: productInclude
    });
    return productToDTO(updated);
  }
}

export async function deleteProduct(productId: string) {
  await prisma.alert.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  return { ok: true };
}

export async function archiveProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: productInclude
  });
  if (!product) throw new Error("Product not found");

  const now = new Date();
  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      archivedAt: now,
      monitorEnabled: false,
      alertStatus: false,
      nextCheckAt: null,
      lastMonitorResult: "Archived from Product QA cleanup.",
      updatedAt: now
    },
    include: productInclude
  });
  await prisma.monitorLog.create({
    data: {
      productId,
      runType: "MANUAL_PRODUCT",
      status: "SKIPPED",
      previousStatus: product.stockStatus,
      detectedStatus: "ARCHIVED",
      previousPrice: product.livePrice ?? product.retailPrice,
      detectedPrice: product.livePrice,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      changeSummary: "Product archived from QA cleanup. It will no longer appear in dashboards or monitor batches.",
      finalUrl: product.verifiedFinalUrl || product.url,
      alertSent: false
    }
  });
  return productToDTO(updated);
}

export async function markProductCheckedToday(
  currentUser: SessionUser,
  productId: string,
  input: { note?: string | null } = {}
) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: productInclude });
  if (!product) throw new Error("Product not found");
  const now = new Date();
  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      lastCheckedAt: now,
      lastSuccessfulCheckedAt: now,
      lastMonitorResult: input.note || "Marked checked today from daily workflow.",
      nextCheckAt: new Date(now.getTime() + product.checkFrequencyMinutes * 60 * 1000)
    },
    include: productInclude
  });
  await prisma.monitorLog.create({
    data: {
      productId,
      runType: "MANUAL_DAILY",
      status: "SUCCESS",
      previousStatus: product.stockStatus,
      detectedStatus: product.stockStatus,
      previousPrice: product.retailPrice,
      detectedPrice: product.retailPrice,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      changeSummary: input.note || `${currentUser.email} marked product checked today.`,
      finalUrl: product.url,
      alertSent: false
    }
  });
  return productToDTO(updated);
}

type InventoryProductLink = Prisma.ProductGetPayload<{
  include: { retailer: { select: { name: true } }; release: { select: { setName: true } } };
}>;

function compactIdentifier(value?: string | null) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactTokens(value?: string | null) {
  const cleaned = (value || "")
    .toLowerCase()
    .replace(/pokemon|tcg|trading card game|game/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  return cleaned.split(/\s+/).filter(Boolean);
}

function tokenOverlapScore(a?: string | null, b?: string | null) {
  const aTokens = new Set(compactTokens(a));
  const bTokens = new Set(compactTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let hits = 0;
  for (const token of aTokens) if (bTokens.has(token)) hits += 1;
  return hits / Math.max(aTokens.size, bTokens.size);
}

type InventoryProductMatchInput = Pick<InventoryItemWithInclude, "itemName" | "retailer" | "setName" | "upc" | "sku" | "dpci" | "asin">;

function inventoryProductMatchScore(
  item: InventoryProductMatchInput,
  product: InventoryProductLink
) {
  const itemIds = [item.upc, item.sku, item.dpci, item.asin].map(compactIdentifier).filter(Boolean);
  const productIds = [product.upc, product.sku, product.dpci, product.retailerProductId].map(compactIdentifier).filter(Boolean);
  if (itemIds.some((itemId) => productIds.includes(itemId))) return 100;
  let score = 0;
  const itemName = compactIdentifier(item.itemName);
  const productName = compactIdentifier(product.name);
  if (itemName && productName && (itemName === productName || itemName.includes(productName) || productName.includes(itemName))) {
    score += 65;
  } else {
    score += tokenOverlapScore(item.itemName, product.name) * 55;
  }
  if (item.retailer && item.retailer.toLowerCase() === product.retailer.name.toLowerCase()) score += 20;
  const productSet = product.setName || product.release?.setName;
  if (item.setName && productSet && compactIdentifier(item.setName) === compactIdentifier(productSet)) score += 15;
  return Math.round(score);
}

function bestWatchedProductMatch(item: InventoryProductMatchInput, products: InventoryProductLink[]) {
  let best: { product: InventoryProductLink; score: number } | null = null;
  for (const product of products) {
    const score = inventoryProductMatchScore(item, product);
    if (!best || score > best.score) best = { product, score };
  }
  return best && best.score >= 80 ? best.product : null;
}

function productSyncData(product: InventoryProductLink) {
  const retailerName = product.retailer.name;
  return {
    productId: product.id,
    retailer: retailerName,
    setName: product.setName ?? product.release?.setName ?? undefined,
    exactProductUrl: product.verifiedFinalUrl || product.url,
    upc: product.upc ?? undefined,
    sku: product.sku ?? undefined,
    dpci: product.dpci ?? undefined,
    asin: retailerName.toLowerCase().includes("amazon") ? product.retailerProductId ?? undefined : undefined,
    imageUrl: product.liveImageUrl ?? product.imageUrl ?? undefined
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

async function findWatchedProductMatch(item: InventoryProductMatchInput) {
  const products = await prisma.product.findMany({
    where: { archivedAt: null },
    include: { retailer: { select: { name: true } }, release: { select: { setName: true } } }
  });
  return bestWatchedProductMatch(item, products);
}

async function autoLinkInventoryProducts(currentUser: SessionUser) {
  const items = await prisma.inventoryItem.findMany({
    where: { productId: null, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude
  });
  if (!items.length) return;
  const products = await prisma.product.findMany({
    where: { archivedAt: null },
    include: { retailer: { select: { name: true } }, release: { select: { setName: true } } }
  });
  for (const item of items) {
    const match = bestWatchedProductMatch(item, products);
    if (!match) continue;
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: productSyncData(match)
    });
  }
}

function inventoryCategoryFromProductType(productType?: string | null) {
  const normalized = (productType || "").toLowerCase();
  if (normalized.includes("elite") || normalized.includes("etb")) return "etbs";
  if (normalized.includes("booster bundle")) return "booster_bundles";
  if (normalized.includes("booster box")) return "booster_boxes";
  if (normalized.includes("sleeved")) return "sleeved_boosters";
  if (normalized.includes("collection")) return "collection_boxes";
  if (normalized.includes("card")) return "single_cards";
  return "sealed_packs";
}

function productToLookupProduct(product: Prisma.ProductGetPayload<{ include: typeof productInclude }>): UpcLookupProductDTO {
  const productName = product.liveTitle || product.name;
  return {
    upc: product.upc || "",
    title: productName,
    productName,
    brand: product.name.toLowerCase().includes("pokemon") ? "Pokemon" : null,
    category: inventoryCategoryFromProductType(product.productType),
    setName: product.setName ?? product.release?.setName ?? null,
    description: product.notes,
    imageUrl: product.liveImageUrl ?? product.imageUrl,
    additionalImages: [],
    msrp: product.livePrice ?? product.retailPrice ?? null,
    model: product.sku,
    manufacturer: product.retailer.name,
    sku: product.sku ?? product.retailerProductId ?? null,
    retailer: product.retailer.name,
    exactProductUrl: product.verifiedFinalUrl || product.url,
    productId: product.id,
    source: "watched_product",
    confidence: 100,
    matchQuality: "HIGH"
  };
}

function externalLookupUrl(upc: string) {
  const template = process.env.UPC_LOOKUP_API_URL?.trim();
  if (!template) return null;
  const apiKey = process.env.UPC_LOOKUP_API_KEY?.trim() || "";
  const withUpc = template.includes("{upc}") ? template.replaceAll("{upc}", encodeURIComponent(upc)) : template;
  const withKey = withUpc.includes("{apiKey}") ? withUpc.replaceAll("{apiKey}", encodeURIComponent(apiKey)) : withUpc;
  if (withKey !== template) return withKey;
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}upc=${encodeURIComponent(upc)}`;
}

function upcProviderConfig(): UpcLookupDebugDTO["providerConfig"] {
  const searchConfig = productSearchConfig();
  return {
    configuredUpcProvider: Boolean(process.env.UPC_LOOKUP_API_URL?.trim()),
    publicUpcProvider: true,
    searchFallback: searchConfig.configured,
    searchProvider: searchConfig.provider
  };
}

function lookupFailure(
  source: string,
  reason: string,
  options: { configured?: boolean; statusCode?: number; detail?: string | null } = {}
): UpcLookupFailureDTO {
  return {
    source,
    reason,
    configured: options.configured,
    statusCode: options.statusCode,
    detail: options.detail ? options.detail.slice(0, 240) : undefined
  };
}

function errorStatusCode(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
}

function textFromLookupPayload(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = compactLookupText(record[key]);
    if (value) return value;
  }
  return null;
}

function numberFromLookupPayload(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^\d.]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function arrayFromLookupPayload(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  return keys.flatMap((key) => {
    const value = record[key];
    if (Array.isArray(value)) return value;
    return [];
  });
}

function imageArrayFromLookupPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const imageFields = [record.images, record.additionalImages, record.imageUrls, record.gallery];
  const images = imageFields
    .flatMap((field) => (Array.isArray(field) ? field : typeof field === "string" ? [field] : []))
    .map(compactLookupText)
    .filter((value): value is string => Boolean(value));
  const singleImage = textFromLookupPayload(payload, ["imageUrl", "image", "thumbnail", "largeImage", "image_url"]);
  return Array.from(new Set([singleImage, ...images].filter((value): value is string => Boolean(value))));
}

function lookupPayloadCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  return [
    record.product,
    record.item,
    record.result,
    Array.isArray(record.products) ? record.products[0] : null,
    Array.isArray(record.items) ? record.items[0] : null,
    Array.isArray(record.results) ? record.results[0] : null,
    Array.isArray(record.data) ? record.data[0] : null,
    record.data,
    record
  ].filter((candidate) => candidate && typeof candidate === "object");
}

function objectFromLookupPayload(payload: unknown) {
  return lookupPayloadCandidates(payload).find((candidate) => {
    const title = textFromLookupPayload(candidate, ["productName", "title", "name", "description"]);
    return Boolean(title);
  }) ?? null;
}

function bestOfferFromLookupPayload(payload: unknown) {
  const offers = arrayFromLookupPayload(payload, ["offers", "sellers", "merchants"]);
  return offers.find((offer) => offer && typeof offer === "object") as Record<string, unknown> | undefined;
}

function inferCategoryFromProductText(...values: Array<string | null | undefined>) {
  const normalized = values.filter(Boolean).join(" ").toLowerCase();
  if (normalized.includes("elite trainer") || normalized.includes(" etb")) return "etbs";
  if (normalized.includes("booster bundle")) return "booster_bundles";
  if (normalized.includes("booster box")) return "booster_boxes";
  if (normalized.includes("sleeved booster")) return "sleeved_boosters";
  if (normalized.includes("collection")) return "collection_boxes";
  if (normalized.includes("graded")) return "graded_cards";
  if (normalized.includes("raw card")) return "raw_cards";
  if (normalized.includes("pokemon") || normalized.includes("trading card") || normalized.includes("tcg")) return "sealed_packs";
  return null;
}

function productFromLookupPayload(upc: string, payload: unknown, source: UpcLookupProductDTO["source"]): UpcLookupProductDTO | null {
  const object = objectFromLookupPayload(payload);
  if (!object) return null;
  const productName = textFromLookupPayload(object, ["productName", "title", "name", "product_name", "description"]);
  if (!productName) return null;
  const images = imageArrayFromLookupPayload(object);
  const offer = bestOfferFromLookupPayload(object);
  const offerMerchant = textFromLookupPayload(offer, ["merchant", "retailer", "store", "seller"]);
  const offerUrl = textFromLookupPayload(offer, ["link", "url", "productUrl"]);
  const offerPrice = numberFromLookupPayload(offer, ["price", "list_price", "salePrice"]);
  const brand = textFromLookupPayload(object, ["brand", "brandName", "manufacturer", "publisher"]);
  const description = textFromLookupPayload(object, ["description", "longDescription", "shortDescription"]);
  const category =
    textFromLookupPayload(object, ["category", "productType", "categoryName", "department"]) ??
    inferCategoryFromProductText(productName, description);
  const retailer = textFromLookupPayload(object, ["retailer", "store", "merchant", "seller"]) ?? offerMerchant;
  const model = textFromLookupPayload(object, ["model", "modelNumber", "sku", "mpn", "tcin"]);
  const directTargetUrl =
    retailer?.toLowerCase().includes("target") && model && /^\d{6,12}$/.test(model)
      ? `https://www.target.com/p/-/A-${model}`
      : null;
  return {
    upc,
    title: productName,
    productName,
    brand,
    category,
    setName: textFromLookupPayload(object, ["setName", "set"]),
    description,
    imageUrl: images[0] ?? null,
    additionalImages: images.slice(1),
    msrp: numberFromLookupPayload(object, ["msrp", "price", "retailPrice", "lowestPrice", "lowest_recorded_price"]) ?? offerPrice,
    model,
    manufacturer: textFromLookupPayload(object, ["manufacturer", "brand", "publisher"]),
    sku: textFromLookupPayload(object, ["sku", "model", "mpn", "asin", "tcin"]),
    retailer,
    exactProductUrl: textFromLookupPayload(object, ["exactProductUrl", "url", "productUrl", "link"]) ?? directTargetUrl ?? offerUrl,
    productId: null,
    source,
    confidence: 90,
    matchQuality: "HIGH"
  };
}

function lookupQualityFromConfidence(confidence: number | null | undefined): UpcLookupProductDTO["matchQuality"] {
  if (confidence === null || confidence === undefined) return null;
  if (confidence >= 70) return "HIGH";
  if (confidence >= 50) return "MEDIUM";
  return "LOW";
}

function productFromSearchCandidate(upc: string, candidate: ProductSearchCandidate): UpcLookupProductDTO {
  return {
    upc,
    title: candidate.title,
    productName: candidate.title,
    brand: candidate.brand ?? null,
    category: candidate.category ?? inferCategoryFromProductText(candidate.title),
    setName: null,
    description: null,
    imageUrl: candidate.imageUrl ?? null,
    additionalImages: [],
    msrp: candidate.price ?? null,
    model: candidate.sku ?? candidate.tcin ?? null,
    manufacturer: candidate.brand ?? candidate.retailer ?? null,
    sku: candidate.sku ?? candidate.tcin ?? null,
    retailer: candidate.retailer ?? null,
    exactProductUrl: candidate.productUrl ?? null,
    productId: null,
    source: "external",
    confidence: candidate.confidence,
    matchQuality: lookupQualityFromConfidence(candidate.confidence)
  };
}

async function fetchLookupJson(url: string, apiKey?: string | null) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error(`Lookup source returned ${response.status}.`) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

async function lookupConfiguredUpcProvider(
  upc: string
): Promise<{ configured: boolean; product: UpcLookupProductDTO | null; error: string | null; failures: UpcLookupFailureDTO[] }> {
  const url = externalLookupUrl(upc);
  if (!url) {
    return {
      configured: false,
      product: null,
      error: null,
      failures: [lookupFailure("configured_upc_provider", "missing_env", { configured: false, detail: "UPC_LOOKUP_API_URL is not configured." })]
    };
  }
  try {
    const apiKey = process.env.UPC_LOOKUP_API_KEY?.trim();
    const product = productFromLookupPayload(upc, await fetchLookupJson(url, apiKey), "external");
    if (!product) {
      return {
        configured: true,
        product: null,
        error: "Lookup source did not return a product name.",
        failures: [lookupFailure("configured_upc_provider", "not_found", { configured: true, detail: "Configured UPC provider returned no structured product." })]
      };
    }
    return { configured: true, product, error: null, failures: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup source failed.";
    return {
      configured: true,
      product: null,
      error: message,
      failures: [lookupFailure("configured_upc_provider", "provider_error", { configured: true, statusCode: errorStatusCode(error), detail: message })]
    };
  }
}

async function lookupUpcItemDb(upc: string): Promise<{ configured: boolean; product: UpcLookupProductDTO | null; error: string | null; failures: UpcLookupFailureDTO[] }> {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`;
  try {
    const payload = await fetchLookupJson(url);
    const product = productFromLookupPayload(upc, payload, "external");
    return {
      configured: true,
      product,
      error: product ? null : null,
      failures: product ? [] : [lookupFailure("upc_provider", "not_found", { configured: true, detail: "UPCItemDB returned no structured product." })]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPCItemDB lookup failed.";
    return {
      configured: true,
      product: null,
      error: message,
      failures: [lookupFailure("upc_provider", "provider_error", { configured: true, statusCode: errorStatusCode(error), detail: message })]
    };
  }
}

async function lookupConfiguredSearchProvider(
  upc: string
): Promise<{ configured: boolean; product: UpcLookupProductDTO | null; error: string | null; failures: UpcLookupFailureDTO[] }> {
  const searchResult = await searchProductsByUpc(upc);
  const failures = searchResult.failures.map((failure) =>
    lookupFailure(failure.source, failure.reason, {
      configured: failure.configured,
      statusCode: failure.statusCode,
      detail: failure.detail
    })
  );
  const bestCandidate = searchResult.candidates[0] ?? null;
  if (bestCandidate) {
    return {
      configured: searchResult.configured,
      product: productFromSearchCandidate(upc, bestCandidate),
      error: null,
      failures
    };
  }
  if (!searchResult.configured) {
    return {
      configured: false,
      product: null,
      error: "Search fallback is not configured. UPC provider may miss newer Pokemon products.",
      failures
    };
  }
  return {
    configured: true,
    product: null,
    error: "Search provider returned no high-confidence Pokemon product result.",
    failures: failures.length
      ? failures
      : [lookupFailure("search", "low_confidence", { configured: true, detail: `Provider ${searchResult.provider || "unknown"} returned no usable candidates.` })]
  };
}

async function lookupExternalUpc(
  upc: string
): Promise<{ configured: boolean; product: UpcLookupProductDTO | null; error: string | null; debug: UpcLookupDebugDTO }> {
  const errors: string[] = [];
  const attemptedSources = ["configured_upc_provider", "upc_provider", "search"];
  const failures: UpcLookupFailureDTO[] = [];
  const configuredProvider = await lookupConfiguredUpcProvider(upc);
  failures.push(...configuredProvider.failures);
  if (configuredProvider.product) {
    return { ...configuredProvider, debug: { attemptedSources, failures, providerConfig: upcProviderConfig() } };
  }
  if (configuredProvider.error) errors.push(configuredProvider.error);

  const publicProvider = await lookupUpcItemDb(upc);
  failures.push(...publicProvider.failures);
  if (publicProvider.product) {
    return { ...publicProvider, debug: { attemptedSources, failures, providerConfig: upcProviderConfig() } };
  }
  if (publicProvider.error) errors.push(publicProvider.error);

  const searchProvider = await lookupConfiguredSearchProvider(upc);
  failures.push(...searchProvider.failures);
  if (searchProvider.product) {
    return { ...searchProvider, debug: { attemptedSources, failures, providerConfig: upcProviderConfig() } };
  }
  if (searchProvider.error) errors.push(searchProvider.error);

  return {
    configured: configuredProvider.configured || publicProvider.configured || searchProvider.configured,
    product: null,
    error: errors[0] ?? searchProvider.error ?? null,
    debug: { attemptedSources, failures, providerConfig: upcProviderConfig() }
  };
}

async function barcodeScanHistory(currentUser: SessionUser) {
  const scans = await prisma.barcodeScan.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    take: 12
  });
  return scans.map(barcodeScanToDTO);
}

export async function lookupInventoryUpc(
  currentUser: SessionUser,
  input: { upc: string; source?: "camera" | "manual" }
): Promise<UpcLookupResultDTO> {
  const upc = normalizeUPC(input.upc);
  if (!/^\d{6,14}$/.test(upc)) throw new Error("UPC/EAN must be 6 to 14 digits.");
  const inventoryItem = await prisma.inventoryItem.findFirst({
    where: { upc, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude,
    orderBy: { updatedAt: "desc" }
  });
  const watchedProduct = await prisma.product.findFirst({
    where: { upc, archivedAt: null },
    include: productInclude,
    orderBy: { updatedAt: "desc" }
  });
  const localFailures: UpcLookupFailureDTO[] = [
    ...(inventoryItem ? [] : [lookupFailure("local", "not_found", { configured: true, detail: "No inventory item matched this UPC." })]),
    ...(watchedProduct ? [] : [lookupFailure("catalog", "not_found", { configured: true, detail: "No watched product matched this UPC." })])
  ];
  const external =
    inventoryItem || watchedProduct
      ? {
          configured: upcProviderConfig().configuredUpcProvider || upcProviderConfig().publicUpcProvider,
          product: null,
          error: null,
          debug: { attemptedSources: [] as string[], failures: [] as UpcLookupFailureDTO[], providerConfig: upcProviderConfig() }
        }
      : await lookupExternalUpc(upc);
  const debug: UpcLookupDebugDTO = {
    attemptedSources: Array.from(new Set(["local", "catalog", ...external.debug.attemptedSources])),
    failures: [...localFailures, ...external.debug.failures],
    providerConfig: external.debug.providerConfig
  };
  const status: BarcodeScanDTO["status"] = inventoryItem || watchedProduct || external.product ? "PRODUCT_FOUND" : external.configured && external.error ? "LOOKUP_FAILED" : "NEW_UPC";
  const productName = inventoryItem?.itemName ?? watchedProduct?.name ?? external.product?.productName ?? null;
  await prisma.barcodeScan.create({
    data: {
      userId: currentUser.id,
      upc,
      source: input.source || "manual",
      status,
      resultType: inventoryItem ? "inventory" : watchedProduct ? "watched_product" : external.product ? "external" : "manual",
      inventoryItemId: inventoryItem?.id,
      productId: watchedProduct?.id,
      productName,
      notes: external.error
    }
  });
  return {
    upc,
    status,
    message: inventoryItem
      ? "Product found in your inventory catalog. Add stock to the existing item."
      : watchedProduct
        ? "Watched product found. Create the inventory item from the verified product details."
        : external.product
          ? "Product lookup found a possible match. Confirm before saving."
          : "No product found from configured sources.",
    matchedInventoryItem: inventoryItem ? inventoryItemToDTO(inventoryItem) : null,
    matchedProduct: watchedProduct ? productToDTO(watchedProduct) : null,
    lookupProduct: inventoryItem
      ? {
          upc,
          title: inventoryItem.itemName,
          productName: inventoryItem.itemName,
          brand: inventoryItem.brand,
          category: inventoryItem.category,
          setName: inventoryItem.setName,
          description: inventoryItem.description,
          imageUrl: inventoryItem.imageUrl,
          additionalImages: [],
          msrp: inventoryItem.msrp,
          model: inventoryItem.model,
          manufacturer: inventoryItem.manufacturer,
          sku: inventoryItem.sku,
          retailer: inventoryItem.retailer,
          exactProductUrl: inventoryItem.exactProductUrl,
          productId: inventoryItem.productId,
          source: "inventory",
          confidence: 100,
          matchQuality: "HIGH"
        }
      : watchedProduct
        ? { ...productToLookupProduct(watchedProduct), upc }
        : external.product,
    externalLookupConfigured: external.configured,
    debug,
    history: await barcodeScanHistory(currentUser)
  };
}

function inventoryMarketRecommendation(
  input: {
    category?: string | null;
    itemStatus?: string | null;
    cost: number;
    quantity: number;
    quantityOwned?: number;
    costBasis?: number;
    totalCost?: number | null;
    purchaseExtraCost?: number | null;
    currentMarketEstimate?: number | null;
    soldPrice?: number | null;
    estimatedEbayFee?: number | null;
    estimatedShippingCost?: number | null;
    marketCompCount?: number;
    marketConfidence?: string | null;
    product?: {
      liveStockStatus?: string | null;
      stockStatus?: string | null;
      priority?: string | null;
      rating?: string | null;
      manualPriorityOverride?: string | null;
      sealedResaleNotes?: string | null;
      scarcityNotes?: string | null;
    } | null;
    card?: {
      rawAveragePrice: number;
      psa9EstimatedProfit: number;
      psa10EstimatedProfit: number;
      rating: string;
    } | null;
  },
  settings: { ebaySellingFee: number; shippingCost: number; minimumProfitTarget: number }
) {
  const quantityOwned = input.quantityOwned ?? input.quantity;
  const totalCost = input.costBasis ?? input.totalCost ?? input.cost * quantityOwned + (input.purchaseExtraCost ?? 0);
  const compCount = input.marketCompCount ?? 0;
  const hasRealComps = compCount > 0;
  const marketPrice = hasRealComps ? input.currentMarketEstimate ?? null : null;
  const gross = marketPrice === null ? null : marketPrice * quantityOwned;
  const estimatedEbayFee = gross === null ? null : gross * settings.ebaySellingFee;
  const estimatedShippingCost = gross === null ? null : input.estimatedShippingCost ?? settings.shippingCost;
  const estimatedNetProfit =
    gross === null || estimatedEbayFee === null || estimatedShippingCost === null
      ? null
      : gross - estimatedEbayFee - estimatedShippingCost - totalCost;
  const roiPercent = estimatedNetProfit === null || totalCost <= 0 ? null : (estimatedNetProfit / totalCost) * 100;
  const itemStatus = input.itemStatus || "";
  const confidence = input.marketConfidence || (compCount >= 3 ? "HIGH" : compCount >= 2 ? "MEDIUM" : compCount === 1 ? "LOW" : "NONE");
  const strongComps = compCount >= 3 && (confidence === "HIGH" || confidence === "MEDIUM" || confidence === "MANUAL");
  const productSignals = [input.product?.sealedResaleNotes, input.product?.scarcityNotes, input.product?.priority, input.product?.rating, input.product?.manualPriorityOverride]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const lowSupplyOrHighDemand =
    /scarce|limited|exclusive|low supply|hard to find|high demand|sold out|buy/.test(productSignals) ||
    input.product?.liveStockStatus === "SOLD_OUT" ||
    input.product?.stockStatus === "SOLD_OUT";
  let recommendedAction = "HOLD";
  let recommendationReason = "Market not collected yet. Add sold comps before recommendations use profit data.";

  if (hasRealComps && input.card && itemStatus === "raw" && Math.max(input.card.psa9EstimatedProfit, input.card.psa10EstimatedProfit) >= settings.minimumProfitTarget) {
    recommendedAction = "GRADE_FIRST";
    recommendationReason = `Grade first because linked card comps show PSA upside over the ${settings.minimumProfitTarget.toFixed(0)} target.`;
  } else if (estimatedNetProfit !== null && roiPercent !== null) {
    if (estimatedNetProfit < 0) {
      recommendedAction = "AVOID_BUYING_MORE";
      recommendationReason = `Avoid buying more: current market is below your remaining cost after fees.`;
    } else if (strongComps && estimatedNetProfit >= settings.minimumProfitTarget && roiPercent >= 30) {
      recommendedAction = "SELL_NOW";
      recommendationReason = `Sell now: last sold comps support about $${estimatedNetProfit.toFixed(2)} profit and ${roiPercent.toFixed(1)}% ROI after fees.`;
    } else if (lowSupplyOrHighDemand && estimatedNetProfit >= settings.minimumProfitTarget && roiPercent >= 15) {
      recommendedAction = "LIST_HIGH";
      recommendationReason = `List high: margin clears target and linked product notes suggest low supply or strong demand.`;
    } else if (estimatedNetProfit >= settings.minimumProfitTarget && roiPercent >= 18) {
      recommendedAction = "LIST_HIGH";
      recommendationReason = `List high: profit target is met, but comps are not strong enough for an urgent sell.`;
    } else {
      recommendedAction = "HOLD";
      recommendationReason = `Hold: current margin does not clear the ${settings.minimumProfitTarget.toFixed(0)} profit target.`;
    }
  }

  return {
    estimatedEbayFee,
    estimatedShippingCost,
    estimatedNetProfit,
    roiPercent,
    recommendedAction,
    recommendationReason,
    netProfitAfterFees: estimatedNetProfit
  };
}

async function recomputeInventoryItem(itemId: string, currentUser: SessionUser) {
  const settings = await ensureInvestmentSettings(currentUser);
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId }, include: inventoryItemInclude });
  if (!item) throw new Error("Inventory item not found");
  if (!item.productId) {
    const match = await findWatchedProductMatch(item);
    if (match) {
      await prisma.inventoryItem.update({ where: { id: itemId }, data: productSyncData(match) });
      return recomputeInventoryItem(itemId, currentUser);
    }
  }
  const compStats = inventoryCompStats(item.marketComps);
  const compCount = item.marketComps.length;
  const currentMarketEstimate = compCount ? compStats.average : item.currentMarketEstimate;
  const confidence = compCount >= 3 ? "HIGH" : compCount >= 2 ? "MEDIUM" : compCount === 1 ? "LOW" : "NONE";
  const latestCompEnteredAt = latestInventoryCompEnteredAt(item.marketComps);
  const quantityOwned = inventoryQuantityOwned(item);
  const costBasis = inventoryOwnedCostBasis(item);
  const computed = inventoryMarketRecommendation(
    {
      category: item.category,
      itemStatus: item.itemStatus,
      cost: item.cost,
      quantity: item.quantity,
      quantityOwned,
      costBasis,
      totalCost: item.totalCost,
      purchaseExtraCost: item.purchaseExtraCost,
      currentMarketEstimate,
      soldPrice: item.soldPrice,
      estimatedEbayFee: item.estimatedEbayFee,
      estimatedShippingCost: item.estimatedShippingCost,
      marketCompCount: compCount,
      marketConfidence: confidence,
      product: item.product,
      card: item.card
    },
    settings
  );
  const updated = await prisma.inventoryItem.update({
    where: { id: itemId },
    data: {
      totalCost: item.totalCost ?? item.cost * item.quantity + (item.purchaseExtraCost ?? 0),
      currentMarketEstimate,
      marketAverageSalePrice: compCount ? compStats.average : null,
      marketCompCount: compCount,
      marketLastRefreshedAt: latestCompEnteredAt,
      marketConfidence: confidence,
      ...computed
    },
    include: inventoryItemInclude
  });
  return inventoryItemToDTO(updated);
}

async function syncInventoryItemTotalsFromLots(itemId: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: { stockLots: true }
  });
  if (!item) throw new Error("Inventory item not found");

  const quantity = item.stockLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const totalCost = item.stockLots.reduce((sum, lot) => sum + lot.totalCost, 0);
  const unitCostTotal = item.stockLots.reduce((sum, lot) => sum + inventoryLotUnitCost(item, lot) * lot.quantity, 0);
  const purchaseExtraCost = item.stockLots.reduce((sum, lot) => sum + (lot.purchaseExtraCost ?? 0), 0);
  const latestLot = [...item.stockLots].sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime())[0];

  await prisma.inventoryItem.update({
    where: { id: itemId },
    data: {
      quantity,
      totalCost,
      cost: quantity > 0 ? unitCostTotal / quantity : 0,
      purchaseExtraCost,
      source: latestLot?.source ?? item.source,
      purchasedAt: latestLot?.purchasedAt ?? item.purchasedAt,
      receiptNumber: latestLot?.receiptNumber ?? item.receiptNumber,
      receiptImageUrl: latestLot?.receiptImageUrl ?? item.receiptImageUrl,
      orderNumber: latestLot?.orderNumber ?? item.orderNumber,
      transactionId: latestLot?.transactionId ?? item.transactionId,
      sourceStore: latestLot?.sourceStore ?? item.sourceStore,
      paymentMethod: latestLot?.paymentMethod ?? item.paymentMethod
    }
  });
}

function purchaseCostFromMsrp(cost: number, msrp?: number | null) {
  return cost > 0 ? cost : msrp && msrp > 0 ? msrp : cost;
}

async function backfillMissingMsrpInventoryCosts(currentUser: SessionUser) {
  const candidates = await prisma.inventoryItem.findMany({
    where: {
      userId: currentUser.id,
      msrp: { gt: 0 },
      cost: { lte: 0 },
      OR: [{ totalCost: null }, { totalCost: { lte: 0 } }],
      sales: { none: {} }
    },
    include: { stockLots: true }
  });

  for (const item of candidates) {
    const msrp = item.msrp;
    if (!msrp || msrp <= 0) continue;
    const hasLotCost = item.stockLots.some((lot) => lot.costPerUnit > 0 || lot.totalCost > 0);
    if (hasLotCost) continue;
    const totalCost = msrp * item.quantity + (item.purchaseExtraCost ?? 0);
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        cost: msrp,
        totalCost
      }
    });
    for (const lot of item.stockLots) {
      await prisma.inventoryStockLot.update({
        where: { id: lot.id },
        data: {
          costPerUnit: msrp,
          totalCost: msrp * lot.quantity + (lot.purchaseExtraCost ?? 0)
        }
      });
    }
  }
}

export async function createInventoryItem(
  currentUser: SessionUser,
  input: {
    itemType: string;
    itemName: string;
    category?: string;
    setName?: string;
    productId?: string;
    cardId?: string;
    existingInventoryItemId?: string;
    cost: number;
    quantity: number;
    totalCost?: number;
    purchaseExtraCost?: number;
    source: string;
    retailer?: string;
    brand?: string;
    description?: string;
    manufacturer?: string;
    model?: string;
    msrp?: number;
    purchasedAt: Date;
    receiptNumber?: string;
    receiptImageUrl?: string;
    orderNumber?: string;
    transactionId?: string;
    sourceStore?: string;
    paymentMethod?: string;
    exactProductUrl?: string;
    upc?: string;
    sku?: string;
    dpci?: string;
    asin?: string;
    imageUrl?: string;
    condition?: string;
    itemStatus?: string;
    targetSellPrice?: number;
    minimumAcceptablePrice?: number;
    listingPlatform?: string;
    listingStatus?: string;
    soldPrice?: number;
    soldAt?: Date;
    buyerPlatform?: string;
    currentMarketEstimate?: number;
    estimatedEbayFee?: number;
    estimatedShippingCost?: number;
    expectedPlan?: string;
    notes?: string;
  }
) {
  if (input.existingInventoryItemId) {
    return addInventoryStockLot(currentUser, input.existingInventoryItemId, input);
  }
  const normalizedInput = input.upc ? { ...input, upc: normalizeUPC(input.upc) } : input;
  if (normalizedInput.upc) {
    const existingByUpc = await prisma.inventoryItem.findFirst({
      where: { upc: normalizedInput.upc, OR: [{ userId: null }, { userId: currentUser.id }] },
      select: { id: true }
    });
    if (existingByUpc) return addInventoryStockLot(currentUser, existingByUpc.id, normalizedInput);
  }
  const linkedProduct = normalizedInput.productId
    ? await prisma.product.findUnique({ where: { id: normalizedInput.productId }, include: { retailer: { select: { name: true } }, release: { select: { setName: true } } } })
    : null;
  const linkedInput = linkedProduct ? { ...normalizedInput, ...withoutUndefined(productSyncData(linkedProduct)) } : normalizedInput;
  const settings = await ensureInvestmentSettings(currentUser);
  const purchaseCost = purchaseCostFromMsrp(linkedInput.cost, linkedInput.msrp);
  const totalCost =
    linkedInput.totalCost && linkedInput.totalCost > 0
      ? linkedInput.totalCost
      : purchaseCost * linkedInput.quantity + (linkedInput.purchaseExtraCost ?? 0);
  const computed = inventoryMarketRecommendation(
    { ...linkedInput, cost: purchaseCost, totalCost, quantityOwned: linkedInput.quantity, costBasis: totalCost, marketCompCount: 0, marketConfidence: "NONE" },
    settings
  );
  const item = await prisma.inventoryItem.create({
    data: {
      userId: currentUser.id,
      itemType: linkedInput.itemType,
      itemName: linkedInput.itemName,
      category: linkedInput.category || "sealed_packs",
      setName: linkedInput.setName,
      productId: linkedInput.productId,
      cardId: linkedInput.cardId,
      cost: purchaseCost,
      quantity: linkedInput.quantity,
      totalCost,
      purchaseExtraCost: linkedInput.purchaseExtraCost,
      source: linkedInput.source,
      retailer: linkedInput.retailer,
      brand: linkedInput.brand,
      description: linkedInput.description,
      manufacturer: linkedInput.manufacturer,
      model: linkedInput.model,
      msrp: linkedInput.msrp,
      purchasedAt: linkedInput.purchasedAt,
      receiptNumber: linkedInput.receiptNumber,
      receiptImageUrl: linkedInput.receiptImageUrl,
      orderNumber: linkedInput.orderNumber,
      transactionId: linkedInput.transactionId,
      sourceStore: linkedInput.sourceStore,
      paymentMethod: linkedInput.paymentMethod,
      exactProductUrl: linkedInput.exactProductUrl,
      upc: linkedInput.upc,
      sku: linkedInput.sku,
      dpci: linkedInput.dpci,
      asin: linkedInput.asin,
      imageUrl: linkedInput.imageUrl,
      condition: linkedInput.condition,
      itemStatus: linkedInput.itemStatus || "sealed",
      targetSellPrice: linkedInput.targetSellPrice,
      minimumAcceptablePrice: linkedInput.minimumAcceptablePrice,
      listingPlatform: linkedInput.listingPlatform,
      listingStatus: linkedInput.listingStatus || "not_listed",
      soldPrice: linkedInput.soldPrice,
      soldAt: linkedInput.soldAt,
      buyerPlatform: linkedInput.buyerPlatform,
      currentMarketEstimate: linkedInput.currentMarketEstimate,
      marketAverageSalePrice: null,
      marketCompCount: 0,
      marketLastRefreshedAt: null,
      marketConfidence: "NONE",
      estimatedEbayFee: computed.estimatedEbayFee,
      estimatedShippingCost: computed.estimatedShippingCost,
      estimatedNetProfit: computed.estimatedNetProfit,
      roiPercent: computed.roiPercent,
      recommendedAction: computed.recommendedAction,
      recommendationReason: computed.recommendationReason,
      netProfitAfterFees: computed.netProfitAfterFees,
      expectedPlan: linkedInput.expectedPlan,
      notes: linkedInput.notes
    },
    include: inventoryItemInclude
  });
  await prisma.inventoryStockLot.create({
    data: {
      inventoryItemId: item.id,
      purchasedAt: linkedInput.purchasedAt,
      source: linkedInput.source,
      quantity: linkedInput.quantity,
      costPerUnit: purchaseCost,
      purchaseExtraCost: linkedInput.purchaseExtraCost,
      totalCost,
      remainingQuantity: linkedInput.quantity,
      notes: linkedInput.notes,
      receiptNumber: linkedInput.receiptNumber,
      receiptImageUrl: linkedInput.receiptImageUrl,
      orderNumber: linkedInput.orderNumber,
      transactionId: linkedInput.transactionId,
      sourceStore: linkedInput.sourceStore,
      paymentMethod: linkedInput.paymentMethod
    }
  });
  return recomputeInventoryItem(item.id, currentUser);
}

export async function addInventoryStockLot(
  currentUser: SessionUser,
  itemId: string,
  input: {
    cost: number;
    quantity: number;
    totalCost?: number;
    purchaseExtraCost?: number;
    source: string;
    purchasedAt: Date;
    receiptNumber?: string;
    receiptImageUrl?: string;
    orderNumber?: string;
    transactionId?: string;
    sourceStore?: string;
    paymentMethod?: string;
    notes?: string;
    imageUrl?: string;
    targetSellPrice?: number;
    currentMarketEstimate?: number;
    msrp?: number;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude
  });
  if (!item) throw new Error("Inventory item not found");
  const unitCost = purchaseCostFromMsrp(input.cost, input.msrp ?? item.msrp);
  const lotTotal = input.totalCost && input.totalCost > 0 ? input.totalCost : unitCost * input.quantity + (input.purchaseExtraCost ?? 0);
  await prisma.inventoryStockLot.create({
    data: {
      inventoryItemId: item.id,
      purchasedAt: input.purchasedAt,
      source: input.source,
      quantity: input.quantity,
      costPerUnit: unitCost,
      purchaseExtraCost: input.purchaseExtraCost,
      totalCost: lotTotal,
      remainingQuantity: input.quantity,
      notes: input.notes,
      receiptNumber: input.receiptNumber,
      receiptImageUrl: input.receiptImageUrl,
      orderNumber: input.orderNumber,
      transactionId: input.transactionId,
      sourceStore: input.sourceStore,
      paymentMethod: input.paymentMethod
    }
  });
  const nextQuantity = item.quantity + input.quantity;
  const nextTotalCost = (item.totalCost ?? item.cost * item.quantity) + lotTotal;
  const existingUnitCostTotal = item.stockLots.length
    ? item.stockLots.reduce((sum, lot) => sum + inventoryLotUnitCost(item, lot) * lot.quantity, 0)
    : item.cost * item.quantity;
  const nextAverageUnitCost = nextQuantity > 0 ? (existingUnitCostTotal + unitCost * input.quantity) / nextQuantity : item.cost;
  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      quantity: nextQuantity,
      totalCost: nextTotalCost,
      cost: nextAverageUnitCost,
      purchaseExtraCost: (item.purchaseExtraCost ?? 0) + (input.purchaseExtraCost ?? 0),
      source: input.source,
      purchasedAt: input.purchasedAt,
      receiptNumber: input.receiptNumber ?? item.receiptNumber,
      receiptImageUrl: input.receiptImageUrl ?? item.receiptImageUrl,
      orderNumber: input.orderNumber ?? item.orderNumber,
      transactionId: input.transactionId ?? item.transactionId,
      sourceStore: input.sourceStore ?? item.sourceStore,
      paymentMethod: input.paymentMethod ?? item.paymentMethod,
      imageUrl: input.imageUrl ?? item.imageUrl,
      targetSellPrice: input.targetSellPrice ?? item.targetSellPrice,
      currentMarketEstimate: input.currentMarketEstimate ?? item.currentMarketEstimate
    }
  });
  return recomputeInventoryItem(item.id, currentUser);
}

export async function updateInventoryStockLot(
  currentUser: SessionUser,
  itemId: string,
  lotId: string,
  input: {
    quantity: number;
    costPerUnit: number;
    purchaseExtraCost?: number;
    totalCost?: number;
    source: string;
    purchasedAt: Date;
    receiptNumber?: string;
    receiptImageUrl?: string;
    orderNumber?: string;
    transactionId?: string;
    sourceStore?: string;
    paymentMethod?: string;
    notes?: string;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: { stockLots: true }
  });
  if (!item) throw new Error("Inventory item not found");
  const lot = item.stockLots.find((stockLot) => stockLot.id === lotId);
  if (!lot) throw new Error("Stock lot not found");

  const soldFromLot = Math.max(0, lot.quantity - lot.remainingQuantity);
  if (input.quantity < soldFromLot) {
    throw new Error(`This lot already has ${soldFromLot} sold. Quantity cannot be below sold quantity.`);
  }

  const nextTotalCost = input.totalCost ?? input.costPerUnit * input.quantity + (input.purchaseExtraCost ?? 0);
  await prisma.inventoryStockLot.update({
    where: { id: lot.id },
    data: {
      purchasedAt: input.purchasedAt,
      source: input.source,
      quantity: input.quantity,
      costPerUnit: input.costPerUnit,
      purchaseExtraCost: input.purchaseExtraCost,
      totalCost: nextTotalCost,
      remainingQuantity: input.quantity - soldFromLot,
      notes: input.notes,
      receiptNumber: input.receiptNumber,
      receiptImageUrl: input.receiptImageUrl,
      orderNumber: input.orderNumber,
      transactionId: input.transactionId,
      sourceStore: input.sourceStore,
      paymentMethod: input.paymentMethod
    }
  });
  await syncInventoryItemTotalsFromLots(item.id);
  return recomputeInventoryItem(item.id, currentUser);
}

export async function deleteInventoryStockLot(currentUser: SessionUser, itemId: string, lotId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: { stockLots: true }
  });
  if (!item) throw new Error("Inventory item not found");
  const lot = item.stockLots.find((stockLot) => stockLot.id === lotId);
  if (!lot) throw new Error("Stock lot not found");
  if (lot.remainingQuantity !== lot.quantity) {
    throw new Error("This stock lot has recorded sales. Edit the lot instead of removing it.");
  }

  await prisma.inventoryStockLot.delete({ where: { id: lot.id } });
  await syncInventoryItemTotalsFromLots(item.id);
  return recomputeInventoryItem(item.id, currentUser);
}

export async function logProductPurchase(
  currentUser: SessionUser,
  productId: string,
  input: {
    cost?: number;
    quantity: number;
    source?: string;
    expectedPlan?: string;
    notes?: string;
  }
) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: productInclude });
  if (!product) throw new Error("Product not found");
  return createInventoryItem(currentUser, {
    itemType: "product",
    itemName: product.name,
    category: inventoryCategoryFromProductType(product.productType),
    setName: product.setName ?? product.release?.setName ?? undefined,
    productId: product.id,
    cost: input.cost ?? product.retailPrice ?? 0,
    quantity: input.quantity,
    source: input.source || product.retailer.name,
    retailer: product.retailer.name,
    exactProductUrl: product.verifiedFinalUrl || product.url,
    upc: product.upc ?? undefined,
    sku: product.sku ?? undefined,
    dpci: product.dpci ?? undefined,
    imageUrl: product.liveImageUrl ?? product.imageUrl ?? undefined,
    itemStatus: "sealed",
    purchasedAt: new Date(),
    expectedPlan: input.expectedPlan || "Hold sealed, review comps before resale.",
    notes: input.notes
  });
}

export async function updateInventoryItem(
  currentUser: SessionUser,
  itemId: string,
  input: Partial<Parameters<typeof createInventoryItem>[1]>
) {
  const existing = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude
  });
  if (!existing) throw new Error("Inventory item not found");
  const linkedProduct = input.productId
    ? await prisma.product.findUnique({ where: { id: input.productId }, include: { retailer: { select: { name: true } }, release: { select: { setName: true } } } })
    : null;
  const productData = linkedProduct ? withoutUndefined(productSyncData(linkedProduct)) : {};
  const effectiveMsrp = input.msrp ?? existing.msrp;
  const existingTotalCost = existing.totalCost ?? existing.cost * existing.quantity + (existing.purchaseExtraCost ?? 0);
  const hasRecordedCostBasis =
    existingTotalCost > 0 ||
    existing.cost > 0 ||
    existing.stockLots.some((lot) => lot.costPerUnit > 0 || lot.totalCost > 0);
  const shouldBackfillMsrpCost =
    input.msrp !== undefined &&
    effectiveMsrp !== undefined &&
    effectiveMsrp !== null &&
    effectiveMsrp > 0 &&
    existing.quantity > 0 &&
    !hasRecordedCostBasis &&
    existing.sales.length === 0;
  const nextCost =
    input.cost !== undefined
      ? input.cost
      : shouldBackfillMsrpCost
        ? effectiveMsrp
        : undefined;
  const nextTotalCost =
    input.cost !== undefined || input.quantity !== undefined || input.purchaseExtraCost !== undefined
      ? (input.cost ?? existing.cost) * (input.quantity ?? existing.quantity) + (input.purchaseExtraCost ?? existing.purchaseExtraCost ?? 0)
      : shouldBackfillMsrpCost
        ? effectiveMsrp * existing.quantity + (existing.purchaseExtraCost ?? 0)
        : undefined;
  await prisma.inventoryItem.update({
    where: { id: itemId },
    data: {
      itemType: input.itemType,
      itemName: input.itemName,
      category: input.category,
      setName: input.setName,
      productId: input.productId,
      cardId: input.cardId,
      cost: nextCost,
      quantity: input.quantity,
      totalCost: nextTotalCost,
      purchaseExtraCost: input.purchaseExtraCost,
      source: input.source,
      retailer: input.retailer,
      brand: input.brand,
      description: input.description,
      manufacturer: input.manufacturer,
      model: input.model,
      msrp: input.msrp,
      purchasedAt: input.purchasedAt,
      receiptNumber: input.receiptNumber,
      receiptImageUrl: input.receiptImageUrl,
      orderNumber: input.orderNumber,
      transactionId: input.transactionId,
      sourceStore: input.sourceStore,
      paymentMethod: input.paymentMethod,
      exactProductUrl: input.exactProductUrl,
      upc: input.upc,
      sku: input.sku,
      dpci: input.dpci,
      asin: input.asin,
      imageUrl: input.imageUrl,
      condition: input.condition,
      itemStatus: input.itemStatus,
      targetSellPrice: input.targetSellPrice,
      minimumAcceptablePrice: input.minimumAcceptablePrice,
      listingPlatform: input.listingPlatform,
      listingStatus: input.listingStatus,
      soldPrice: input.soldPrice,
      soldAt: input.soldAt,
      buyerPlatform: input.buyerPlatform,
      currentMarketEstimate: input.currentMarketEstimate,
      estimatedEbayFee: input.estimatedEbayFee,
      estimatedShippingCost: input.estimatedShippingCost,
      expectedPlan: input.expectedPlan,
      notes: input.notes,
      ...productData
    }
  });
  if (shouldBackfillMsrpCost) {
    for (const lot of existing.stockLots) {
      if (lot.costPerUnit > 0 || lot.totalCost > 0) continue;
      await prisma.inventoryStockLot.update({
        where: { id: lot.id },
        data: {
          costPerUnit: effectiveMsrp,
          totalCost: effectiveMsrp * lot.quantity + (lot.purchaseExtraCost ?? 0)
        }
      });
    }
  }
  return recomputeInventoryItem(itemId, currentUser);
}

export async function createInventoryMarketComp(
  currentUser: SessionUser,
  input: {
    inventoryItemId: string;
    saleTitle: string;
    salePrice: number;
    soldAt: Date;
    sourceUrl?: string;
    sourceQuality: string;
    matchScore: number;
    notes?: string;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    select: { id: true }
  });
  if (!item) throw new Error("Inventory item not found");
  await prisma.inventoryMarketComp.create({
    data: {
      inventoryItemId: input.inventoryItemId,
      saleTitle: input.saleTitle,
      salePrice: input.salePrice,
      soldAt: input.soldAt,
      sourceUrl: input.sourceUrl,
      sourceQuality: input.sourceQuality,
      matchScore: input.matchScore,
      notes: input.notes
    }
  });
  return recomputeInventoryItem(input.inventoryItemId, currentUser);
}

export async function createInventorySale(
  currentUser: SessionUser,
  itemId: string,
  input: {
    quantitySold: number;
    soldPricePerItem: number;
    platform: string;
    fees?: number;
    shippingCost?: number;
    soldAt: Date;
    notes?: string;
  }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude
  });
  if (!item) throw new Error("Inventory item not found");
  const soldSoFar = item.sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
  const lotRemaining = item.stockLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  const quantityOwned = item.stockLots.length ? lotRemaining : Math.max(0, item.quantity - soldSoFar);
  if (input.quantitySold > quantityOwned) {
    throw new Error(`Only ${quantityOwned} available to sell.`);
  }
  const averageCost = inventoryEffectiveAverageCost(item);
  const grossSale = input.quantitySold * input.soldPricePerItem;
  const fees = input.fees ?? 0;
  const shippingCost = input.shippingCost ?? 0;
  const netSale = grossSale - fees - shippingCost;
  let remainingToAllocate = input.quantitySold;
  let costBasis = 0;
  const lotsToUpdate = [...item.stockLots]
    .filter((lot) => lot.remainingQuantity > 0)
    .sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
  for (const lot of lotsToUpdate) {
    if (remainingToAllocate <= 0) break;
    const quantityFromLot = Math.min(remainingToAllocate, lot.remainingQuantity);
    const lotUnitCost = inventoryLotUnitCost(item, lot) || averageCost;
    costBasis += quantityFromLot * lotUnitCost;
    remainingToAllocate -= quantityFromLot;
  }
  if (remainingToAllocate > 0) costBasis += remainingToAllocate * averageCost;
  const profitLoss = netSale - costBasis;
  const roiPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : null;
  const sale = await prisma.inventorySale.create({
    data: {
      inventoryItemId: item.id,
      userId: currentUser.id,
      quantitySold: input.quantitySold,
      soldPricePerItem: input.soldPricePerItem,
      grossSale,
      platform: input.platform,
      fees,
      shippingCost,
      netSale,
      costBasis,
      profitLoss,
      roiPercent,
      soldAt: input.soldAt,
      notes: input.notes
    }
  });
  let quantityToDeduct = input.quantitySold;
  for (const lot of lotsToUpdate) {
    if (quantityToDeduct <= 0) break;
    const quantityFromLot = Math.min(quantityToDeduct, lot.remainingQuantity);
    quantityToDeduct -= quantityFromLot;
    await prisma.inventoryStockLot.update({
      where: { id: lot.id },
      data: { remainingQuantity: lot.remainingQuantity - quantityFromLot }
    });
  }
  const totalSold = soldSoFar + input.quantitySold;
  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      listingStatus: totalSold >= item.quantity ? "sold" : item.listingStatus === "not_listed" ? "held" : item.listingStatus,
      soldPrice: input.soldPricePerItem,
      soldAt: input.soldAt,
      buyerPlatform: input.platform,
      netProfitAfterFees: item.sales.reduce((sum, existingSale) => sum + existingSale.profitLoss, 0) + sale.profitLoss
    }
  });
  return recomputeInventoryItem(item.id, currentUser);
}

export async function refreshInventoryEbayComps(currentUser: SessionUser, itemId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, OR: [{ userId: null }, { userId: currentUser.id }] },
    include: inventoryItemInclude
  });
  if (!item) throw new Error("Inventory item not found");
  const result = await fetchLastThreeInventoryEbayComps({
    itemName: item.itemName,
    setName: item.setName,
    category: item.category,
    upc: item.upc,
    sku: item.sku || item.asin
  });
  if (result.mode === "manual") {
    return { mode: result.mode, message: result.message, item: inventoryItemToDTO(item) };
  }
  await prisma.inventoryMarketComp.deleteMany({ where: { inventoryItemId: item.id, sourceQuality: "EBAY_SOLD" } });
  await prisma.inventoryMarketComp.createMany({
    data: result.sales.map((sale) => ({
      inventoryItemId: item.id,
      saleTitle: sale.saleTitle,
      salePrice: sale.salePrice,
      soldAt: sale.soldAt,
      sourceUrl: sale.sourceUrl,
      sourceQuality: "EBAY_SOLD",
      matchScore: sale.matchScore,
      notes: sale.notes
    }))
  });
  const updated = await recomputeInventoryItem(item.id, currentUser);
  return { mode: result.mode, message: result.message, item: updated };
}

export async function refreshAllInventoryMarketComps(currentUser: SessionUser) {
  const items = await prisma.inventoryItem.findMany({
    where: { OR: [{ userId: null }, { userId: currentUser.id }] },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 50
  });
  const refreshed: InventoryItemDTO[] = [];
  let manualMode = false;
  for (const item of items) {
    const result = await refreshInventoryEbayComps(currentUser, item.id);
    if (result.mode === "manual") manualMode = true;
    refreshed.push(result.item);
    if (result.mode === "manual") break;
  }
  return {
    mode: manualMode ? "manual" : ebayMode(),
    refreshedCount: refreshed.length,
    message: manualMode
      ? "Manual comp mode is active. Add manual comps or configure eBay credentials."
      : `${refreshed.length} inventory product${refreshed.length === 1 ? "" : "s"} refreshed from eBay sold comps.`,
    items: refreshed
  };
}

export async function controlProductMonitor(
  productId: string,
  input: {
    action: "pause" | "resume" | "force_alert" | "mark_false_positive";
    monitorLogId?: string;
    reason?: string;
  }
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { retailer: { select: { name: true } } }
  });
  if (!product) throw new Error("Product not found");

  const now = new Date();
  if (input.action === "pause" || input.action === "resume") {
    const enabled = input.action === "resume";
    await prisma.product.update({
      where: { id: productId },
      data: {
        monitorEnabled: enabled,
        lastMonitorResult: enabled ? "Monitor resumed by admin." : "Monitor paused by admin.",
        nextCheckAt: enabled ? new Date(Date.now() + product.checkFrequencyMinutes * 60 * 1000) : product.nextCheckAt
      }
    });
    await prisma.monitorLog.create({
      data: {
        productId,
        runType: "MANUAL_PRODUCT",
        status: "SKIPPED",
        previousStatus: product.stockStatus,
        detectedStatus: product.stockStatus,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        changeSummary: enabled ? "Admin resumed product monitor." : "Admin paused product monitor.",
        reason: input.reason
      }
    });
    return { ok: true, action: input.action };
  }

  if (input.action === "force_alert") {
    if (!productReadyForBuyAlerts(product)) {
      await prisma.monitorLog.create({
        data: {
          productId,
          runType: "MANUAL_PRODUCT",
          status: "SKIPPED",
          previousStatus: product.stockStatus,
          detectedStatus: product.verificationStatus,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          changeSummary: "Forced alert blocked because this is not a verified exact product.",
          reason: "Click Verify Exact Product and add UPC/SKU/DPCI/TCIN before sending Buy alerts.",
          alertSent: false
        }
      });
      throw new Error("Forced alert blocked: verify the exact product link and identifiers before sending Buy alerts.");
    }
    const actionUrl = exactProductActionUrl(product);
    const delivery = await deliverAlert({
      title: `Forced alert: ${product.name}`,
      reason:
        input.reason ||
        `Admin forced a manual alert for ${product.name}. Go opens only the official ${product.retailer.name} page.`,
      priority: product.priority as Priority,
      entityType: "PRODUCT",
      entityId: product.id,
      productId: product.id,
      actionUrl: actionUrl ?? undefined
    });
    const summary = notificationSummary(delivery);
    const alertSent = delivery.inAppCreated + delivery.emailSent + delivery.smsSent + delivery.pushSent > 0;
    await prisma.product.update({
      where: { id: productId },
      data: {
        lastAlertSentAt: alertSent ? now : product.lastAlertSentAt,
        lastMonitorResult: "Admin forced a manual alert."
      }
    });
    const log = await prisma.monitorLog.create({
      data: {
        productId,
        runType: "MANUAL_PRODUCT",
        status: "FORCED_ALERT",
        previousStatus: product.stockStatus,
        detectedStatus: product.stockStatus,
        previousPrice: product.retailPrice,
        detectedPrice: product.retailPrice,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        changeSummary: input.reason || "Admin forced a product alert.",
        finalUrl: actionUrl || product.verifiedFinalUrl || product.url,
        alertSent,
        notificationSummary: summary
      }
    });
    return { ok: true, action: input.action, alertSent, logId: log.id };
  }

  if (input.monitorLogId) {
    await prisma.monitorLog.updateMany({
      where: { id: input.monitorLogId, productId },
      data: {
        status: "FALSE_POSITIVE",
        changeSummary: input.reason || "Admin marked this monitor result as a false positive.",
        reason: input.reason || "False positive marked by admin.",
        alertSent: false
      }
    });
  }

  const log = await prisma.monitorLog.create({
    data: {
      productId,
      runType: "MANUAL_PRODUCT",
      status: "FALSE_POSITIVE",
      previousStatus: product.stockStatus,
      detectedStatus: product.stockStatus,
      previousPrice: product.retailPrice,
      detectedPrice: product.retailPrice,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      changeSummary: input.reason || "Admin marked a product monitor result as a false positive.",
      reason: input.reason || "False positive marked by admin.",
      alertSent: false
    }
  });
  await prisma.product.update({
    where: { id: productId },
    data: {
      alertStatus: false,
      lastMonitorResult: "Marked false positive by admin.",
      pendingAlertStatus: null,
      pendingAlertPrice: null,
      pendingAlertPageHash: null,
      pendingAlertCount: 0,
      pendingAlertReason: null,
      pendingAlertConfidence: null,
      pendingAlertDetectedWords: null,
      pendingAlertAt: null
    }
  });
  return { ok: true, action: input.action, logId: log.id };
}

export async function createStore(input: {
  retailerId: string;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zone?: Zone;
  latitude?: number;
  longitude?: number;
  typicalRestockDays: string;
  typicalRestockTimeWindow: string;
  vendorNotes?: string;
  confidenceScore: number;
  notes?: string;
}) {
  await assertStoreIsNotDuplicate(input);
  const store = await prisma.store.create({
    data: input,
    include: storeInclude
  });
  return storeToDTO(store);
}

export async function updateStore(
  storeId: string,
  input: {
    retailerId: string;
    storeName: string;
    address: string;
    city: string;
    state: string;
    zone?: Zone;
    latitude?: number;
    longitude?: number;
    typicalRestockDays: string;
    typicalRestockTimeWindow: string;
    vendorNotes?: string;
    confidenceScore: number;
    notes?: string;
  }
) {
  await assertStoreIsNotDuplicate(input, storeId);
  const store = await prisma.store.update({
    where: { id: storeId },
    data: input,
    include: storeInclude
  });
  return storeToDTO(store);
}

export async function deleteStore(storeId: string) {
  await prisma.alert.deleteMany({ where: { entityType: "STORE", entityId: storeId } });
  await prisma.store.delete({ where: { id: storeId } });
  return { ok: true };
}

function normalizedStoreKey(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function googlePlaceIdFromText(value: string | null | undefined) {
  return /(?:google\s*)?place[_\s-]?id:\s*([A-Za-z0-9_-]+)/i.exec(value || "")?.[1] ?? null;
}

async function assertStoreIsNotDuplicate(
  input: {
    retailerId: string;
    storeName: string;
    address: string;
    city: string;
    notes?: string;
    vendorNotes?: string;
  },
  excludeStoreId?: string
) {
  const existingStores = await prisma.store.findMany({
    where: { retailerId: input.retailerId },
    select: { id: true, storeName: true, address: true, city: true, notes: true, vendorNotes: true }
  });
  const addressKey = normalizedStoreKey(input.address);
  const nameCityKey = `${normalizedStoreKey(input.storeName)}|${normalizedStoreKey(input.city)}`;
  const placeId = googlePlaceIdFromText(`${input.notes || ""}\n${input.vendorNotes || ""}`);

  for (const store of existingStores) {
    if (store.id === excludeStoreId) continue;
    if (placeId && googlePlaceIdFromText(`${store.notes || ""}\n${store.vendorNotes || ""}`) === placeId) {
      throw new Error(`Duplicate store: ${store.storeName} already uses Google place_id ${placeId}.`);
    }
    if (normalizedStoreKey(store.address) === addressKey) {
      throw new Error(`Duplicate store: ${store.storeName} already uses this retailer/address.`);
    }
    if (`${normalizedStoreKey(store.storeName)}|${normalizedStoreKey(store.city)}` === nameCityKey) {
      throw new Error(`Duplicate store: ${store.storeName} already exists in ${store.city}.`);
    }
  }
}

export async function createSighting(userId: string, input: {
  storeId: string;
  productSeen: string;
  resultType: StoreVisitResult;
  seenAt: Date;
  quantityEstimate: string;
  shelfPhotoUrl?: string;
  notes?: string;
}) {
  const sighting = await prisma.storeSighting.create({
    data: {
      ...input,
      userId
    },
    include: {
      store: { select: { storeName: true } },
      user: { select: { name: true } }
    }
  });

  const store = await prisma.store.findUnique({ where: { id: input.storeId } });
  if (store) {
    await prisma.alert.create({
      data: {
        title: `${store.storeName} field result logged`,
        reason: `${input.productSeen} logged as ${input.resultType.replaceAll("_", " ")} with quantity ${input.quantityEstimate}.`,
        priority: store.confidenceScore >= 70 ? "HIGH" : "MEDIUM",
        entityType: "STORE",
        entityId: store.id
      }
    });
  }

  return sightingToDTO(sighting);
}

export async function updateSighting(
  currentUser: SessionUser,
  sightingId: string,
  input: {
    storeId?: string;
    productSeen: string;
    resultType: StoreVisitResult;
    seenAt: Date;
    quantityEstimate: string;
    shelfPhotoUrl?: string;
    notes?: string;
  }
) {
  const existing = await prisma.storeSighting.findUnique({ where: { id: sightingId } });
  if (!existing) throw new Error("Sighting not found");
  if (currentUser.role !== "ADMIN" && existing.userId !== currentUser.id) {
    throw new Error("You can only edit your own sightings");
  }

  const sighting = await prisma.storeSighting.update({
    where: { id: sightingId },
    data: {
      storeId: input.storeId ?? existing.storeId,
      productSeen: input.productSeen,
      resultType: input.resultType,
      seenAt: input.seenAt,
      quantityEstimate: input.quantityEstimate,
      shelfPhotoUrl: input.shelfPhotoUrl,
      notes: input.notes
    },
    include: {
      store: { select: { storeName: true } },
      user: { select: { name: true } }
    }
  });

  return sightingToDTO(sighting);
}

export async function deleteSighting(currentUser: SessionUser, sightingId: string) {
  const existing = await prisma.storeSighting.findUnique({ where: { id: sightingId } });
  if (!existing) throw new Error("Sighting not found");
  if (currentUser.role !== "ADMIN" && existing.userId !== currentUser.id) {
    throw new Error("You can only delete your own sightings");
  }
  await prisma.storeSighting.delete({ where: { id: sightingId } });
  return { ok: true };
}

export async function createRelease(input: {
  setName: string;
  productType?: string;
  officialReleaseDate: Date;
  preorderDate?: Date | null;
  productTypes: string;
  pokemonCenterExclusiveVersion: boolean;
  chaseCards?: string;
  demandRating: Priority;
  estimatedDemand: Priority;
  priority: Priority;
  sealedProductPriority: Priority;
  notes?: string;
  productLinks?: string;
}) {
  const release = await prisma.release.create({ data: input });
  return releaseToDTO(release);
}

export async function updateRelease(
  releaseId: string,
  input: {
    setName: string;
    productType?: string;
    officialReleaseDate: Date;
    preorderDate?: Date | null;
    productTypes: string;
    pokemonCenterExclusiveVersion: boolean;
    chaseCards?: string;
    demandRating: Priority;
    estimatedDemand: Priority;
    priority: Priority;
    sealedProductPriority: Priority;
    notes?: string;
    productLinks?: string;
  }
) {
  const release = await prisma.release.update({ where: { id: releaseId }, data: input });
  return releaseToDTO(release);
}

export async function deleteRelease(releaseId: string) {
  await prisma.alert.deleteMany({ where: { entityType: "RELEASE", entityId: releaseId } });
  await prisma.release.delete({ where: { id: releaseId } });
  return { ok: true };
}

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])) as Record<string, unknown>
  );
}

function parseImportRows(format: "csv" | "json", data: string, collectionKey: string) {
  if (format === "csv") return parseCsvRows(data);
  const parsed = JSON.parse(data) as unknown;
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (
    parsed &&
    typeof parsed === "object" &&
    collectionKey in parsed &&
    Array.isArray((parsed as Record<string, unknown>)[collectionKey])
  ) {
    return (parsed as Record<string, unknown>)[collectionKey] as Record<string, unknown>[];
  }
  throw new Error(`JSON import must be an array or an object with a ${collectionKey} array.`);
}

function textFromRow(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim().length > 0) return String(value).trim();
  }
  return undefined;
}

function numberFromRow(row: Record<string, unknown>, ...keys: string[]) {
  const value = textFromRow(row, ...keys);
  return value === undefined ? undefined : Number(value);
}

function boolFromRow(row: Record<string, unknown>, ...keys: string[]) {
  const value = textFromRow(row, ...keys);
  if (value === undefined) return undefined;
  return ["true", "1", "yes", "y", "on"].includes(value.toLowerCase());
}

async function retailerIdFromRow(row: Record<string, unknown>, retailers: Array<{ id: string; name: string }>) {
  const retailerId = textFromRow(row, "retailerId");
  if (retailerId && retailers.some((retailer) => retailer.id === retailerId)) return retailerId;
  const retailerName = textFromRow(row, "retailer", "retailerName");
  const retailer = retailers.find((item) => item.name.toLowerCase() === retailerName?.toLowerCase());
  if (!retailer) throw new Error(`Retailer not found: ${retailerName || retailerId || "missing"}`);
  return retailer.id;
}

async function releaseIdFromRow(row: Record<string, unknown>) {
  const releaseId = textFromRow(row, "releaseId");
  if (releaseId) return releaseId;
  const releaseSetName = textFromRow(row, "releaseSetName", "release", "linkedRelease");
  if (!releaseSetName) return undefined;
  const release = await prisma.release.findFirst({
    where: { setName: releaseSetName },
    select: { id: true }
  });
  return release?.id;
}

export async function importProducts(format: "csv" | "json", data: string) {
  const rows = parseImportRows(format, data, "products");
  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const result = { ok: true, created: 0, failed: 0, errors: [] as string[] };

  for (const [index, row] of rows.entries()) {
    try {
      const retailerId = await retailerIdFromRow(row, retailers);
      const retailer = retailers.find((item) => item.id === retailerId);
      const template = retailer ? retailerTemplates.find((item) => item.retailerName === retailer.name) : null;
      const rating = (textFromRow(row, "rating", "manualPriorityOverride") || "WATCH").toUpperCase();
      const input = productCreateSchema.parse({
        name: textFromRow(row, "name", "productName"),
        retailerId,
        releaseId: await releaseIdFromRow(row),
        setName: textFromRow(row, "setName", "set"),
        productType: textFromRow(row, "productType", "type"),
        imageUrl: textFromRow(row, "imageUrl", "image", "productImageUrl"),
        expectedTitleKeywords: textFromRow(row, "expectedTitleKeywords", "titleKeywords", "keywords"),
        url: textFromRow(row, "url", "productUrl"),
        sku: textFromRow(row, "sku", "asin", "tcin"),
        upc: textFromRow(row, "upc"),
        dpci: textFromRow(row, "dpci"),
        retailerProductId: textFromRow(row, "retailerProductId", "productId", "itemId", "offerId"),
        retailPrice: numberFromRow(row, "retailPrice", "price"),
        stockStatus: (textFromRow(row, "stockStatus", "status") || "UNAVAILABLE").toUpperCase(),
        priority: (textFromRow(row, "priority") || template?.alertPriorityDefault || "MEDIUM").toUpperCase(),
        rating,
        manualPriorityOverride: (textFromRow(row, "manualPriorityOverride") || rating).toUpperCase(),
        monitorEnabled: boolFromRow(row, "monitorEnabled") ?? true,
        checkFrequencyMinutes: numberFromRow(row, "checkFrequencyMinutes", "frequencyMinutes") ?? 60,
        requiredWords: textFromRow(row, "requiredWords", "requiredDetectionWords"),
        ignoreWords: textFromRow(row, "ignoreWords", "ignoredDetectionWords"),
        sealedResaleNotes: textFromRow(row, "sealedResaleNotes"),
        scarcityNotes: textFromRow(row, "scarcityNotes"),
        notes: textFromRow(row, "notes")
      });
      await createProduct(input);
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : "Import failed"}`);
    }
  }

  return result;
}

export async function importStores(format: "csv" | "json", data: string) {
  const rows = parseImportRows(format, data, "stores");
  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const result = { ok: true, created: 0, failed: 0, errors: [] as string[] };

  for (const [index, row] of rows.entries()) {
    try {
      const phone = textFromRow(row, "phone", "phoneNumber");
      const zip = textFromRow(row, "zip", "postalCode");
      const placeId = textFromRow(row, "place_id", "placeId", "googlePlaceId");
      const notes = [textFromRow(row, "notes"), phone ? `Phone: ${phone}` : null, zip ? `ZIP: ${zip}` : null, placeId ? `Google place_id: ${placeId}` : null]
        .filter(Boolean)
        .join("\n");
      const input = storeCreateSchema.parse({
        retailerId: await retailerIdFromRow(row, retailers),
        storeName: textFromRow(row, "storeName", "name"),
        address: textFromRow(row, "address"),
        city: textFromRow(row, "city"),
        state: textFromRow(row, "state"),
        zone: (textFromRow(row, "zone", "region") || "MIAMI").toUpperCase(),
        latitude: numberFromRow(row, "latitude", "lat"),
        longitude: numberFromRow(row, "longitude", "lng", "lon"),
        typicalRestockDays: textFromRow(row, "typicalRestockDays", "restockDays") || "Unknown",
        typicalRestockTimeWindow: textFromRow(row, "typicalRestockTimeWindow", "restockWindow") || "Unknown",
        vendorNotes: textFromRow(row, "vendorNotes") || (placeId ? `Google place_id: ${placeId}` : undefined),
        confidenceScore: numberFromRow(row, "confidenceScore", "confidence") ?? 50,
        notes: notes || undefined
      });
      await createStore(input);
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : "Import failed"}`);
    }
  }

  return result;
}

export async function importReleases(format: "csv" | "json", data: string) {
  const rows = parseImportRows(format, data, "releases");
  const result = { ok: true, created: 0, failed: 0, errors: [] as string[] };

  for (const [index, row] of rows.entries()) {
    try {
      const input = releaseCreateSchema.parse({
        setName: textFromRow(row, "setName", "name"),
        productType: textFromRow(row, "productType", "type"),
        officialReleaseDate: textFromRow(row, "officialReleaseDate", "releaseDate"),
        preorderDate: textFromRow(row, "preorderDate"),
        productTypes: textFromRow(row, "productTypes"),
        pokemonCenterExclusiveVersion: boolFromRow(row, "pokemonCenterExclusiveVersion", "pokemonCenterExclusive") ?? false,
        chaseCards: textFromRow(row, "chaseCards"),
        demandRating: (textFromRow(row, "demandRating", "demand") || "MEDIUM").toUpperCase(),
        estimatedDemand: (textFromRow(row, "estimatedDemand") || textFromRow(row, "demandRating", "demand") || "MEDIUM").toUpperCase(),
        priority: (textFromRow(row, "priority") || "MEDIUM").toUpperCase(),
        sealedProductPriority: (textFromRow(row, "sealedProductPriority") || "MEDIUM").toUpperCase(),
        notes: textFromRow(row, "notes"),
        productLinks: textFromRow(row, "productLinks")
      });
      await createRelease(input);
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : "Import failed"}`);
    }
  }

  return result;
}

function computedCardValues(input: {
  rawAveragePrice: number;
  psa9AverageSalePrice: number;
  psa10AverageSalePrice: number;
  bgs10AverageSalePrice: number;
  bgsBlackLabelAverageSalePrice: number;
  estimatedEbayFee: number;
  estimatedGradingCost: number;
  estimatedShippingCost: number;
  minimumProfitTarget: number;
  lowPop: boolean;
  newRelease: boolean;
  lowNumberedSerialized: boolean;
  strongCharacterDemand: boolean;
  compCount?: number;
  recentCompCount?: number;
}) {
  const psa9EstimatedProfit = calculateCardProfit(
    input.rawAveragePrice,
    input.psa9AverageSalePrice,
    input.estimatedEbayFee,
    input.estimatedGradingCost,
    input.estimatedShippingCost
  );
  const psa10EstimatedProfit = calculateCardProfit(
    input.rawAveragePrice,
    input.psa10AverageSalePrice,
    input.estimatedEbayFee,
    input.estimatedGradingCost,
    input.estimatedShippingCost
  );
  const bgs10EstimatedProfit = calculateCardProfit(
    input.rawAveragePrice,
    input.bgs10AverageSalePrice,
    input.estimatedEbayFee,
    input.estimatedGradingCost,
    input.estimatedShippingCost
  );
  const blackLabelEstimatedProfit = calculateCardProfit(
    input.rawAveragePrice,
    input.bgsBlackLabelAverageSalePrice,
    input.estimatedEbayFee,
    input.estimatedGradingCost,
    input.estimatedShippingCost
  );
  const maxRawBuyPricePsa9 = calculateMaxRawBuyPrice(
    input.psa9AverageSalePrice,
    input.estimatedEbayFee,
    input.estimatedGradingCost,
    input.estimatedShippingCost,
    input.minimumProfitTarget
  );
  const maxRawBuyPrice = Math.max(0, maxRawBuyPricePsa9);
  const top10Score = computeTop10Score({
    rawAveragePrice: input.rawAveragePrice,
    psa9EstimatedProfit,
    psa10EstimatedProfit,
    minimumProfitTarget: input.minimumProfitTarget,
    compCount: input.compCount ?? 0,
    recentCompCount: input.recentCompCount ?? 0,
    strongCharacterDemand: input.strongCharacterDemand,
    lowPop: input.lowPop,
    lowNumberedSerialized: input.lowNumberedSerialized,
    newRelease: input.newRelease
  });

  return {
    psa9EstimatedProfit,
    psa10EstimatedProfit,
    bgs10EstimatedProfit,
    blackLabelEstimatedProfit,
    maxRawBuyPricePsa9,
    maxRawBuyPrice,
    top10Score,
    rating: rateCard(psa9EstimatedProfit, psa10EstimatedProfit, input.minimumProfitTarget)
  };
}

async function createCardSnapshot(card: Prisma.CardGetPayload<{ include: typeof cardInclude }>) {
  await prisma.cardPriceSnapshot.create({
    data: {
      cardId: card.id,
      rawAveragePrice: card.rawAveragePrice,
      psa9AverageSalePrice: card.psa9AverageSalePrice,
      psa10AverageSalePrice: card.psa10AverageSalePrice,
      bgs95AverageSalePrice: card.bgs95AverageSalePrice,
      bgs10AverageSalePrice: card.bgs10AverageSalePrice,
      bgsBlackLabelAverageSalePrice: card.bgsBlackLabelAverageSalePrice,
      psa9EstimatedProfit: card.psa9EstimatedProfit,
      psa10EstimatedProfit: card.psa10EstimatedProfit,
      bgs10EstimatedProfit: card.bgs10EstimatedProfit,
      blackLabelEstimatedProfit: card.blackLabelEstimatedProfit,
      maxRawBuyPrice: card.maxRawBuyPrice,
      top10Score: card.top10Score,
      rating: card.rating
    }
  });
}

async function recomputeCardFromComps(
  cardId: string,
  settings?: {
    gradingCost: number;
    ebaySellingFee: number;
    shippingCost: number;
    minimumProfitTarget: number;
  }
) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      compSales: {
        where: { reviewStatus: { not: "REJECTED" } },
        orderBy: { soldAt: "desc" },
        select: { gradeType: true, salePrice: true, soldAt: true, sourceQuality: true }
      }
    }
  });
  if (!card) throw new Error("Card not found");

  const compsByGrade = (gradeType: GradeType) =>
    card.compSales
      .filter((sale) => ((sale.gradeType || "RAW") as GradeType) === gradeType)
      .slice(0, 3)
      .map((sale) => sale.salePrice);

  const rawAveragePrice = average(compsByGrade("RAW")) ?? card.rawAveragePrice;
  const psa9AverageSalePrice = average(compsByGrade("PSA_9")) ?? card.psa9AverageSalePrice;
  const psa10AverageSalePrice = average(compsByGrade("PSA_10")) ?? card.psa10AverageSalePrice;
  const bgs95AverageSalePrice = average(compsByGrade("BGS_9_5")) ?? card.bgs95AverageSalePrice;
  const bgs10AverageSalePrice = average(compsByGrade("BGS_10")) ?? card.bgs10AverageSalePrice;
  const bgsBlackLabelAverageSalePrice =
    average(compsByGrade("BGS_BLACK_LABEL")) ?? card.bgsBlackLabelAverageSalePrice;
  const estimatedEbayFee = settings?.ebaySellingFee ?? card.estimatedEbayFee;
  const estimatedGradingCost = settings?.gradingCost ?? card.estimatedGradingCost;
  const estimatedShippingCost = settings?.shippingCost ?? card.estimatedShippingCost;
  const minimumProfitTarget = settings?.minimumProfitTarget ?? card.minimumProfitTarget;
  const compCount = card.compSales.length;
  const computed = computedCardValues({
    rawAveragePrice,
    psa9AverageSalePrice,
    psa10AverageSalePrice,
    bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice,
    estimatedEbayFee,
    estimatedGradingCost,
    estimatedShippingCost,
    minimumProfitTarget,
    lowPop: card.lowPop,
    newRelease: card.newRelease,
    lowNumberedSerialized: card.lowNumberedSerialized,
    strongCharacterDemand: card.strongCharacterDemand,
    compCount,
    recentCompCount: recentCompCount(card.compSales)
  });
  const compConfidenceScore = computeCardConfidence({
    rawAveragePrice,
    psa9AverageSalePrice,
    psa10AverageSalePrice,
    bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice,
    compSales: card.compSales
  });

  const updated = await prisma.card.update({
    where: { id: cardId },
    data: {
      rawAveragePrice,
      psa9AverageSalePrice,
      psa10AverageSalePrice,
      bgs95AverageSalePrice,
      bgs10AverageSalePrice,
      bgsBlackLabelAverageSalePrice,
      estimatedEbayFee,
      estimatedGradingCost,
      estimatedShippingCost,
      minimumProfitTarget,
      ...computed,
      compConfidenceScore,
      rating: computed.rating,
      dataSource: compCount
        ? card.compSales.some((sale) => sale.sourceQuality === "EBAY_SOLD")
          ? "eBay sold comps"
          : "Manual sold comps"
        : card.dataSource,
      lastCompAt: card.compSales[0]?.soldAt ?? card.lastCompAt,
      lastRefreshed: card.compSales[0]?.soldAt ?? card.lastRefreshed
    },
    include: cardInclude
  });

  await createCardSnapshot(updated);
  return updated;
}

export async function createCard(input: {
  releaseId?: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  rawAveragePrice: number;
  psa9AverageSalePrice: number;
  psa10AverageSalePrice: number;
  bgs95AverageSalePrice?: number;
  bgs10AverageSalePrice?: number;
  bgsBlackLabelAverageSalePrice?: number;
  estimatedEbayFee: number;
  estimatedGradingCost: number;
  estimatedShippingCost?: number;
  minimumProfitTarget?: number;
  rating?: Rating;
  dataSource: string;
  lastRefreshed: Date;
  notes?: string;
  characterName?: string;
  era?: "MODERN" | "VINTAGE";
  lowPop: boolean;
  newRelease: boolean;
  lowNumberedSerialized?: boolean;
  strongCharacterDemand?: boolean;
  ebayIncludeWords?: string;
  ebayExcludeWords?: string;
  ebayExactSetName?: boolean;
  ebayCardNumberRequired?: boolean;
  ebayRawKeywords?: string;
  ebayPsa9Keywords?: string;
  ebayPsa10Keywords?: string;
  ebayAllowNonEnglish?: boolean;
}) {
  const matchedRelease = input.releaseId
    ? null
    : await prisma.release.findFirst({ where: { setName: input.setName }, select: { id: true } });
  const normalized = {
    ...input,
    releaseId: input.releaseId ?? matchedRelease?.id,
    bgs95AverageSalePrice: input.bgs95AverageSalePrice ?? 0,
    bgs10AverageSalePrice: input.bgs10AverageSalePrice ?? 0,
    bgsBlackLabelAverageSalePrice: input.bgsBlackLabelAverageSalePrice ?? 0,
    estimatedShippingCost: input.estimatedShippingCost ?? 5,
    minimumProfitTarget: input.minimumProfitTarget ?? 20,
    era: input.era ?? "MODERN",
    lowNumberedSerialized: input.lowNumberedSerialized ?? false,
    strongCharacterDemand: input.strongCharacterDemand ?? false,
    ebayIncludeWords: input.ebayIncludeWords ?? null,
    ebayExcludeWords: input.ebayExcludeWords ?? null,
    ebayExactSetName: input.ebayExactSetName ?? true,
    ebayCardNumberRequired: input.ebayCardNumberRequired ?? true,
    ebayRawKeywords: input.ebayRawKeywords ?? null,
    ebayPsa9Keywords: input.ebayPsa9Keywords ?? null,
    ebayPsa10Keywords: input.ebayPsa10Keywords ?? null,
    ebayAllowNonEnglish: input.ebayAllowNonEnglish ?? false
  };
  const computed = computedCardValues(normalized);
  const compConfidenceScore = computeCardConfidence({
    rawAveragePrice: normalized.rawAveragePrice,
    psa9AverageSalePrice: normalized.psa9AverageSalePrice,
    psa10AverageSalePrice: normalized.psa10AverageSalePrice,
    bgs10AverageSalePrice: normalized.bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice: normalized.bgsBlackLabelAverageSalePrice,
    compSales: []
  });
  const rating = input.rating || computed.rating;

  const card = await prisma.card.create({
    data: {
      ...normalized,
      ...computed,
      compConfidenceScore,
      rating
    },
    include: cardInclude
  });

  await createCardSnapshot(card);

  if (card.psa10EstimatedProfit > 35 || card.psa9EstimatedProfit > 8) {
    await prisma.alert.create({
      data: {
        title: `${card.cardName} grading opportunity`,
        reason: `Manual data shows PSA 9 profit $${card.psa9EstimatedProfit} and PSA 10 profit $${card.psa10EstimatedProfit}.`,
        priority: rating === "BUY" ? "HIGH" : "MEDIUM",
        entityType: "CARD",
        entityId: card.id
      }
    });
  }

  return cardToDTO(card);
}

export async function updateCard(
  cardId: string,
  input: {
    releaseId?: string;
    cardName: string;
    setName: string;
    cardNumber: string;
    rarity: string;
    rawAveragePrice: number;
    psa9AverageSalePrice: number;
    psa10AverageSalePrice: number;
    bgs95AverageSalePrice?: number;
    bgs10AverageSalePrice?: number;
    bgsBlackLabelAverageSalePrice?: number;
    estimatedEbayFee: number;
    estimatedGradingCost: number;
    estimatedShippingCost?: number;
    minimumProfitTarget?: number;
    rating?: Rating;
    dataSource: string;
    lastRefreshed: Date;
    notes?: string;
    characterName?: string;
    era?: "MODERN" | "VINTAGE";
    lowPop: boolean;
    newRelease: boolean;
    lowNumberedSerialized?: boolean;
    strongCharacterDemand?: boolean;
    ebayIncludeWords?: string;
    ebayExcludeWords?: string;
    ebayExactSetName?: boolean;
    ebayCardNumberRequired?: boolean;
    ebayRawKeywords?: string;
    ebayPsa9Keywords?: string;
    ebayPsa10Keywords?: string;
    ebayAllowNonEnglish?: boolean;
  }
) {
  const existing = await prisma.card.findUnique({ where: { id: cardId } });
  if (!existing) throw new Error("Card not found");
  const matchedRelease = input.releaseId
    ? null
    : await prisma.release.findFirst({ where: { setName: input.setName }, select: { id: true } });

  const normalized = {
    ...input,
    releaseId: input.releaseId ?? matchedRelease?.id ?? existing.releaseId,
    bgs95AverageSalePrice: input.bgs95AverageSalePrice ?? existing.bgs95AverageSalePrice,
    bgs10AverageSalePrice: input.bgs10AverageSalePrice ?? existing.bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice:
      input.bgsBlackLabelAverageSalePrice ?? existing.bgsBlackLabelAverageSalePrice,
    estimatedShippingCost: input.estimatedShippingCost ?? existing.estimatedShippingCost,
    minimumProfitTarget: input.minimumProfitTarget ?? existing.minimumProfitTarget,
    era: input.era ?? (existing.era as "MODERN" | "VINTAGE"),
    lowNumberedSerialized: input.lowNumberedSerialized ?? existing.lowNumberedSerialized,
    strongCharacterDemand: input.strongCharacterDemand ?? existing.strongCharacterDemand,
    ebayIncludeWords: input.ebayIncludeWords ?? null,
    ebayExcludeWords: input.ebayExcludeWords ?? null,
    ebayExactSetName: input.ebayExactSetName ?? existing.ebayExactSetName,
    ebayCardNumberRequired: input.ebayCardNumberRequired ?? existing.ebayCardNumberRequired,
    ebayRawKeywords: input.ebayRawKeywords ?? null,
    ebayPsa9Keywords: input.ebayPsa9Keywords ?? null,
    ebayPsa10Keywords: input.ebayPsa10Keywords ?? null,
    ebayAllowNonEnglish: input.ebayAllowNonEnglish ?? existing.ebayAllowNonEnglish
  };
  const compSales = await prisma.cardCompSale.findMany({
    where: { cardId, reviewStatus: { not: "REJECTED" } },
    select: { soldAt: true, sourceQuality: true }
  });
  const computed = computedCardValues({
    ...normalized,
    compCount: compSales.length,
    recentCompCount: recentCompCount(compSales)
  });
  const compConfidenceScore = computeCardConfidence({
    rawAveragePrice: normalized.rawAveragePrice,
    psa9AverageSalePrice: normalized.psa9AverageSalePrice,
    psa10AverageSalePrice: normalized.psa10AverageSalePrice,
    bgs10AverageSalePrice: normalized.bgs10AverageSalePrice,
    bgsBlackLabelAverageSalePrice: normalized.bgsBlackLabelAverageSalePrice,
    compSales
  });
  const rating = input.rating || computed.rating;

  const card = await prisma.card.update({
    where: { id: cardId },
    data: {
      ...normalized,
      ...computed,
      compConfidenceScore,
      rating
    },
    include: cardInclude
  });

  await createCardSnapshot(card);

  return cardToDTO(card);
}

export async function createCardCompSale(
  currentUser: SessionUser,
  input: {
    cardName: string;
    setName: string;
    cardNumber: string;
    gradeType: GradeType;
    sourceQuality: CompSourceQuality;
    salePrice: number;
    soldAt: Date;
    sourceUrl?: string;
    saleTitle?: string;
    matchScore?: number;
    conditionNotes?: string;
    characterName?: string;
    era?: "MODERN" | "VINTAGE";
    lowNumberedSerialized: boolean;
    strongCharacterDemand: boolean;
    lowPop: boolean;
    newRelease: boolean;
  }
) {
  const settings = await ensureInvestmentSettings(currentUser);
  const existing = await prisma.card.findFirst({
    where: {
      setName: input.setName,
      cardNumber: input.cardNumber
    }
  });
  const matchedRelease = await prisma.release.findFirst({ where: { setName: input.setName }, select: { id: true } });
  const wasPsa9Profitable =
    existing !== null && existing.psa9EstimatedProfit >= (existing.minimumProfitTarget || settings.minimumProfitTarget);
  const gradeSeed = {
    rawAveragePrice: input.gradeType === "RAW" ? input.salePrice : 0,
    psa9AverageSalePrice: input.gradeType === "PSA_9" ? input.salePrice : 0,
    psa10AverageSalePrice: input.gradeType === "PSA_10" ? input.salePrice : 0,
    bgs95AverageSalePrice: input.gradeType === "BGS_9_5" ? input.salePrice : 0,
    bgs10AverageSalePrice: input.gradeType === "BGS_10" ? input.salePrice : 0,
    bgsBlackLabelAverageSalePrice: input.gradeType === "BGS_BLACK_LABEL" ? input.salePrice : 0
  };

  const card =
    existing ??
    (await prisma.card.create({
      data: {
        cardName: input.cardName,
        releaseId: matchedRelease?.id,
        setName: input.setName,
        cardNumber: input.cardNumber,
        rarity: "Manual comp",
        ...gradeSeed,
        estimatedEbayFee: settings.ebaySellingFee,
        estimatedGradingCost: settings.gradingCost,
        estimatedShippingCost: settings.shippingCost,
        minimumProfitTarget: settings.minimumProfitTarget,
        psa9EstimatedProfit: 0,
        psa10EstimatedProfit: 0,
        bgs10EstimatedProfit: 0,
        blackLabelEstimatedProfit: 0,
        maxRawBuyPricePsa9: 0,
        maxRawBuyPrice: 0,
        top10Score: 0,
        compConfidenceScore: 0,
        rating: "WATCH",
        dataSource: "Manual sold comps",
        lastRefreshed: input.soldAt,
        notes: input.conditionNotes,
        characterName: input.characterName,
        era: input.era ?? "MODERN",
        lowPop: input.lowPop,
        newRelease: input.newRelease,
        lowNumberedSerialized: input.lowNumberedSerialized,
        strongCharacterDemand: input.strongCharacterDemand,
        lastCompAt: input.soldAt
      }
    }));

  if (existing) {
    await prisma.card.update({
      where: { id: existing.id },
      data: {
        cardName: input.cardName,
        releaseId: existing.releaseId ?? matchedRelease?.id,
        characterName: input.characterName ?? existing.characterName,
        era: input.era ?? existing.era,
        lowPop: input.lowPop || existing.lowPop,
        newRelease: input.newRelease || existing.newRelease,
        lowNumberedSerialized: input.lowNumberedSerialized || existing.lowNumberedSerialized,
        strongCharacterDemand: input.strongCharacterDemand || existing.strongCharacterDemand
      }
    });
  }

  const sale = await prisma.cardCompSale.create({
    data: {
      cardId: card.id,
      source: sourceQualityLabel(input.sourceQuality),
      sourceQuality: input.sourceQuality,
      salePrice: input.salePrice,
      grade: gradeLabel(input.gradeType),
      gradeType: input.gradeType,
      soldAt: input.soldAt,
      url: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      saleTitle: input.saleTitle,
      matchScore: input.matchScore ?? 100,
      notes: input.conditionNotes,
      conditionNotes: input.conditionNotes
    },
    include: compSaleInclude
  });

  const updatedCard = await recomputeCardFromComps(card.id, {
    gradingCost: settings.gradingCost,
    ebaySellingFee: settings.ebaySellingFee,
    shippingCost: settings.shippingCost,
    minimumProfitTarget: settings.minimumProfitTarget
  });

  if (updatedCard.rating === "BUY") {
    await prisma.alert.create({
      data: {
        title: `${updatedCard.cardName} entered Top 10 range`,
        reason: `${sourceQualityLabel(input.sourceQuality)} ${gradeLabel(
          input.gradeType
        )} comp pushed the raw-to-grade score to ${updatedCard.top10Score}.`,
        priority: "HIGH",
        entityType: "CARD",
        entityId: updatedCard.id,
        userId: currentUser.id
      }
    });
  }

  const isPsa9Profitable = updatedCard.psa9EstimatedProfit >= updatedCard.minimumProfitTarget;
  if (!wasPsa9Profitable && isPsa9Profitable) {
    await prisma.alert.create({
      data: {
        title: `${updatedCard.cardName} became PSA 9 profitable`,
        reason: `New ${sourceQualityLabel(input.sourceQuality)} ${gradeLabel(
          input.gradeType
        )} comp moved PSA 9 estimated profit to $${updatedCard.psa9EstimatedProfit.toFixed(2)}, above the $${updatedCard.minimumProfitTarget.toFixed(
          2
        )} target.`,
        priority: "HIGH",
        entityType: "CARD",
        entityId: updatedCard.id,
        userId: currentUser.id
      }
    });
  }

  return { compSale: cardCompSaleToDTO(sale), card: cardToDTO(updatedCard) };
}

export async function refreshCardEbayComps(currentUser: SessionUser, cardId: string) {
  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) throw new Error("Card not found");

  const result = await fetchLastThreeEbayComps({
    cardName: card.cardName,
    setName: card.setName,
    cardNumber: card.cardNumber
  }, {
    includeWords: card.ebayIncludeWords,
    excludeWords: card.ebayExcludeWords,
    exactSetName: card.ebayExactSetName,
    cardNumberRequired: card.ebayCardNumberRequired,
    rawKeywords: card.ebayRawKeywords,
    psa9Keywords: card.ebayPsa9Keywords,
    psa10Keywords: card.ebayPsa10Keywords,
    allowNonEnglish: card.ebayAllowNonEnglish
  });
  if (result.mode === "manual") {
    return {
      mode: result.mode,
      message: result.message,
      added: 0,
      card: cardToDTO(await prisma.card.findUniqueOrThrow({ where: { id: cardId }, include: cardInclude }))
    };
  }

  const settings = await ensureInvestmentSettings(currentUser);
  const wasPsa9Profitable = card.psa9EstimatedProfit >= (card.minimumProfitTarget || settings.minimumProfitTarget);
  let added = 0;
  for (const sale of result.sales) {
    const existingByUrl = sale.sourceUrl
      ? await prisma.cardCompSale.findFirst({ where: { cardId, gradeType: sale.gradeType, sourceUrl: sale.sourceUrl } })
      : null;
    const existing =
      existingByUrl ??
      (await prisma.cardCompSale.findFirst({
        where: {
          cardId,
          gradeType: sale.gradeType,
          saleTitle: sale.saleTitle,
          salePrice: sale.salePrice,
          soldAt: sale.soldAt
        }
      }));
    if (existing) continue;
    await prisma.cardCompSale.create({
      data: {
        cardId,
        source: "eBay sold",
        sourceQuality: "EBAY_SOLD",
        salePrice: sale.salePrice,
        grade: gradeLabel(sale.gradeType),
        gradeType: sale.gradeType,
        soldAt: sale.soldAt,
        url: sale.sourceUrl,
        sourceUrl: sale.sourceUrl,
        saleTitle: sale.saleTitle,
        matchScore: sale.matchScore,
        notes: "Imported by eBay last-3 completed sales refresh.",
        conditionNotes: sale.conditionNotes
      }
    });
    added += 1;
  }

  const updatedCard = await recomputeCardFromComps(cardId, {
    gradingCost: settings.gradingCost,
    ebaySellingFee: settings.ebaySellingFee,
    shippingCost: settings.shippingCost,
    minimumProfitTarget: settings.minimumProfitTarget
  });

  if (added > 0 && !wasPsa9Profitable && updatedCard.psa9EstimatedProfit >= updatedCard.minimumProfitTarget) {
    await deliverAlert({
      title: `${updatedCard.cardName} became PSA 9 profitable`,
      reason: `New eBay sold comps moved PSA 9 estimated profit to $${updatedCard.psa9EstimatedProfit.toFixed(
        2
      )}, above the $${updatedCard.minimumProfitTarget.toFixed(2)} target.`,
      priority: "HIGH",
      entityType: "CARD",
      entityId: updatedCard.id
    });
  }

  return {
    mode: result.mode,
    message: `${result.message} Added ${added} new comps; averages use the last 3 sales per grade.`,
    added,
    card: cardToDTO(updatedCard)
  };
}

export async function refreshAllCardEbayComps(currentUser: SessionUser) {
  const cards = await prisma.card.findMany({ select: { id: true }, orderBy: [{ top10Score: "desc" }, { updatedAt: "desc" }] });
  const results = [];
  for (const card of cards) {
    results.push(await refreshCardEbayComps(currentUser, card.id));
  }
  return {
    mode: ebayMode(),
    refreshed: results.length,
    added: results.reduce((sum, result) => sum + result.added, 0),
    results
  };
}

export function getEbayApiStatus() {
  return ebayConnectionStatus();
}

export async function testEbayApiConnection() {
  return testEbayConnection();
}

export async function reviewCardCompSale(
  currentUser: SessionUser,
  compId: string,
  input: { action: "accept" | "reject" }
) {
  const existing = await prisma.cardCompSale.findUnique({
    where: { id: compId },
    select: { id: true, cardId: true, saleTitle: true, gradeType: true, reviewStatus: true }
  });
  if (!existing) throw new Error("Comp sale not found");

  const reviewStatus = input.action === "reject" ? "REJECTED" : "ACCEPTED";
  const sale = await prisma.cardCompSale.update({
    where: { id: compId },
    data: {
      reviewStatus,
      rejectedAt: reviewStatus === "REJECTED" ? new Date() : null,
      notes:
        reviewStatus === "REJECTED"
          ? `Rejected by ${currentUser.email}; excluded from averages.`
          : `Accepted by ${currentUser.email}; included in averages.`
    },
    include: compSaleInclude
  });

  const settings = await ensureInvestmentSettings(currentUser);
  const card = await recomputeCardFromComps(existing.cardId, {
    gradingCost: settings.gradingCost,
    ebaySellingFee: settings.ebaySellingFee,
    shippingCost: settings.shippingCost,
    minimumProfitTarget: settings.minimumProfitTarget
  });

  return {
    compSale: cardCompSaleToDTO(sale),
    card: cardToDTO(card)
  };
}

export async function generateWeeklyInvestmentReport(
  currentUser: SessionUser,
  input: { notes?: string | null } = {}
) {
  const cards = (await prisma.card.findMany({
    include: cardInclude,
    orderBy: [{ top10Score: "desc" }, { psa10EstimatedProfit: "desc" }]
  })).map(cardToDTO);

  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const top10RawToGrade = cards
    .filter((card) => card.rawAveragePrice > 0)
    .sort(
      (a, b) =>
        b.top10Score - a.top10Score ||
        b.compConfidenceScore - a.compConfidenceScore ||
        b.psa10EstimatedProfit - a.psa10EstimatedProfit
    )
    .slice(0, 10)
    .map((card) =>
      reportItemFromCard(
        card,
        `Score ${card.top10Score} with ${card.compCount} comps, PSA 9 profit ${card.psa9EstimatedProfit.toFixed(
          2
        )}, and PSA 10 upside ${card.psa10EstimatedProfit.toFixed(2)}.`
      )
    );
  const safestPsa9Flips = cards
    .filter((card) => card.psa9EstimatedProfit >= card.minimumProfitTarget)
    .sort(
      (a, b) =>
        b.compConfidenceScore - a.compConfidenceScore ||
        b.psa9EstimatedProfit - a.psa9EstimatedProfit ||
        a.rawAveragePrice - b.rawAveragePrice
    )
    .slice(0, 5)
    .map((card) =>
      reportItemFromCard(
        card,
        `PSA 9 profit clears the ${card.minimumProfitTarget.toFixed(2)} target with ${card.compConfidenceScore}% confidence.`
      )
    );
  const highestPsa10Upside = cards
    .filter((card) => card.psa10EstimatedProfit > 0)
    .sort((a, b) => b.psa10EstimatedProfit - a.psa10EstimatedProfit || b.compConfidenceScore - a.compConfidenceScore)
    .slice(0, 5)
    .map((card) =>
      reportItemFromCard(
        card,
        `PSA 10 estimated profit is ${card.psa10EstimatedProfit.toFixed(2)} against raw entry ${card.rawAveragePrice.toFixed(2)}.`
      )
    );
  const beckettCandidates = cards
    .filter((card) => card.bgs10EstimatedProfit > 0 || card.blackLabelEstimatedProfit > 0 || card.lowPop || card.lowNumberedSerialized)
    .sort(
      (a, b) =>
        b.blackLabelEstimatedProfit +
          b.bgs10EstimatedProfit +
          (b.lowPop ? 25 : 0) +
          (b.lowNumberedSerialized ? 25 : 0) -
        (a.blackLabelEstimatedProfit + a.bgs10EstimatedProfit + (a.lowPop ? 25 : 0) + (a.lowNumberedSerialized ? 25 : 0))
    )
    .slice(0, 5)
    .map((card) =>
      reportItemFromCard(
        card,
        `Beckett upside is led by BGS 10 profit ${card.bgs10EstimatedProfit.toFixed(2)} and Black Label profit ${card.blackLabelEstimatedProfit.toFixed(
          2
        )}.`
      )
    );
  const avoidOverpriced = cards
    .filter(
      (card) =>
        card.rating === "AVOID" ||
        (card.rawAveragePrice > 0 &&
          card.psa9EstimatedProfit < card.minimumProfitTarget &&
          card.psa10EstimatedProfit < card.minimumProfitTarget)
    )
    .sort(
      (a, b) =>
        a.psa9EstimatedProfit + a.psa10EstimatedProfit - (b.psa9EstimatedProfit + b.psa10EstimatedProfit) ||
        b.rawAveragePrice - a.rawAveragePrice
    )
    .slice(0, 5)
    .map((card) =>
      reportItemFromCard(
        card,
        `Avoid unless entry drops; PSA 9 profit is ${card.psa9EstimatedProfit.toFixed(2)} and PSA 10 profit is ${card.psa10EstimatedProfit.toFixed(2)}.`
      )
    );

  const bestBuy = top10RawToGrade[0] ?? null;
  const riskiestBuy =
    cards
      .filter((card) => card.psa10EstimatedProfit > card.minimumProfitTarget && (card.compConfidenceScore < 60 || card.rawAveragePrice >= 75))
      .sort((a, b) => b.psa10EstimatedProfit - a.psa10EstimatedProfit)
      .map((card) =>
        reportItemFromCard(
          card,
          `High upside but riskier because confidence is ${card.compConfidenceScore}% and raw entry is ${card.rawAveragePrice.toFixed(2)}.`
        )
      )[0] ?? null;
  const bestUnder25Raw =
    cards
      .filter((card) => card.rawAveragePrice > 0 && card.rawAveragePrice <= 25)
      .sort((a, b) => b.top10Score - a.top10Score || b.psa10EstimatedProfit - a.psa10EstimatedProfit)
      .map((card) => reportItemFromCard(card, `Best sub-$25 raw entry with score ${card.top10Score}.`))[0] ?? null;
  const bestPremiumCard =
    cards
      .filter((card) => card.rawAveragePrice >= 75)
      .sort((a, b) => b.top10Score - a.top10Score || b.psa10EstimatedProfit - a.psa10EstimatedProfit)
      .map((card) => reportItemFromCard(card, `Best premium entry with score ${card.top10Score}.`))[0] ?? null;

  const report = await prisma.investmentReport.create({
    data: {
      userId: currentUser.id,
      title: `Weekly Investment Report - ${now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })}`,
      generatedAt: now,
      periodStart,
      periodEnd: now,
      top10RawToGrade: toReportJson(top10RawToGrade),
      safestPsa9Flips: toReportJson(safestPsa9Flips),
      highestPsa10Upside: toReportJson(highestPsa10Upside),
      beckettCandidates: toReportJson(beckettCandidates),
      avoidOverpriced: toReportJson(avoidOverpriced),
      bestBuy: toReportJson(bestBuy),
      riskiestBuy: toReportJson(riskiestBuy),
      bestUnder25Raw: toReportJson(bestUnder25Raw),
      bestPremiumCard: toReportJson(bestPremiumCard),
      notes: input.notes || null
    }
  });

  return investmentReportToDTO(report);
}

export async function updateInvestmentSettings(
  currentUser: SessionUser,
  input: {
    gradingCost: number;
    ebaySellingFee: number;
    shippingCost: number;
    minimumProfitTarget: number;
  }
) {
  const settings = await prisma.investmentSettings.upsert({
    where: { userId: currentUser.id },
    update: input,
    create: {
      userId: currentUser.id,
      ...input
    }
  });

  const cards = await prisma.card.findMany({ select: { id: true } });
  for (const card of cards) {
    await recomputeCardFromComps(card.id, settings);
  }

  return investmentSettingsToDTO(settings);
}

export async function deleteCard(cardId: string) {
  await prisma.alert.deleteMany({ where: { entityType: "CARD", entityId: cardId } });
  await prisma.card.delete({ where: { id: cardId } });
  return { ok: true };
}

export async function markAlertRead(alertId: string) {
  const alert = await prisma.alert.update({
    where: { id: alertId },
    data: { read: true }
  });
  return alertToDTO(alert);
}

export async function markAlertFalsePositive(currentUser: SessionUser, alertId: string) {
  const alert = await prisma.alert.findFirst({
    where: {
      id: alertId,
      OR: [{ userId: null }, { userId: currentUser.id }]
    }
  });
  if (!alert) throw new Error("Alert not found");
  const updated = await prisma.alert.update({
    where: { id: alertId },
    data: {
      falsePositiveAt: new Date(),
      read: true,
      explanation: `${alert.explanation || alert.reason} User marked this alert as a false positive.`
    }
  });
  if (alert.productId) {
    await prisma.monitorLog.create({
      data: {
        productId: alert.productId,
        runType: "ALERT_FEEDBACK",
        status: "FALSE_POSITIVE",
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
        changeSummary: "Alert marked false positive from alert history.",
        reason: alert.reason,
        alertSent: false
      }
    });
  }
  return alertToDTO(updated);
}

export async function createSavedFilterPreset(
  currentUser: SessionUser,
  input: { name: string; section: string; filters: string }
) {
  const preset = await prisma.savedFilterPreset.create({
    data: {
      userId: currentUser.id,
      name: input.name,
      section: input.section,
      filters: input.filters
    }
  });
  return savedFilterPresetToDTO(preset);
}

export async function deleteSavedFilterPreset(currentUser: SessionUser, presetId: string) {
  await prisma.savedFilterPreset.deleteMany({ where: { id: presetId, userId: currentUser.id } });
  return { ok: true };
}

function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function createDailyRecap(currentUser: SessionUser, input: { recapDate?: Date | null } = {}) {
  const { start, end } = dayRange(input.recapDate ?? new Date());
  const [productChecks, storeVisits, purchases, alertsCreated] = await Promise.all([
    prisma.monitorLog.count({ where: { startedAt: { gte: start, lt: end } } }),
    prisma.storeSighting.count({ where: { userId: currentUser.id, seenAt: { gte: start, lt: end } } }),
    prisma.inventoryItem.count({ where: { userId: currentUser.id, purchasedAt: { gte: start, lt: end } } }),
    prisma.alert.count({
      where: {
        timestamp: { gte: start, lt: end },
        OR: [{ userId: null }, { userId: currentUser.id }]
      }
    })
  ]);
  const summary = `${productChecks} product check${productChecks === 1 ? "" : "s"}, ${storeVisits} store visit${
    storeVisits === 1 ? "" : "s"
  }, ${purchases} purchase${purchases === 1 ? "" : "s"}, and ${alertsCreated} alert${alertsCreated === 1 ? "" : "s"}.`;
  const recap = await prisma.dailyRecap.create({
    data: {
      userId: currentUser.id,
      recapDate: start,
      summary,
      productChecks,
      storeVisits,
      purchases,
      alertsCreated
    }
  });
  return dailyRecapToDTO(recap);
}

export async function updateNotificationSettings(
  currentUser: SessionUser,
  input: {
    inApp: boolean;
    email: boolean;
    sms: boolean;
    browserPush: boolean;
    phone?: string;
    emailTo?: string;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    minimumPriority: Priority;
    alertDigestMode: boolean;
    urgentOnlyMode: boolean;
    highPriorityOverride: boolean;
    watchedRetailers?: string;
    watchedProducts?: string;
    alertCooldownMinutes: number;
  }
) {
  const settings = await prisma.notificationSettings.upsert({
    where: { userId: currentUser.id },
    update: {
      inApp: input.inApp,
      email: input.email,
      sms: input.sms,
      browserPush: input.browserPush,
      phone: input.phone,
      emailTo: input.emailTo || currentUser.email,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      minimumPriority: input.minimumPriority,
      alertDigestMode: input.alertDigestMode,
      urgentOnlyMode: input.urgentOnlyMode,
      highPriorityOverride: input.highPriorityOverride,
      watchedRetailers: input.watchedRetailers,
      watchedProducts: input.watchedProducts,
      alertCooldownMinutes: input.alertCooldownMinutes
    },
    create: {
      userId: currentUser.id,
      inApp: input.inApp,
      email: input.email,
      sms: input.sms,
      browserPush: input.browserPush,
      phone: input.phone,
      emailTo: input.emailTo || currentUser.email,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      minimumPriority: input.minimumPriority,
      alertDigestMode: input.alertDigestMode,
      urgentOnlyMode: input.urgentOnlyMode,
      highPriorityOverride: input.highPriorityOverride,
      watchedRetailers: input.watchedRetailers,
      watchedProducts: input.watchedProducts,
      alertCooldownMinutes: input.alertCooldownMinutes
    }
  });
  return notificationSettingsToDTO(settings);
}

async function clearRadarData(includeUsers: boolean) {
  await prisma.productPriorityScore.deleteMany();
  await prisma.productDiscoveryCandidate.deleteMany();
  await prisma.productDiscoverySource.deleteMany();
  await prisma.monitorLog.deleteMany();
  await prisma.investmentReport.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.friendInvite.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.savedFilterPreset.deleteMany();
  await prisma.dailyRecap.deleteMany();
  await prisma.inventoryMarketComp.deleteMany();
  await prisma.barcodeScan.deleteMany();
  await prisma.inventorySale.deleteMany();
  await prisma.inventoryStockLot.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.cardCompSale.deleteMany();
  await prisma.cardPriceSnapshot.deleteMany();
  await prisma.restockHistory.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.storeSighting.deleteMany();
  await prisma.userStorePreference.deleteMany();
  await prisma.card.deleteMany();
  await prisma.release.deleteMany();
  await prisma.product.deleteMany();
  await prisma.store.deleteMany();
  if (includeUsers) {
    await prisma.browserPushSubscription.deleteMany();
    await prisma.investmentSettings.deleteMany();
    await prisma.notificationSettings.deleteMany();
    await prisma.user.deleteMany();
  }
  await prisma.retailer.deleteMany();
}

async function ensureRetailers() {
  const retailerSeeds = [
    ["Pokemon Center", "https://www.pokemoncenter.com"],
    ["Target", "https://www.target.com"],
    ["Walmart", "https://www.walmart.com"],
    ["Best Buy", "https://www.bestbuy.com"],
    ["GameStop", "https://www.gamestop.com"],
    ["Amazon", "https://www.amazon.com"]
  ] as const;

  const retailers = new Map<string, string>();
  for (const [name, website] of retailerSeeds) {
    const retailer = await prisma.retailer.upsert({
      where: { name },
      update: { website },
      create: { name, website }
    });
    retailers.set(name, retailer.id);
  }
  return retailers;
}

export async function resetDemoData() {
  await clearRadarData(false);
  const retailers = await ensureRetailers();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Create an admin user before resetting demo data");
  await prisma.user.update({
    where: { id: admin.id },
    data: { preferredZone: "MIAMI", customZoneName: null, hideDistantStores: false }
  });

  const chaosRelease = await createRelease({
    setName: "Mega Evolution-Chaos Rising",
    productType: "Build & Battle Box",
    officialReleaseDate: new Date("2026-05-22T14:00:00.000Z"),
    preorderDate: new Date("2026-05-08T14:00:00.000Z"),
    productTypes: "Build & Battle Box, Booster Bundle, ETB, Booster Display",
    pokemonCenterExclusiveVersion: true,
    chaseCards: "Mega Evolution chase cards; verify final card list before buying.",
    demandRating: "HIGH",
    estimatedDemand: "HIGH",
    priority: "HIGH",
    sealedProductPriority: "HIGH",
    notes: "Real release calendar example from public Pokemon.com coverage. Verify regional product dates before live use.",
    productLinks: "https://www.pokemon.com/uk/pokemon-news/get-a-pokemon-tcg-mega-evolution-chaos-rising-build-battle-box-early"
  });
  const ascendedRelease = await createRelease({
    setName: "Mega Evolution-Ascended Heroes",
    productType: "Booster Bundle",
    officialReleaseDate: new Date("2026-01-30T14:00:00.000Z"),
    preorderDate: null,
    productTypes: "Booster Bundle, ETB, Booster Display, Sleeved Booster",
    pokemonCenterExclusiveVersion: true,
    chaseCards: "Mega Dragonite ex and other Mega Evolution targets; verify final card list.",
    demandRating: "MEDIUM",
    estimatedDemand: "MEDIUM",
    priority: "MEDIUM",
    sealedProductPriority: "MEDIUM",
    notes: "Real release calendar example from public Pokemon.com pages. Dates can vary by product and region.",
    productLinks: "https://www.pokemon.com/uk/pokemon-news/get-the-new-pokemon-tcg-expansion-mega-evolution-ascended-heroes-on-january-30-2026"
  });

  const demoProducts = [
    {
      retailer: "GameStop",
      releaseId: chaosRelease.id,
      setName: chaosRelease.setName,
      productType: "Premium Collection",
      name: "Pokemon TCG Mega Evolution Chaos Rising Premium Collection",
      url: "https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-mega-evolution-chaos-rising-premium-collection/999000",
      expectedTitleKeywords: "Mega Evolution, Chaos Rising, Premium Collection",
      sku: "GS-PREMIUM",
      retailerProductId: "999000",
      retailPrice: 49.99,
      stockStatus: "PREORDER_LIVE" as ProductStatus,
      priority: "HIGH" as Priority,
      rating: "BUY" as Exclude<Rating, "AVOID">,
      manualPriorityOverride: "BUY" as Exclude<Rating, "AVOID">,
      sealedResaleNotes: "Demo premium sealed target with preorder interest.",
      scarcityNotes: "Watch allocations and local limits.",
      notes: "Demo preorder target. Checkout remains manual."
    },
    {
      retailer: "Target",
      releaseId: chaosRelease.id,
      setName: chaosRelease.setName,
      productType: "Booster Bundle",
      name: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
      url: "https://www.target.com/p/-/A-95298172",
      imageUrl: "https://target.scene7.com/is/image/Target/GUEST_de896676-8332-46bd-b36f-d863b43df7ad",
      expectedTitleKeywords: "Mega Evolution, Chaos Rising, Booster Bundle",
      sku: "TARGET-95298172",
      upc: "196214154162",
      dpci: "361-00-0031",
      retailerProductId: "95298172",
      retailPrice: 29.99,
      stockStatus: "IN_STOCK" as ProductStatus,
      priority: "HIGH" as Priority,
      rating: "BUY" as Exclude<Rating, "AVOID">,
      manualPriorityOverride: "BUY" as Exclude<Rating, "AVOID">,
      sealedResaleNotes: "Booster bundles move quickly when set demand is high.",
      scarcityNotes: "Demo target; verify local limits.",
      notes: "Demo in-stock target."
    },
    {
      retailer: "Pokemon Center",
      releaseId: ascendedRelease.id,
      setName: ascendedRelease.setName,
      productType: "ETB",
      name: "Pokemon TCG Mega Evolution Ascended Heroes ETB",
      url: "https://www.pokemoncenter.com/product/999-00002/pokemon-tcg-mega-evolution-ascended-heroes-pokemon-center-elite-trainer-box",
      expectedTitleKeywords: "Mega Evolution, Ascended Heroes, Elite Trainer Box",
      sku: "PC-AH-ETB",
      upc: "0820650990002",
      retailerProductId: "999-00002",
      retailPrice: 59.99,
      stockStatus: "SOLD_OUT" as ProductStatus,
      priority: "MEDIUM" as Priority,
      rating: "WATCH" as Exclude<Rating, "AVOID">,
      manualPriorityOverride: "WATCH" as Exclude<Rating, "AVOID">,
      sealedResaleNotes: "ETB value depends on promos and set popularity.",
      scarcityNotes: "Pokemon Center version may deserve higher priority.",
      notes: "Demo watch target."
    }
  ];

  for (const product of demoProducts) {
    await createProduct({
      retailerId: retailers.get(product.retailer)!,
      releaseId: product.releaseId,
      setName: product.setName,
      productType: product.productType,
      imageUrl: "imageUrl" in product ? product.imageUrl : undefined,
      expectedTitleKeywords: product.expectedTitleKeywords,
      name: product.name,
      url: product.url,
      sku: product.sku,
      upc: "upc" in product ? product.upc : undefined,
      dpci: "dpci" in product ? product.dpci : undefined,
      retailerProductId: product.retailerProductId,
      retailPrice: product.retailPrice,
      stockStatus: product.stockStatus,
      priority: product.priority,
      rating: product.rating,
      manualPriorityOverride: product.manualPriorityOverride,
      sealedResaleNotes: product.sealedResaleNotes,
      scarcityNotes: product.scarcityNotes,
      notes: product.notes
    });
  }

  const storeSeeds = [
    {
      retailer: "Target",
      storeName: "Target Hialeah",
      address: "1750 W 37th St",
      city: "Hialeah",
      zone: "MIAMI" as Zone,
      latitude: 25.8559,
      longitude: -80.3174,
      days: "Tuesday,Friday",
      window: "8:00 AM - 11:00 AM",
      confidence: 68,
      vendorNotes: "Check front card wall and toy aisle endcap."
    },
    {
      retailer: "Target",
      storeName: "Target Dadeland",
      address: "8350 S Dixie Hwy",
      city: "Miami",
      zone: "MIAMI" as Zone,
      latitude: 25.6915,
      longitude: -80.3054,
      days: "Tuesday,Friday",
      window: "8:30 AM - 11:30 AM",
      confidence: 66,
      vendorNotes: "Dadeland runs can sell through quickly after school/work hours."
    },
    {
      retailer: "Target",
      storeName: "Target Midtown Miami",
      address: "3401 N Miami Ave",
      city: "Miami",
      zone: "MIAMI" as Zone,
      latitude: 25.8072,
      longitude: -80.1937,
      days: "Tuesday,Friday",
      window: "8:00 AM - 11:00 AM",
      confidence: 72,
      vendorNotes: "Card aisle usually touched after front lanes."
    },
    {
      retailer: "Walmart",
      storeName: "Walmart Hialeah Gardens",
      address: "9300 NW 77th Ave",
      city: "Hialeah Gardens",
      zone: "MIAMI" as Zone,
      latitude: 25.8586,
      longitude: -80.3225,
      days: "Wednesday,Saturday",
      window: "9:30 AM - 12:30 PM",
      confidence: 60,
      vendorNotes: "Check trading cards near registers and toys."
    },
    {
      retailer: "Walmart",
      storeName: "Walmart Doral",
      address: "8651 NW 13th Ter",
      city: "Doral",
      zone: "MIAMI" as Zone,
      latitude: 25.7855,
      longitude: -80.337,
      days: "Wednesday,Saturday",
      window: "10:00 AM - 1:00 PM",
      confidence: 58,
      vendorNotes: "Vendor timing varies; sightings drive confidence."
    },
    {
      retailer: "Best Buy",
      storeName: "Best Buy Dadeland",
      address: "8450 S Dixie Hwy",
      city: "Miami",
      zone: "MIAMI" as Zone,
      latitude: 25.6904,
      longitude: -80.3064,
      days: "Thursday,Friday",
      window: "11:00 AM - 2:00 PM",
      confidence: 54,
      vendorNotes: "Ask only about public shelf availability; no backroom pressure."
    },
    {
      retailer: "GameStop",
      storeName: "GameStop Westland Mall Hialeah",
      address: "1675 W 49th St",
      city: "Hialeah",
      zone: "MIAMI" as Zone,
      latitude: 25.8667,
      longitude: -80.3169,
      days: "Friday,Saturday",
      window: "12:00 PM - 3:00 PM",
      confidence: 52,
      vendorNotes: "ETB and collection-box timing depends on allocation."
    }
  ];
  const createdStores = new Map<string, StoreDTO>();
  for (const seed of storeSeeds) {
    const store = await createStore({
      retailerId: retailers.get(seed.retailer)!,
      storeName: seed.storeName,
      address: seed.address,
      city: seed.city,
      state: "FL",
      zone: seed.zone,
      latitude: seed.latitude,
      longitude: seed.longitude,
      typicalRestockDays: seed.days,
      typicalRestockTimeWindow: seed.window,
      vendorNotes: seed.vendorNotes,
      confidenceScore: seed.confidence,
      notes: "Miami-area demo store. Coordinates are manually entered and geocoding-ready."
    });
    createdStores.set(seed.storeName, store);
  }

  await createSighting(admin.id, {
    storeId: createdStores.get("Target Midtown Miami")!.id,
    productSeen: "Booster Bundle",
    resultType: "stock_seen",
    seenAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    quantityEstimate: "6-10",
    notes: "Demo shelf sighting."
  });
  await createSighting(admin.id, {
    storeId: createdStores.get("Target Hialeah")!.id,
    productSeen: "ETB",
    resultType: "stock_seen",
    seenAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    quantityEstimate: "4-6",
    notes: "Demo local route sighting."
  });
  await createSighting(admin.id, {
    storeId: createdStores.get("Walmart Doral")!.id,
    productSeen: "Collection Box",
    resultType: "stock_seen",
    seenAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    quantityEstimate: "1-3",
    notes: "Demo low-quantity sighting."
  });

  await createCard({
    releaseId: chaosRelease.id,
    cardName: "Pikachu ex",
    setName: chaosRelease.setName,
    cardNumber: "025/198",
    rarity: "Ultra Rare",
    rawAveragePrice: 18,
    psa9AverageSalePrice: 45,
    psa10AverageSalePrice: 128,
    estimatedEbayFee: 0.1325,
    estimatedGradingCost: 18,
    rating: "BUY",
    dataSource: "Manual demo sample",
    lastRefreshed: new Date(),
    lowPop: false,
    newRelease: true,
    notes: "Verify real comps before buying."
  });
  await createCard({
    releaseId: chaosRelease.id,
    cardName: "Charizard Illustration Rare",
    setName: chaosRelease.setName,
    cardNumber: "199/198",
    rarity: "Special Illustration Rare",
    rawAveragePrice: 92,
    psa9AverageSalePrice: 145,
    psa10AverageSalePrice: 340,
    estimatedEbayFee: 0.1325,
    estimatedGradingCost: 22,
    rating: "WATCH",
    dataSource: "Manual demo sample",
    lastRefreshed: new Date(),
    lowPop: true,
    newRelease: false,
    notes: "Condition discipline required."
  });

  return { ok: true };
}

export async function exportBackup() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      users: await prisma.user.findMany(),
      retailers: await prisma.retailer.findMany(),
      products: await prisma.product.findMany(),
      productDiscoverySources: await prisma.productDiscoverySource.findMany(),
      productDiscoveryCandidates: await prisma.productDiscoveryCandidate.findMany(),
      stores: await prisma.store.findMany(),
      storeSightings: await prisma.storeSighting.findMany(),
      releases: await prisma.release.findMany(),
      alerts: await prisma.alert.findMany(),
      monitorLogs: await prisma.monitorLog.findMany(),
      restockHistory: await prisma.restockHistory.findMany(),
      cards: await prisma.card.findMany(),
      cardPriceSnapshots: await prisma.cardPriceSnapshot.findMany(),
      cardCompSales: await prisma.cardCompSale.findMany(),
      investmentReports: await prisma.investmentReport.findMany(),
      productPriorityScores: await prisma.productPriorityScore.findMany(),
      notificationSettings: await prisma.notificationSettings.findMany(),
      investmentSettings: await prisma.investmentSettings.findMany(),
      browserPushSubscriptions: await prisma.browserPushSubscription.findMany(),
      friendInvites: await prisma.friendInvite.findMany(),
      auditLogs: await prisma.auditLog.findMany(),
      storePreferences: await prisma.userStorePreference.findMany(),
      inventoryItems: await prisma.inventoryItem.findMany(),
      inventoryStockLots: await prisma.inventoryStockLot.findMany(),
      inventorySales: await prisma.inventorySale.findMany(),
      inventoryMarketComps: await prisma.inventoryMarketComp.findMany(),
      barcodeScans: await prisma.barcodeScan.findMany(),
      dailyRecaps: await prisma.dailyRecap.findMany(),
      savedFilterPresets: await prisma.savedFilterPreset.findMany()
    }
  };
}

function toDate(value: unknown) {
  return value ? new Date(String(value)) : new Date();
}

function toNullableDate(value: unknown) {
  return value ? new Date(String(value)) : null;
}

function toJsonText(value: unknown, fallback: "[]" | "null") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return JSON.stringify(value);
}

function rows<T extends Record<string, unknown>>(tables: Record<string, unknown[]>, key: string) {
  return (tables[key] ?? []) as T[];
}

export async function importBackup(payload: { tables: Record<string, unknown[]> }) {
  const tables = payload.tables;
  await clearRadarData(true);

  await prisma.user.createMany({
    data: rows(tables, "users").map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: String(row.role),
      passwordHash: String(row.passwordHash),
      canAddSightings: row.canAddSightings === undefined ? true : Boolean(row.canAddSightings),
      canAddComps: row.canAddComps === undefined ? false : Boolean(row.canAddComps),
      canRunChecks: row.canRunChecks === undefined ? false : Boolean(row.canRunChecks),
      canReceivePushAlerts: row.canReceivePushAlerts === undefined ? true : Boolean(row.canReceivePushAlerts),
      preferredZone: row.preferredZone ? String(row.preferredZone) : "MIAMI",
      customZoneName: row.customZoneName ? String(row.customZoneName) : null,
      hideDistantStores: row.hideDistantStores === undefined ? false : Boolean(row.hideDistantStores),
      currentLatitude: row.currentLatitude === null || row.currentLatitude === undefined ? null : Number(row.currentLatitude),
      currentLongitude: row.currentLongitude === null || row.currentLongitude === undefined ? null : Number(row.currentLongitude),
      locationUpdatedAt: toNullableDate(row.locationUpdatedAt),
      disabledAt: toNullableDate(row.disabledAt),
      sessionVersion: row.sessionVersion === undefined ? 0 : Number(row.sessionVersion),
      lastLoginAt: toNullableDate(row.lastLoginAt),
      passwordChangedAt: toNullableDate(row.passwordChangedAt),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.friendInvite.createMany({
    data: rows(tables, "friendInvites").map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: row.name ? String(row.name) : null,
      tokenHash: String(row.tokenHash),
      role: row.role ? String(row.role) : "FRIEND",
      canAddSightings: row.canAddSightings === undefined ? true : Boolean(row.canAddSightings),
      canAddComps: row.canAddComps === undefined ? false : Boolean(row.canAddComps),
      canRunChecks: row.canRunChecks === undefined ? false : Boolean(row.canRunChecks),
      canReceivePushAlerts: row.canReceivePushAlerts === undefined ? true : Boolean(row.canReceivePushAlerts),
      expiresAt: toDate(row.expiresAt),
      acceptedAt: toNullableDate(row.acceptedAt),
      revokedAt: toNullableDate(row.revokedAt),
      createdAt: toDate(row.createdAt),
      createdById: row.createdById ? String(row.createdById) : null,
      acceptedById: row.acceptedById ? String(row.acceptedById) : null
    }))
  });
  await prisma.auditLog.createMany({
    data: rows(tables, "auditLogs").map((row) => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : null,
      actorEmail: row.actorEmail ? String(row.actorEmail) : null,
      action: String(row.action),
      entityType: String(row.entityType),
      entityId: row.entityId ? String(row.entityId) : null,
      summary: String(row.summary),
      metadata: row.metadata ? String(row.metadata) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.retailer.createMany({
    data: rows(tables, "retailers").map((row) => ({
      id: String(row.id),
      name: String(row.name),
      website: row.website ? String(row.website) : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.productDiscoverySource.createMany({
    data: rows(tables, "productDiscoverySources").map((row) => ({
      id: String(row.id),
      retailerId: String(row.retailerId),
      name: String(row.name),
      url: String(row.url),
      notes: row.notes ? String(row.notes) : null,
      enabled: row.enabled === undefined ? true : Boolean(row.enabled),
      checkFrequencyMinutes: row.checkFrequencyMinutes === undefined ? 360 : Number(row.checkFrequencyMinutes),
      nextCheckAt: toNullableDate(row.nextCheckAt),
      lastCheckedAt: toNullableDate(row.lastCheckedAt),
      lastSuccessfulCheckedAt: toNullableDate(row.lastSuccessfulCheckedAt),
      lastResult: row.lastResult ? String(row.lastResult) : null,
      lastError: row.lastError ? String(row.lastError) : null,
      lastFoundCount: row.lastFoundCount === undefined ? 0 : Number(row.lastFoundCount),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.release.createMany({
    data: rows(tables, "releases").map((row) => ({
      id: String(row.id),
      setName: String(row.setName),
      productType: row.productType ? String(row.productType) : null,
      officialReleaseDate: toDate(row.officialReleaseDate),
      preorderDate: toNullableDate(row.preorderDate),
      productTypes: String(row.productTypes),
      pokemonCenterExclusiveVersion: Boolean(row.pokemonCenterExclusiveVersion),
      chaseCards: row.chaseCards ? String(row.chaseCards) : null,
      demandRating: String(row.demandRating),
      estimatedDemand: row.estimatedDemand ? String(row.estimatedDemand) : String(row.demandRating ?? "MEDIUM"),
      priority: String(row.priority),
      sealedProductPriority: row.sealedProductPriority ? String(row.sealedProductPriority) : String(row.priority ?? "MEDIUM"),
      notes: row.notes ? String(row.notes) : null,
      productLinks: row.productLinks ? String(row.productLinks) : null,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.product.createMany({
    data: rows(tables, "products").map((row) => ({
      id: String(row.id),
      retailerId: String(row.retailerId),
      releaseId: row.releaseId ? String(row.releaseId) : null,
      name: String(row.name),
      url: String(row.url),
      setName: row.setName ? String(row.setName) : null,
      productType: row.productType ? String(row.productType) : null,
      imageUrl: row.imageUrl ? String(row.imageUrl) : null,
      expectedTitleKeywords: row.expectedTitleKeywords ? String(row.expectedTitleKeywords) : null,
      sku: row.sku ? String(row.sku) : null,
      upc: row.upc ? String(row.upc) : null,
      dpci: row.dpci ? String(row.dpci) : null,
      retailerProductId: row.retailerProductId ? String(row.retailerProductId) : null,
      verificationStatus: row.verificationStatus ? String(row.verificationStatus) : "UNVERIFIED",
      verifiedAt: toNullableDate(row.verifiedAt),
      verifiedFinalUrl: row.verifiedFinalUrl ? String(row.verifiedFinalUrl) : null,
      verificationNotes: row.verificationNotes ? String(row.verificationNotes) : null,
      retailPrice: row.retailPrice === null || row.retailPrice === undefined ? null : Number(row.retailPrice),
      liveTitle: row.liveTitle ? String(row.liveTitle) : null,
      livePrice: row.livePrice === null || row.livePrice === undefined ? null : Number(row.livePrice),
      livePriceSource: row.livePriceSource ? String(row.livePriceSource) : null,
      livePriceVerifiedAt: toNullableDate(row.livePriceVerifiedAt),
      liveStockStatus: row.liveStockStatus ? String(row.liveStockStatus) : null,
      liveStockVerifiedAt: toNullableDate(row.liveStockVerifiedAt),
      liveImageUrl: row.liveImageUrl ? String(row.liveImageUrl) : null,
      liveConfidenceScore:
        row.liveConfidenceScore === null || row.liveConfidenceScore === undefined
          ? null
          : Number(row.liveConfidenceScore),
      liveBlockedType: row.liveBlockedType ? String(row.liveBlockedType) : null,
      isDemoData: row.isDemoData === undefined ? false : Boolean(row.isDemoData),
      stockStatus: String(row.stockStatus),
      alertStatus: Boolean(row.alertStatus),
      priority: String(row.priority),
      rating: String(row.rating),
      notes: row.notes ? String(row.notes) : null,
      lastCheckedAt: toNullableDate(row.lastCheckedAt),
      lastSuccessfulCheckedAt: toNullableDate(row.lastSuccessfulCheckedAt),
      monitorEnabled: row.monitorEnabled === undefined ? true : Boolean(row.monitorEnabled),
      checkFrequencyMinutes: row.checkFrequencyMinutes === undefined ? 60 : Number(row.checkFrequencyMinutes),
      nextCheckAt: toNullableDate(row.nextCheckAt),
      lastMonitorResult: row.lastMonitorResult ? String(row.lastMonitorResult) : null,
      lastMonitorError: row.lastMonitorError ? String(row.lastMonitorError) : null,
      lastPageHash: row.lastPageHash ? String(row.lastPageHash) : null,
      lastAlertSentAt: toNullableDate(row.lastAlertSentAt),
      requiredWords: row.requiredWords ? String(row.requiredWords) : null,
      ignoreWords: row.ignoreWords ? String(row.ignoreWords) : null,
      pendingAlertStatus: row.pendingAlertStatus ? String(row.pendingAlertStatus) : null,
      pendingAlertPrice:
        row.pendingAlertPrice === null || row.pendingAlertPrice === undefined ? null : Number(row.pendingAlertPrice),
      pendingAlertPageHash: row.pendingAlertPageHash ? String(row.pendingAlertPageHash) : null,
      pendingAlertCount: row.pendingAlertCount === undefined ? 0 : Number(row.pendingAlertCount),
      pendingAlertReason: row.pendingAlertReason ? String(row.pendingAlertReason) : null,
      pendingAlertConfidence:
        row.pendingAlertConfidence === null || row.pendingAlertConfidence === undefined
          ? null
          : Number(row.pendingAlertConfidence),
      pendingAlertDetectedWords: row.pendingAlertDetectedWords ? String(row.pendingAlertDetectedWords) : null,
      pendingAlertAt: toNullableDate(row.pendingAlertAt),
      sealedResaleNotes: row.sealedResaleNotes ? String(row.sealedResaleNotes) : null,
      scarcityNotes: row.scarcityNotes ? String(row.scarcityNotes) : null,
      manualPriorityOverride: row.manualPriorityOverride ? String(row.manualPriorityOverride) : null,
      archivedAt: toNullableDate(row.archivedAt),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.productDiscoveryCandidate.createMany({
    data: rows(tables, "productDiscoveryCandidates").map((row) => ({
      id: String(row.id),
      sourceId: String(row.sourceId),
      retailerId: String(row.retailerId),
      url: String(row.url),
      finalUrl: row.finalUrl ? String(row.finalUrl) : null,
      productName: String(row.productName),
      productType: row.productType ? String(row.productType) : null,
      retailerProductId: row.retailerProductId ? String(row.retailerProductId) : null,
      imageUrl: row.imageUrl ? String(row.imageUrl) : null,
      livePrice: row.livePrice === null || row.livePrice === undefined ? null : Number(row.livePrice),
      stockStatus: row.stockStatus ? String(row.stockStatus) : null,
      confidenceScore: row.confidenceScore === undefined ? 50 : Number(row.confidenceScore),
      reason: row.reason ? String(row.reason) : null,
      status: row.status ? String(row.status) : "PENDING",
      approvedProductId: row.approvedProductId ? String(row.approvedProductId) : null,
      reviewedAt: toNullableDate(row.reviewedAt),
      ignoredAt: toNullableDate(row.ignoredAt),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.store.createMany({
    data: rows(tables, "stores").map((row) => ({
      id: String(row.id),
      retailerId: String(row.retailerId),
      storeName: String(row.storeName),
      address: String(row.address),
      city: String(row.city),
      state: String(row.state),
      zone: row.zone ? String(row.zone) : "MIAMI",
      latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
      notes: row.notes ? String(row.notes) : null,
      typicalRestockDays: String(row.typicalRestockDays),
      typicalRestockTimeWindow: String(row.typicalRestockTimeWindow),
      vendorNotes: row.vendorNotes ? String(row.vendorNotes) : null,
      confidenceScore: Number(row.confidenceScore),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.userStorePreference.createMany({
    data: rows(tables, "storePreferences").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      storeId: String(row.storeId),
      favorite: row.favorite === undefined ? false : Boolean(row.favorite),
      hidden: row.hidden === undefined ? false : Boolean(row.hidden),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.storeSighting.createMany({
    data: rows(tables, "storeSightings").map((row) => ({
      id: String(row.id),
      storeId: String(row.storeId),
      userId: String(row.userId),
      productSeen: String(row.productSeen),
      resultType: row.resultType ? String(row.resultType) : "stock_seen",
      seenAt: toDate(row.seenAt),
      quantityEstimate: String(row.quantityEstimate),
      shelfPhotoUrl: row.shelfPhotoUrl ? String(row.shelfPhotoUrl) : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.card.createMany({
    data: rows(tables, "cards").map((row) => ({
      id: String(row.id),
      releaseId: row.releaseId ? String(row.releaseId) : null,
      cardName: String(row.cardName),
      setName: String(row.setName),
      cardNumber: String(row.cardNumber),
      rarity: String(row.rarity),
      rawAveragePrice: Number(row.rawAveragePrice),
      psa9AverageSalePrice: Number(row.psa9AverageSalePrice),
      psa10AverageSalePrice: Number(row.psa10AverageSalePrice),
      bgs95AverageSalePrice: row.bgs95AverageSalePrice === undefined ? 0 : Number(row.bgs95AverageSalePrice),
      bgs10AverageSalePrice: row.bgs10AverageSalePrice === undefined ? 0 : Number(row.bgs10AverageSalePrice),
      bgsBlackLabelAverageSalePrice:
        row.bgsBlackLabelAverageSalePrice === undefined ? 0 : Number(row.bgsBlackLabelAverageSalePrice),
      estimatedEbayFee: Number(row.estimatedEbayFee),
      estimatedGradingCost: Number(row.estimatedGradingCost),
      estimatedShippingCost: row.estimatedShippingCost === undefined ? 5 : Number(row.estimatedShippingCost),
      minimumProfitTarget: row.minimumProfitTarget === undefined ? 20 : Number(row.minimumProfitTarget),
      psa9EstimatedProfit: Number(row.psa9EstimatedProfit),
      psa10EstimatedProfit: Number(row.psa10EstimatedProfit),
      bgs10EstimatedProfit: row.bgs10EstimatedProfit === undefined ? 0 : Number(row.bgs10EstimatedProfit),
      blackLabelEstimatedProfit:
        row.blackLabelEstimatedProfit === undefined ? 0 : Number(row.blackLabelEstimatedProfit),
      maxRawBuyPricePsa9: Number(row.maxRawBuyPricePsa9),
      maxRawBuyPrice:
        row.maxRawBuyPrice === undefined ? Number(row.maxRawBuyPricePsa9 ?? 0) : Number(row.maxRawBuyPrice),
      top10Score: row.top10Score === undefined ? 0 : Number(row.top10Score),
      compConfidenceScore: row.compConfidenceScore === undefined ? 0 : Number(row.compConfidenceScore),
      rating: String(row.rating),
      dataSource: String(row.dataSource),
      lastRefreshed: toDate(row.lastRefreshed),
      notes: row.notes ? String(row.notes) : null,
      characterName: row.characterName ? String(row.characterName) : null,
      era: row.era ? String(row.era) : "MODERN",
      lowPop: Boolean(row.lowPop),
      newRelease: Boolean(row.newRelease),
      lowNumberedSerialized: Boolean(row.lowNumberedSerialized),
      strongCharacterDemand: Boolean(row.strongCharacterDemand),
      ebayIncludeWords: row.ebayIncludeWords ? String(row.ebayIncludeWords) : null,
      ebayExcludeWords: row.ebayExcludeWords ? String(row.ebayExcludeWords) : null,
      ebayExactSetName: row.ebayExactSetName === undefined ? true : Boolean(row.ebayExactSetName),
      ebayCardNumberRequired: row.ebayCardNumberRequired === undefined ? true : Boolean(row.ebayCardNumberRequired),
      ebayRawKeywords: row.ebayRawKeywords ? String(row.ebayRawKeywords) : null,
      ebayPsa9Keywords: row.ebayPsa9Keywords ? String(row.ebayPsa9Keywords) : null,
      ebayPsa10Keywords: row.ebayPsa10Keywords ? String(row.ebayPsa10Keywords) : null,
      ebayAllowNonEnglish: row.ebayAllowNonEnglish === undefined ? false : Boolean(row.ebayAllowNonEnglish),
      lastCompAt: toNullableDate(row.lastCompAt),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.alert.createMany({
    data: rows(tables, "alerts").map((row) => ({
      id: String(row.id),
      title: String(row.title),
      reason: String(row.reason),
      priority: String(row.priority),
      timestamp: toDate(row.timestamp),
      entityType: String(row.entityType),
      entityId: row.entityId ? String(row.entityId) : null,
      actionUrl: row.actionUrl ? String(row.actionUrl) : null,
      read: Boolean(row.read),
      score: row.score === undefined ? 50 : Number(row.score),
      dedupeKey: row.dedupeKey ? String(row.dedupeKey) : null,
      explanation: row.explanation ? String(row.explanation) : null,
      falsePositiveAt: toNullableDate(row.falsePositiveAt),
      suppressedAt: toNullableDate(row.suppressedAt),
      cooldownUntil: toNullableDate(row.cooldownUntil),
      productId: row.productId ? String(row.productId) : null,
      userId: row.userId ? String(row.userId) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.monitorLog.createMany({
    data: rows(tables, "monitorLogs").map((row) => ({
      id: String(row.id),
      productId: row.productId ? String(row.productId) : null,
      runType: String(row.runType),
      status: String(row.status),
      previousStatus: row.previousStatus ? String(row.previousStatus) : null,
      detectedStatus: row.detectedStatus ? String(row.detectedStatus) : null,
      previousPrice: row.previousPrice === null || row.previousPrice === undefined ? null : Number(row.previousPrice),
      detectedPrice: row.detectedPrice === null || row.detectedPrice === undefined ? null : Number(row.detectedPrice),
      changeSummary: row.changeSummary ? String(row.changeSummary) : null,
      httpStatus: row.httpStatus === null || row.httpStatus === undefined ? null : Number(row.httpStatus),
      finalUrl: row.finalUrl ? String(row.finalUrl) : null,
      responseTimeMs: row.responseTimeMs === null || row.responseTimeMs === undefined ? null : Number(row.responseTimeMs),
      detectedWords: row.detectedWords ? String(row.detectedWords) : null,
      confidenceScore: row.confidenceScore === null || row.confidenceScore === undefined ? null : Number(row.confidenceScore),
      reason: row.reason ? String(row.reason) : null,
      blockedType: row.blockedType ? String(row.blockedType) : null,
      pageHash: row.pageHash ? String(row.pageHash) : null,
      startedAt: toDate(row.startedAt),
      finishedAt: toNullableDate(row.finishedAt),
      durationMs: row.durationMs === null || row.durationMs === undefined ? null : Number(row.durationMs),
      error: row.error ? String(row.error) : null,
      alertSent: Boolean(row.alertSent),
      notificationSummary: row.notificationSummary ? String(row.notificationSummary) : null
    }))
  });
  await prisma.restockHistory.createMany({
    data: rows(tables, "restockHistory").map((row) => ({
      id: String(row.id),
      productId: String(row.productId),
      status: String(row.status),
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      snapshotReason: String(row.snapshotReason),
      checkedAt: toDate(row.checkedAt)
    }))
  });
  await prisma.cardPriceSnapshot.createMany({
    data: rows(tables, "cardPriceSnapshots").map((row) => ({
      id: String(row.id),
      cardId: String(row.cardId),
      rawAveragePrice: Number(row.rawAveragePrice),
      psa9AverageSalePrice: Number(row.psa9AverageSalePrice),
      psa10AverageSalePrice: Number(row.psa10AverageSalePrice),
      bgs95AverageSalePrice: row.bgs95AverageSalePrice === undefined ? 0 : Number(row.bgs95AverageSalePrice),
      bgs10AverageSalePrice: row.bgs10AverageSalePrice === undefined ? 0 : Number(row.bgs10AverageSalePrice),
      bgsBlackLabelAverageSalePrice:
        row.bgsBlackLabelAverageSalePrice === undefined ? 0 : Number(row.bgsBlackLabelAverageSalePrice),
      psa9EstimatedProfit: Number(row.psa9EstimatedProfit),
      psa10EstimatedProfit: Number(row.psa10EstimatedProfit),
      bgs10EstimatedProfit: row.bgs10EstimatedProfit === undefined ? 0 : Number(row.bgs10EstimatedProfit),
      blackLabelEstimatedProfit:
        row.blackLabelEstimatedProfit === undefined ? 0 : Number(row.blackLabelEstimatedProfit),
      maxRawBuyPrice: row.maxRawBuyPrice === undefined ? 0 : Number(row.maxRawBuyPrice),
      top10Score: row.top10Score === undefined ? 0 : Number(row.top10Score),
      rating: String(row.rating),
      snapshotAt: toDate(row.snapshotAt)
    }))
  });
  await prisma.cardCompSale.createMany({
    data: rows(tables, "cardCompSales").map((row) => ({
      id: String(row.id),
      cardId: String(row.cardId),
      source: String(row.source),
      sourceQuality: row.sourceQuality ? String(row.sourceQuality) : "EBAY_SOLD",
      salePrice: Number(row.salePrice),
      grade: String(row.grade),
      gradeType: row.gradeType ? String(row.gradeType) : String(row.grade ?? "RAW"),
      soldAt: toDate(row.soldAt),
      url: row.url ? String(row.url) : null,
      sourceUrl: row.sourceUrl ? String(row.sourceUrl) : row.url ? String(row.url) : null,
      saleTitle: row.saleTitle ? String(row.saleTitle) : null,
      matchScore: row.matchScore === undefined ? 0 : Number(row.matchScore),
      notes: row.notes ? String(row.notes) : null,
      conditionNotes: row.conditionNotes ? String(row.conditionNotes) : row.notes ? String(row.notes) : null,
      reviewStatus: row.reviewStatus ? String(row.reviewStatus) : "ACCEPTED",
      rejectedAt: toNullableDate(row.rejectedAt),
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.inventoryItem.createMany({
    data: rows(tables, "inventoryItems").map((row) => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : null,
      itemType: String(row.itemType),
      itemName: String(row.itemName),
      category: row.category ? String(row.category) : "sealed_packs",
      setName: row.setName ? String(row.setName) : null,
      productId: row.productId ? String(row.productId) : null,
      cardId: row.cardId ? String(row.cardId) : null,
      cost: Number(row.cost),
      quantity: row.quantity === undefined ? 1 : Number(row.quantity),
      totalCost: row.totalCost === null || row.totalCost === undefined ? null : Number(row.totalCost),
      purchaseExtraCost: row.purchaseExtraCost === null || row.purchaseExtraCost === undefined ? null : Number(row.purchaseExtraCost),
      source: String(row.source),
      retailer: row.retailer ? String(row.retailer) : null,
      purchasedAt: toDate(row.purchasedAt),
      receiptNumber: row.receiptNumber ? String(row.receiptNumber) : null,
      receiptImageUrl: row.receiptImageUrl ? String(row.receiptImageUrl) : null,
      orderNumber: row.orderNumber ? String(row.orderNumber) : null,
      transactionId: row.transactionId ? String(row.transactionId) : null,
      sourceStore: row.sourceStore ? String(row.sourceStore) : null,
      paymentMethod: row.paymentMethod ? String(row.paymentMethod) : null,
      exactProductUrl: row.exactProductUrl ? String(row.exactProductUrl) : null,
      upc: row.upc ? String(row.upc) : null,
      sku: row.sku ? String(row.sku) : null,
      dpci: row.dpci ? String(row.dpci) : null,
      asin: row.asin ? String(row.asin) : null,
      imageUrl: row.imageUrl ? String(row.imageUrl) : null,
      condition: row.condition ? String(row.condition) : null,
      itemStatus: row.itemStatus ? String(row.itemStatus) : "sealed",
      targetSellPrice: row.targetSellPrice === null || row.targetSellPrice === undefined ? null : Number(row.targetSellPrice),
      minimumAcceptablePrice:
        row.minimumAcceptablePrice === null || row.minimumAcceptablePrice === undefined ? null : Number(row.minimumAcceptablePrice),
      listingPlatform: row.listingPlatform ? String(row.listingPlatform) : null,
      listingStatus: row.listingStatus ? String(row.listingStatus) : "not_listed",
      soldPrice: row.soldPrice === null || row.soldPrice === undefined ? null : Number(row.soldPrice),
      soldAt: toNullableDate(row.soldAt),
      buyerPlatform: row.buyerPlatform ? String(row.buyerPlatform) : null,
      currentMarketEstimate:
        row.currentMarketEstimate === null || row.currentMarketEstimate === undefined ? null : Number(row.currentMarketEstimate),
      marketAverageSalePrice:
        row.marketAverageSalePrice === null || row.marketAverageSalePrice === undefined ? null : Number(row.marketAverageSalePrice),
      marketCompCount: row.marketCompCount === undefined ? 0 : Number(row.marketCompCount),
      marketLastRefreshedAt: toNullableDate(row.marketLastRefreshedAt),
      marketConfidence: row.marketConfidence ? String(row.marketConfidence) : "LOW",
      estimatedEbayFee: row.estimatedEbayFee === null || row.estimatedEbayFee === undefined ? null : Number(row.estimatedEbayFee),
      estimatedShippingCost:
        row.estimatedShippingCost === null || row.estimatedShippingCost === undefined ? null : Number(row.estimatedShippingCost),
      estimatedNetProfit:
        row.estimatedNetProfit === null || row.estimatedNetProfit === undefined ? null : Number(row.estimatedNetProfit),
      roiPercent: row.roiPercent === null || row.roiPercent === undefined ? null : Number(row.roiPercent),
      recommendedAction: row.recommendedAction ? String(row.recommendedAction) : "HOLD",
      recommendationReason: row.recommendationReason ? String(row.recommendationReason) : null,
      netProfitAfterFees: row.netProfitAfterFees === null || row.netProfitAfterFees === undefined ? null : Number(row.netProfitAfterFees),
      expectedPlan: row.expectedPlan ? String(row.expectedPlan) : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.inventoryStockLot.createMany({
    data: rows(tables, "inventoryStockLots").map((row) => ({
      id: String(row.id),
      inventoryItemId: String(row.inventoryItemId),
      purchasedAt: toDate(row.purchasedAt),
      source: String(row.source),
      quantity: Number(row.quantity),
      costPerUnit: Number(row.costPerUnit),
      purchaseExtraCost: row.purchaseExtraCost === null || row.purchaseExtraCost === undefined ? null : Number(row.purchaseExtraCost),
      totalCost: Number(row.totalCost),
      remainingQuantity: Number(row.remainingQuantity),
      notes: row.notes ? String(row.notes) : null,
      receiptNumber: row.receiptNumber ? String(row.receiptNumber) : null,
      receiptImageUrl: row.receiptImageUrl ? String(row.receiptImageUrl) : null,
      orderNumber: row.orderNumber ? String(row.orderNumber) : null,
      transactionId: row.transactionId ? String(row.transactionId) : null,
      sourceStore: row.sourceStore ? String(row.sourceStore) : null,
      paymentMethod: row.paymentMethod ? String(row.paymentMethod) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.inventorySale.createMany({
    data: rows(tables, "inventorySales").map((row) => ({
      id: String(row.id),
      inventoryItemId: String(row.inventoryItemId),
      userId: row.userId ? String(row.userId) : null,
      quantitySold: Number(row.quantitySold),
      soldPricePerItem: Number(row.soldPricePerItem),
      grossSale: Number(row.grossSale),
      platform: String(row.platform),
      fees: row.fees === undefined ? 0 : Number(row.fees),
      shippingCost: row.shippingCost === undefined ? 0 : Number(row.shippingCost),
      netSale: Number(row.netSale),
      costBasis: Number(row.costBasis),
      profitLoss: Number(row.profitLoss),
      roiPercent: row.roiPercent === null || row.roiPercent === undefined ? null : Number(row.roiPercent),
      soldAt: toDate(row.soldAt),
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.inventoryMarketComp.createMany({
    data: rows(tables, "inventoryMarketComps").map((row) => ({
      id: String(row.id),
      inventoryItemId: String(row.inventoryItemId),
      saleTitle: String(row.saleTitle),
      salePrice: Number(row.salePrice),
      soldAt: toDate(row.soldAt),
      sourceUrl: row.sourceUrl ? String(row.sourceUrl) : null,
      sourceQuality: row.sourceQuality ? String(row.sourceQuality) : "EBAY_SOLD",
      matchScore: row.matchScore === undefined ? 0 : Number(row.matchScore),
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.barcodeScan.createMany({
    data: rows(tables, "barcodeScans").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      upc: String(row.upc),
      source: row.source ? String(row.source) : "manual",
      status: row.status ? String(row.status) : "LOOKUP_FAILED",
      resultType: row.resultType ? String(row.resultType) : "manual",
      productId: row.productId ? String(row.productId) : null,
      inventoryItemId: row.inventoryItemId ? String(row.inventoryItemId) : null,
      productName: row.productName ? String(row.productName) : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.dailyRecap.createMany({
    data: rows(tables, "dailyRecaps").map((row) => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : null,
      recapDate: toDate(row.recapDate),
      summary: String(row.summary),
      productChecks: row.productChecks === undefined ? 0 : Number(row.productChecks),
      storeVisits: row.storeVisits === undefined ? 0 : Number(row.storeVisits),
      purchases: row.purchases === undefined ? 0 : Number(row.purchases),
      alertsCreated: row.alertsCreated === undefined ? 0 : Number(row.alertsCreated),
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.savedFilterPreset.createMany({
    data: rows(tables, "savedFilterPresets").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      name: String(row.name),
      section: String(row.section),
      filters: String(row.filters),
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.productPriorityScore.createMany({
    data: rows(tables, "productPriorityScores").map((row) => ({
      id: String(row.id),
      productId: String(row.productId),
      releaseId: row.releaseId ? String(row.releaseId) : null,
      buyWatchSkip: String(row.buyWatchSkip),
      score: Number(row.score),
      retailPriceScore: Number(row.retailPriceScore),
      resaleDemandScore: Number(row.resaleDemandScore),
      setPopularityScore: Number(row.setPopularityScore),
      scarcityScore: Number(row.scarcityScore),
      chaseCardScore: Number(row.chaseCardScore),
      sealedValueScore: Number(row.sealedValueScore),
      cardInvestmentScore: Number(row.cardInvestmentScore),
      profitablePsa9Count: row.profitablePsa9Count === undefined ? 0 : Number(row.profitablePsa9Count),
      psa10Upside: row.psa10Upside === undefined ? 0 : Number(row.psa10Upside),
      manualOverride: row.manualOverride ? String(row.manualOverride) : null,
      reason: row.reason ? String(row.reason) : null,
      userNotes: row.userNotes ? String(row.userNotes) : null,
      computedAt: toDate(row.computedAt)
    }))
  });
  await prisma.notificationSettings.createMany({
    data: rows(tables, "notificationSettings").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      inApp: Boolean(row.inApp),
      sms: Boolean(row.sms),
      email: Boolean(row.email),
      browserPush: Boolean(row.browserPush),
      phone: row.phone ? String(row.phone) : null,
      emailTo: row.emailTo ? String(row.emailTo) : null,
      quietHoursStart: row.quietHoursStart ? String(row.quietHoursStart) : null,
      quietHoursEnd: row.quietHoursEnd ? String(row.quietHoursEnd) : null,
      minimumPriority: row.minimumPriority ? String(row.minimumPriority) : "LOW",
      alertDigestMode: row.alertDigestMode === undefined ? false : Boolean(row.alertDigestMode),
      urgentOnlyMode: row.urgentOnlyMode === undefined ? false : Boolean(row.urgentOnlyMode),
      highPriorityOverride: row.highPriorityOverride === undefined ? true : Boolean(row.highPriorityOverride),
      watchedRetailers: row.watchedRetailers ? String(row.watchedRetailers) : null,
      watchedProducts: row.watchedProducts ? String(row.watchedProducts) : null,
      alertCooldownMinutes: row.alertCooldownMinutes === undefined ? 30 : Number(row.alertCooldownMinutes),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.browserPushSubscription.createMany({
    data: rows(tables, "browserPushSubscriptions").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      endpoint: String(row.endpoint),
      p256dh: String(row.p256dh),
      auth: String(row.auth),
      userAgent: row.userAgent ? String(row.userAgent) : null,
      disabledAt: toNullableDate(row.disabledAt),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.investmentSettings.createMany({
    data: rows(tables, "investmentSettings").map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      gradingCost: row.gradingCost === undefined ? 20 : Number(row.gradingCost),
      ebaySellingFee: row.ebaySellingFee === undefined ? 0.1325 : Number(row.ebaySellingFee),
      shippingCost: row.shippingCost === undefined ? 5 : Number(row.shippingCost),
      minimumProfitTarget: row.minimumProfitTarget === undefined ? 20 : Number(row.minimumProfitTarget),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt)
    }))
  });
  await prisma.investmentReport.createMany({
    data: rows(tables, "investmentReports").map((row) => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : null,
      title: String(row.title),
      generatedAt: toDate(row.generatedAt),
      periodStart: toDate(row.periodStart),
      periodEnd: toDate(row.periodEnd),
      top10RawToGrade: toJsonText(row.top10RawToGrade, "[]"),
      safestPsa9Flips: toJsonText(row.safestPsa9Flips, "[]"),
      highestPsa10Upside: toJsonText(row.highestPsa10Upside, "[]"),
      beckettCandidates: toJsonText(row.beckettCandidates, "[]"),
      avoidOverpriced: toJsonText(row.avoidOverpriced, "[]"),
      bestBuy: toJsonText(row.bestBuy, "null"),
      riskiestBuy: toJsonText(row.riskiestBuy, "null"),
      bestUnder25Raw: toJsonText(row.bestUnder25Raw, "null"),
      bestPremiumCard: toJsonText(row.bestPremiumCard, "null"),
      notes: row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });

  return { ok: true };
}
