import { Prisma } from "@prisma/client";
import { listAccessOverview } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getAppHealth } from "@/lib/health";
import { deliverAlert, notificationSummary } from "@/lib/notifications";
import { retailerTemplates, validateRetailerUrl } from "@/lib/retailer-templates";
import { productCreateSchema, releaseCreateSchema, storeCreateSchema } from "@/lib/validation";
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
  DailyRecapDTO,
  MonitorAccuracyStatsDTO,
  MonitorLogDTO,
  NotificationSettingsDTO,
  OwnerLaunchChecklistItemDTO,
  Priority,
  ProductDTO,
  ProductPriorityScoreDTO,
  ProductVerificationStatus,
  ProductStatus,
  Rating,
  ReleaseDTO,
  RetailerDTO,
  SavedFilterPresetDTO,
  SetupChecklistItemDTO,
  SessionUser,
  SightingDTO,
  AlertCalibrationItemDTO,
  StoreDTO,
  StoreVisitResult,
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
  compSales: { select: { soldAt: true, sourceQuality: true, gradeType: true, salePrice: true } }
} satisfies Prisma.CardInclude;

const compSaleInclude = {
  card: { select: { cardName: true, setName: true, cardNumber: true } }
} satisfies Prisma.CardCompSaleInclude;

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
  const compCount = card.compSales.length;
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
    lastCompAt: card.lastCompAt?.toISOString() ?? null,
    compCount,
    recentCompCount: recentCompCount(card.compSales)
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

function inventoryItemToDTO(item: Prisma.InventoryItemGetPayload<Record<string, never>>): InventoryItemDTO {
  return {
    id: item.id,
    itemType: item.itemType,
    itemName: item.itemName,
    productId: item.productId,
    cardId: item.cardId,
    cost: item.cost,
    quantity: item.quantity,
    source: item.source,
    purchasedAt: item.purchasedAt.toISOString(),
    expectedPlan: item.expectedPlan,
    notes: item.notes,
    createdAt: item.createdAt.toISOString()
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
    conditionNotes: sale.conditionNotes || sale.notes
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
    if (!score || score.score < 70 || !["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product.stockStatus)) {
      continue;
    }
    await createAlertOnce({
      title: `High-priority chase live: ${product.name}`,
      reason: score.reason,
      priority: "HIGH",
      entityType: "PRODUCT",
      entityId: product.id,
      productId: product.id,
      actionUrl: product.url
    });
  }
  return scores;
}

export async function listDashboard(currentUser: SessionUser): Promise<DashboardDTO> {
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
    dailyRecaps,
    savedFilterPresets,
    storePreferences
  ] =
    await Promise.all([
    prisma.retailer.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({ include: productInclude, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }] }),
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
      orderBy: { purchasedAt: "desc" },
      take: 40
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
    prisma.userStorePreference.findMany({ where: { userId: currentUser.id } })
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
          (store.distanceMiles !== null ? store.distanceMiles <= 50 : store.zone === preferredZone))
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
  const setup = setupChecklist({
    productCount: productDTOs.length,
    storeCount: storeDTOs.length,
    releaseCount: releaseDTOs.length,
    externalAlertsConfigured:
      notificationSettingsDTO.browserPush || notificationSettingsDTO.email || notificationSettingsDTO.sms,
    monitorRunCount: monitorLogs.length
  });
  const qualityWarnings = dataQualityWarnings({ products: productDTOs, notificationSettings: notificationSettingsDTO });
  const monitorLogDTOs = monitorLogs.map(monitorLogToDTO);
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
    inventory: inventory.map(inventoryItemToDTO),
    users: accessOverview.users
  });
  const calibrationQueue = alertCalibrationItems({
    products: productDTOs,
    monitorLogs: monitorLogDTOs,
    alerts: alertDTOs
  });

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
    inventory: inventory.map(inventoryItemToDTO),
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
    alerts: alertDTOs,
    monitorLogs: monitorLogDTOs,
    monitorAccuracyStats: accuracyStats,
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
      lastSuccessfulCheckedAt: new Date(),
      lastCheckedAt: new Date(),
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

export async function updateProductManualStatus(
  productId: string,
  input: {
    name: string;
    retailerId: string;
    releaseId?: string;
    setName?: string;
    productType?: string;
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

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      name: input.name,
      retailerId: input.retailerId,
      releaseId: input.releaseId ?? null,
      setName: input.setName,
      productType: input.productType,
      url: input.url,
      sku: input.sku,
      upc: input.upc,
      dpci: input.dpci,
      retailerProductId: input.retailerProductId,
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
      )
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
    ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE", "PRICE_CHANGE", "PAGE_UPDATED"].includes(input.stockStatus);

  if (alertWorthy) {
    await prisma.alert.create({
      data: {
        title: `${product.name}: ${input.stockStatus.replaceAll("_", " ").toLowerCase()}`,
        reason: input.reason || `Manual status changed from ${before.stockStatus} to ${input.stockStatus}.`,
        priority: input.priority,
        entityType: "PRODUCT",
        entityId: product.id,
        productId: product.id,
        actionUrl: product.url
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

function htmlIncludesIdentifier(html: string, value: string | null | undefined) {
  if (!value) return false;
  return html.toLowerCase().includes(value.trim().toLowerCase());
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
    const upcMatched = htmlIncludesIdentifier(html, product.upc);
    const skuMatched = htmlIncludesIdentifier(html, product.sku);
    const dpciMatched = htmlIncludesIdentifier(html, product.dpci);
    const retailerProductMatched = htmlIncludesIdentifier(html, product.retailerProductId) || finalUrl.includes(product.retailerProductId || "\u0000");
    const titleMatched = product.name
      .toLowerCase()
      .split(/\s+/)
      .filter((part) => part.length > 4)
      .slice(0, 4)
      .filter((part) => html.toLowerCase().includes(part)).length;
    const redirectedAway = !sameRetailerHost;
    const likelyMismatch =
      redirectedAway ||
      (!upcMatched && !skuMatched && !dpciMatched && !retailerProductMatched && titleMatched < 2) ||
      [404, 410].includes(response.status);
    const verificationStatus: ProductVerificationStatus = likelyMismatch
      ? "POSSIBLE_MISMATCH"
      : upcMatched
        ? "UPC_MATCHED"
        : "VERIFIED_URL";
    const notes = [
      `HTTP ${response.status}`,
      `Final URL ${finalUrl}`,
      `Response ${Date.now() - started}ms`,
      upcMatched ? "UPC matched in public page content" : "UPC not found",
      skuMatched ? "SKU matched" : null,
      dpciMatched ? "DPCI matched" : null,
      retailerProductMatched ? "Retailer product ID matched" : null,
      redirectedAway ? "Warning: final URL host differs from tracked URL host" : null,
      likelyMismatch ? "Review this link before trusting alerts." : "Exact product page looks usable for manual checkout."
    ]
      .filter(Boolean)
      .join(". ");

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        verificationStatus,
        verifiedAt: new Date(),
        verifiedFinalUrl: finalUrl,
        verificationNotes: notes,
        lastCheckedAt: new Date(),
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

export async function createInventoryItem(
  currentUser: SessionUser,
  input: {
    itemType: string;
    itemName: string;
    productId?: string;
    cardId?: string;
    cost: number;
    quantity: number;
    source: string;
    purchasedAt: Date;
    expectedPlan?: string;
    notes?: string;
  }
) {
  const item = await prisma.inventoryItem.create({
    data: {
      userId: currentUser.id,
      itemType: input.itemType,
      itemName: input.itemName,
      productId: input.productId,
      cardId: input.cardId,
      cost: input.cost,
      quantity: input.quantity,
      source: input.source,
      purchasedAt: input.purchasedAt,
      expectedPlan: input.expectedPlan,
      notes: input.notes
    }
  });
  return inventoryItemToDTO(item);
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
    productId: product.id,
    cost: input.cost ?? product.retailPrice ?? 0,
    quantity: input.quantity,
    source: input.source || product.retailer.name,
    purchasedAt: new Date(),
    expectedPlan: input.expectedPlan || "Hold sealed, review comps before resale.",
    notes: input.notes
  });
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
    const delivery = await deliverAlert({
      title: `Forced alert: ${product.name}`,
      reason:
        input.reason ||
        `Admin forced a manual alert for ${product.name}. Go opens only the official ${product.retailer.name} page.`,
      priority: product.priority as Priority,
      entityType: "PRODUCT",
      entityId: product.id,
      productId: product.id,
      actionUrl: product.url
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
        finalUrl: product.url,
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
      const input = storeCreateSchema.parse({
        retailerId: await retailerIdFromRow(row, retailers),
        storeName: textFromRow(row, "storeName", "name"),
        address: textFromRow(row, "address"),
        city: textFromRow(row, "city"),
        state: textFromRow(row, "state"),
        zone: (textFromRow(row, "zone", "region") || "MIAMI").toUpperCase(),
        latitude: numberFromRow(row, "latitude", "lat"),
        longitude: numberFromRow(row, "longitude", "lng", "lon"),
        typicalRestockDays: textFromRow(row, "typicalRestockDays", "restockDays"),
        typicalRestockTimeWindow: textFromRow(row, "typicalRestockTimeWindow", "restockWindow"),
        vendorNotes: textFromRow(row, "vendorNotes"),
        confidenceScore: numberFromRow(row, "confidenceScore", "confidence") ?? 50,
        notes: textFromRow(row, "notes")
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
        orderBy: { soldAt: "desc" },
        select: { gradeType: true, salePrice: true, soldAt: true, sourceQuality: true }
      }
    }
  });
  if (!card) throw new Error("Card not found");

  const compsByGrade = (gradeType: GradeType) =>
    card.compSales.filter((sale) => ((sale.gradeType || "RAW") as GradeType) === gradeType).map((sale) => sale.salePrice);

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
      dataSource: compCount ? "Manual sold comps" : card.dataSource,
      lastCompAt: card.compSales[0]?.soldAt ?? card.lastCompAt,
      lastRefreshed: new Date()
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
    strongCharacterDemand: input.strongCharacterDemand ?? false
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
    strongCharacterDemand: input.strongCharacterDemand ?? existing.strongCharacterDemand
  };
  const compSales = await prisma.cardCompSale.findMany({ where: { cardId }, select: { soldAt: true, sourceQuality: true } });
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
        lastRefreshed: new Date(),
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
  await prisma.monitorLog.deleteMany();
  await prisma.investmentReport.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.friendInvite.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.savedFilterPreset.deleteMany();
  await prisma.dailyRecap.deleteMany();
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
      url: "https://www.target.com/p/pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle/-/A-99900001",
      sku: "TARGET-BUNDLE",
      upc: "0820650990001",
      dpci: "087-12-0001",
      retailerProductId: "99900001",
      retailPrice: 26.99,
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

  const target = await createStore({
    retailerId: retailers.get("Target")!,
    storeName: "Target Midtown Miami",
    address: "3401 N Miami Ave",
    city: "Miami",
    state: "FL",
    zone: "MIAMI",
    latitude: 25.8072,
    longitude: -80.1937,
    typicalRestockDays: "Tuesday,Friday",
    typicalRestockTimeWindow: "8:00 AM - 11:00 AM",
    vendorNotes: "Card aisle usually touched after front lanes.",
    confidenceScore: 72,
    notes: "Demo store."
  });
  const walmart = await createStore({
    retailerId: retailers.get("Walmart")!,
    storeName: "Walmart Fort Lauderdale",
    address: "2500 W Broward Blvd",
    city: "Fort Lauderdale",
    state: "FL",
    zone: "FORT_LAUDERDALE",
    latitude: 26.1213,
    longitude: -80.1722,
    typicalRestockDays: "Wednesday,Saturday",
    typicalRestockTimeWindow: "10:00 AM - 1:00 PM",
    vendorNotes: "Vendor timing varies; sightings drive confidence.",
    confidenceScore: 58,
    notes: "Demo store."
  });

  await createSighting(admin.id, {
    storeId: target.id,
    productSeen: "Booster Bundle",
    resultType: "stock_seen",
    seenAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    quantityEstimate: "6-10",
    notes: "Demo shelf sighting."
  });
  await createSighting(admin.id, {
    storeId: walmart.id,
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
      sku: row.sku ? String(row.sku) : null,
      upc: row.upc ? String(row.upc) : null,
      dpci: row.dpci ? String(row.dpci) : null,
      retailerProductId: row.retailerProductId ? String(row.retailerProductId) : null,
      verificationStatus: row.verificationStatus ? String(row.verificationStatus) : "UNVERIFIED",
      verifiedAt: toNullableDate(row.verifiedAt),
      verifiedFinalUrl: row.verifiedFinalUrl ? String(row.verifiedFinalUrl) : null,
      verificationNotes: row.verificationNotes ? String(row.verificationNotes) : null,
      retailPrice: row.retailPrice === null || row.retailPrice === undefined ? null : Number(row.retailPrice),
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
      notes: row.notes ? String(row.notes) : null,
      conditionNotes: row.conditionNotes ? String(row.conditionNotes) : row.notes ? String(row.notes) : null,
      createdAt: toDate(row.createdAt)
    }))
  });
  await prisma.inventoryItem.createMany({
    data: rows(tables, "inventoryItems").map((row) => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : null,
      itemType: String(row.itemType),
      itemName: String(row.itemName),
      productId: row.productId ? String(row.productId) : null,
      cardId: row.cardId ? String(row.cardId) : null,
      cost: Number(row.cost),
      quantity: row.quantity === undefined ? 1 : Number(row.quantity),
      source: String(row.source),
      purchasedAt: toDate(row.purchasedAt),
      expectedPlan: row.expectedPlan ? String(row.expectedPlan) : null,
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
