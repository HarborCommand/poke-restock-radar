export type Role = "ADMIN" | "FRIEND";

export type ProductStatus =
  | "UNAVAILABLE"
  | "SOLD_OUT"
  | "PREORDER_LIVE"
  | "ADD_TO_CART_AVAILABLE"
  | "IN_STOCK"
  | "PRICE_CHANGE"
  | "PAGE_UPDATED";

export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type Rating = "BUY" | "WATCH" | "SKIP" | "AVOID";
export type Probability = "LOW" | "MEDIUM" | "HIGH";
export type MonitorLogStatus = "SUCCESS" | "CHANGED" | "SKIPPED" | "ERROR";
export type MonitorLogStatusExtended = MonitorLogStatus | "BLOCKED" | "PENDING_CONFIRMATION" | "FALSE_POSITIVE" | "FORCED_ALERT";
export type GradeType = "RAW" | "PSA_9" | "PSA_10" | "BGS_9_5" | "BGS_10" | "BGS_BLACK_LABEL";
export type CompSourceQuality = "EBAY_SOLD" | "PRICECHARTING" | "TCGPLAYER" | "MANUAL_ESTIMATE";
export type Era = "MODERN" | "VINTAGE";
export type StoreVisitResult = "stock_seen" | "empty_shelf" | "vendor_spotted" | "bought_product" | "no_visit";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type RetailerDTO = {
  id: string;
  name: string;
  website: string | null;
};

export type RetailerTemplateDTO = {
  retailerName: string;
  urlPattern: string;
  urlPatternLabel: string;
  statusWords: {
    inStock: string[];
    soldOut: string[];
    preorder: string[];
    addToCart: string[];
    unavailable: string[];
    pageBlocked: string[];
    captcha: string[];
    pageChanged: string[];
    price: string[];
  };
  safeSelectors: string[];
  identifierFields: string[];
  alertPriorityDefault: Priority;
  monitorNotes: string;
};

export type ProductDTO = {
  id: string;
  name: string;
  retailerId: string;
  retailerName: string;
  releaseId: string | null;
  releaseName: string | null;
  setName: string | null;
  productType: string | null;
  url: string;
  sku: string | null;
  upc: string | null;
  dpci: string | null;
  retailPrice: number | null;
  stockStatus: ProductStatus;
  alertStatus: boolean;
  priority: Priority;
  rating: Rating;
  notes: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulCheckedAt: string | null;
  monitorEnabled: boolean;
  checkFrequencyMinutes: number;
  nextCheckAt: string | null;
  lastMonitorResult: string | null;
  lastMonitorError: string | null;
  lastAlertSentAt: string | null;
  requiredWords: string | null;
  ignoreWords: string | null;
  pendingAlertStatus: string | null;
  pendingAlertCount: number;
  pendingAlertReason: string | null;
  pendingAlertConfidence: number | null;
  pendingAlertDetectedWords: string | null;
  pendingAlertAt: string | null;
  sealedResaleNotes: string | null;
  scarcityNotes: string | null;
  manualPriorityOverride: Rating | null;
  pokemonCenterExclusiveVersion: boolean;
  priorityScore: ProductPriorityScoreDTO | null;
  updatedAt: string;
};

export type StorePredictionDTO = {
  probability: Probability;
  likelyRestockWindow: string;
  nextLikelyRestockWindow: string;
  daysSinceLastConfirmedRestock: number | null;
  averageRestockIntervalDays: number | null;
  mostCommonRestockDays: string[];
  mostCommonRestockTimeWindows: string[];
  overdueScore: number;
  confidenceScore: number;
  sampleSize: number;
  isLikelyToday: boolean;
  reason: string;
};

export type StoreDTO = {
  id: string;
  retailerId: string;
  retailerName: string;
  storeName: string;
  address: string;
  city: string;
  state: string;
  notes: string | null;
  typicalRestockDays: string;
  typicalRestockTimeWindow: string;
  vendorNotes: string | null;
  confidenceScore: number;
  prediction: StorePredictionDTO;
};

export type SightingDTO = {
  id: string;
  storeId: string;
  userId: string;
  storeName: string;
  productSeen: string;
  resultType: StoreVisitResult;
  seenAt: string;
  quantityEstimate: string;
  shelfPhotoUrl: string | null;
  notes: string | null;
  userName: string;
};

export type ReleaseDTO = {
  id: string;
  setName: string;
  productType: string | null;
  officialReleaseDate: string;
  preorderDate: string | null;
  productTypes: string;
  pokemonCenterExclusiveVersion: boolean;
  chaseCards: string | null;
  demandRating: Priority;
  estimatedDemand: Priority;
  priority: Priority;
  sealedProductPriority: Priority;
  notes: string | null;
  productLinks: string | null;
  daysUntilRelease: number;
  daysUntilPreorder: number | null;
  productCount: number;
  cardCount: number;
  profitablePsa9Count: number;
  psa10Upside: number;
};

export type CardDTO = {
  id: string;
  releaseId: string | null;
  releaseName: string | null;
  cardName: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  rawAveragePrice: number;
  psa9AverageSalePrice: number;
  psa10AverageSalePrice: number;
  bgs95AverageSalePrice: number;
  bgs10AverageSalePrice: number;
  bgsBlackLabelAverageSalePrice: number;
  estimatedEbayFee: number;
  estimatedGradingCost: number;
  estimatedShippingCost: number;
  minimumProfitTarget: number;
  psa9EstimatedProfit: number;
  psa10EstimatedProfit: number;
  bgs10EstimatedProfit: number;
  blackLabelEstimatedProfit: number;
  maxRawBuyPricePsa9: number;
  maxRawBuyPrice: number;
  top10Score: number;
  compConfidenceScore: number;
  rating: Rating;
  dataSource: string;
  lastRefreshed: string;
  notes: string | null;
  characterName: string | null;
  era: Era;
  lowPop: boolean;
  newRelease: boolean;
  lowNumberedSerialized: boolean;
  strongCharacterDemand: boolean;
  lastCompAt: string | null;
  compCount: number;
  recentCompCount: number;
};

export type ProductPriorityScoreDTO = {
  buyWatchSkip: Rating;
  score: number;
  retailPriceScore: number;
  resaleDemandScore: number;
  setPopularityScore: number;
  scarcityScore: number;
  chaseCardScore: number;
  sealedValueScore: number;
  cardInvestmentScore: number;
  profitablePsa9Count: number;
  psa10Upside: number;
  manualOverride: Rating | null;
  reason: string;
  computedAt: string;
};

export type AlertDTO = {
  id: string;
  title: string;
  reason: string;
  priority: Priority;
  timestamp: string;
  entityType: string;
  entityId: string | null;
  actionUrl: string | null;
  read: boolean;
};

export type MonitorLogDTO = {
  id: string;
  productId: string | null;
  productName: string | null;
  runType: string;
  status: MonitorLogStatusExtended;
  previousStatus: string | null;
  detectedStatus: string | null;
  previousPrice: number | null;
  detectedPrice: number | null;
  changeSummary: string | null;
  httpStatus: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  alertSent: boolean;
  notificationSummary: string | null;
  finalUrl: string | null;
  responseTimeMs: number | null;
  detectedWords: string | null;
  confidenceScore: number | null;
  reason: string | null;
  blockedType: string | null;
};

export type MonitorAccuracyStatsDTO = {
  totalChecks: number;
  successfulChecks: number;
  blockedChecks: number;
  falsePositives: number;
  confirmedRestocks: number;
};

export type NotificationSettingsDTO = {
  id: string;
  inApp: boolean;
  email: boolean;
  sms: boolean;
  browserPush: boolean;
  phone: string | null;
  emailTo: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  minimumPriority: Priority;
};

export type AppHealthDTO = {
  status: "OK" | "WARN" | "ERROR";
  checkedAt: string;
  environment: {
    nodeEnv: string;
    appUrl: string | null;
    isVercel: boolean;
    coreMissing: string[];
    featureMissing: string[];
    warnings: string[];
  };
  database: {
    ok: boolean;
    provider: "postgres" | "sqlite" | "unknown";
    urlConfigured: boolean;
    productionSafe: boolean;
    error?: string;
  };
  monitor: {
    lastRunAt: string | null;
    lastStatus: string | null;
    lastSummary: string | null;
    lastError: string | null;
    dueProductCount: number;
    requestDelayMs: number;
    monitorJobSecretConfigured: boolean;
    vercelCronSecretConfigured: boolean;
  };
  alerts: {
    lastAlertAt: string | null;
    lastAlertTitle: string | null;
    lastAlertPriority: string | null;
    unreadCount: number;
  };
  providers: {
    cron: {
      monitorJobSecretConfigured: boolean;
      vercelCronSecretConfigured: boolean;
      requestDelayMs: number;
    };
    push: {
      configured: boolean;
      publicKeyConfigured: boolean;
      privateKeyConfigured: boolean;
      subjectConfigured: boolean;
    };
    email: {
      configured: boolean;
      smtpHostConfigured: boolean;
      smtpFromConfigured: boolean;
    };
    sms: {
      configured: boolean;
      accountSidConfigured: boolean;
      fromNumberConfigured: boolean;
    };
  };
};

export type SetupChecklistItemDTO = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  tab: "products" | "stores" | "releases" | "alerts";
};

export type DataQualityWarningDTO = {
  id: string;
  severity: Priority;
  title: string;
  detail: string;
  tab: "products" | "stores" | "releases" | "alerts";
  entityId?: string;
};

export type InvestmentSettingsDTO = {
  id: string;
  gradingCost: number;
  ebaySellingFee: number;
  shippingCost: number;
  minimumProfitTarget: number;
};

export type CardCompSaleDTO = {
  id: string;
  cardId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  gradeType: GradeType;
  salePrice: number;
  soldAt: string;
  source: string;
  sourceQuality: CompSourceQuality;
  sourceUrl: string | null;
  conditionNotes: string | null;
};

export type InvestmentReportItemDTO = {
  cardId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  rawAveragePrice: number;
  psa9AverageSalePrice: number;
  psa10AverageSalePrice: number;
  bgs10AverageSalePrice: number;
  psa9EstimatedProfit: number;
  psa10EstimatedProfit: number;
  bgs10EstimatedProfit: number;
  blackLabelEstimatedProfit: number;
  maxRawBuyPrice: number;
  rating: Rating;
  top10Score: number;
  compConfidenceScore: number;
  reason: string;
};

export type InvestmentReportDTO = {
  id: string;
  title: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  top10RawToGrade: InvestmentReportItemDTO[];
  safestPsa9Flips: InvestmentReportItemDTO[];
  highestPsa10Upside: InvestmentReportItemDTO[];
  beckettCandidates: InvestmentReportItemDTO[];
  avoidOverpriced: InvestmentReportItemDTO[];
  bestBuy: InvestmentReportItemDTO | null;
  riskiestBuy: InvestmentReportItemDTO | null;
  bestUnder25Raw: InvestmentReportItemDTO | null;
  bestPremiumCard: InvestmentReportItemDTO | null;
  notes: string | null;
};

export type DashboardDTO = {
  currentUser: SessionUser;
  retailers: RetailerDTO[];
  retailerTemplates: RetailerTemplateDTO[];
  products: ProductDTO[];
  todaysChaseList: ProductDTO[];
  stores: StoreDTO[];
  checkTodayStores: StoreDTO[];
  sightings: SightingDTO[];
  releases: ReleaseDTO[];
  releaseCountdowns: ReleaseDTO[];
  cards: CardDTO[];
  top10Watchlist: CardDTO[];
  cardCompSales: CardCompSaleDTO[];
  investmentReports: InvestmentReportDTO[];
  alerts: AlertDTO[];
  monitorLogs: MonitorLogDTO[];
  monitorAccuracyStats: MonitorAccuracyStatsDTO;
  notificationSettings: NotificationSettingsDTO;
  investmentSettings: InvestmentSettingsDTO;
  health: AppHealthDTO | null;
  setupChecklist: SetupChecklistItemDTO[];
  dataQualityWarnings: DataQualityWarningDTO[];
  stats: {
    actionableProducts: number;
    unreadAlerts: number;
    highProbabilityStores: number;
    profitablePsa10Cards: number;
  };
};
