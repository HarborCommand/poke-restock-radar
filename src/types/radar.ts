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
export type Zone = "MIAMI" | "FORT_LAUDERDALE" | "ORLANDO" | "TAMPA" | "JACKSONVILLE" | "CUSTOM";
export type ProductVerificationStatus =
  | "UNVERIFIED"
  | "VERIFIED_URL"
  | "UPC_MATCHED"
  | "VERIFIED_EXACT"
  | "SEARCH_OR_CATEGORY_LINK"
  | "POSSIBLE_MISMATCH"
  | "NEEDS_IDENTIFIERS";

export type UserPermissions = {
  canAddSightings: boolean;
  canAddComps: boolean;
  canRunChecks: boolean;
  canReceivePushAlerts: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionVersion?: number;
  preferredZone?: Zone;
  customZoneName?: string | null;
  hideDistantStores?: boolean;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  locationUpdatedAt?: string | null;
} & UserPermissions;

export type FriendUserDTO = SessionUser & {
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type FriendInviteDTO = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  canAddSightings: boolean;
  canAddComps: boolean;
  canRunChecks: boolean;
  canReceivePushAlerts: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  inviteUrl?: string;
};

export type AuditLogDTO = {
  id: string;
  userId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: string | null;
  createdAt: string;
};

export type DailyPlanDTO = {
  topProducts: ProductDTO[];
  storesToCheck: StoreDTO[];
  latestAlerts: AlertDTO[];
  newestReleases: ReleaseDTO[];
  bestCards: CardDTO[];
};

export type InventoryItemDTO = {
  id: string;
  itemType: string;
  itemName: string;
  category: string;
  setName: string | null;
  productId: string | null;
  linkedProductName: string | null;
  linkedProductRetailer: string | null;
  linkedProductLivePrice: number | null;
  linkedProductLiveStockStatus: ProductStatus | null;
  cardId: string | null;
  cost: number;
  quantity: number;
  quantityOwned: number;
  quantitySold: number;
  averageCost: number;
  totalCost: number;
  purchaseExtraCost: number | null;
  source: string;
  retailer: string | null;
  brand: string | null;
  description: string | null;
  manufacturer: string | null;
  model: string | null;
  msrp: number | null;
  purchasedAt: string;
  receiptNumber: string | null;
  receiptImageUrl: string | null;
  orderNumber: string | null;
  transactionId: string | null;
  sourceStore: string | null;
  paymentMethod: string | null;
  exactProductUrl: string | null;
  upc: string | null;
  sku: string | null;
  dpci: string | null;
  asin: string | null;
  imageUrl: string | null;
  condition: string | null;
  itemStatus: string;
  targetSellPrice: number | null;
  minimumAcceptablePrice: number | null;
  listingPlatform: string | null;
  listingStatus: string;
  soldPrice: number | null;
  soldAt: string | null;
  buyerPlatform: string | null;
  currentMarketEstimate: number | null;
  marketAverageSalePrice: number | null;
  marketLowestRecentComp: number | null;
  marketHighestRecentComp: number | null;
  marketAverageLast3: number | null;
  marketCompCount: number;
  marketLastRefreshedAt: string | null;
  marketConfidence: string;
  grossMarketValue: number | null;
  netMarketValue: number | null;
  marketProfitLoss: number | null;
  marketRoiPercent: number | null;
  estimatedEbayFee: number | null;
  estimatedShippingCost: number | null;
  estimatedNetProfit: number | null;
  roiPercent: number | null;
  recommendedAction: string;
  recommendationReason: string | null;
  netProfitAfterFees: number | null;
  publishToStore: boolean;
  publicSlug: string | null;
  publicTitle: string | null;
  publicDescription: string | null;
  publicPrice: number | null;
  compareAtPrice: number | null;
  publicImages: string[];
  availableForSale: number | null;
  maxQuantityPerOrder: number;
  shippingProfile: string;
  storeStatus: "draft" | "active" | "hidden" | "sold_out";
  localPickupAvailable: boolean;
  shippingAvailable: boolean;
  storefrontCategory: string | null;
  storefrontTags: string[];
  totalSalesGross: number;
  totalSalesNet: number;
  realizedProfitLoss: number;
  realizedRoiPercent: number | null;
  businessProfitLoss: number | null;
  lastThreeComps: InventoryMarketCompDTO[];
  stockLots: InventoryStockLotDTO[];
  sales: InventorySaleDTO[];
  expectedPlan: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicStoreProductDTO = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  imageUrl: string | null;
  images: string[];
  category: string;
  tags: string[];
  availableQuantity: number;
  maxQuantityPerOrder: number;
  status: "active" | "sold_out";
  localPickupAvailable: boolean;
  shippingAvailable: boolean;
};

export type StorefrontSettingsDTO = {
  storeName: string;
  storeLogoUrl: string | null;
  contactEmail: string | null;
  returnPolicyText: string | null;
  shippingPolicyText: string | null;
  localPickupInstructions: string | null;
  announcementBanner: string | null;
  defaultShippingPrice: number;
  freeShippingThreshold: number | null;
  socialLinks: string[];
};

export type StorefrontOrderItemDTO = {
  id: string;
  inventoryItemId: string;
  publicTitle: string;
  publicSlug: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  costBasis: number;
  profitLoss: number;
};

export type StorefrontOrderDTO = {
  id: string;
  orderNumber: string;
  customerEmail: string | null;
  customerName: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotal: number;
  shippingCharged: number;
  tax: number;
  total: number;
  stripeFeeEstimate: number;
  shippingCost: number;
  costBasis: number;
  netProfit: number;
  roiPercent: number | null;
  trackingNumber: string | null;
  carrier: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
  items: StorefrontOrderItemDTO[];
};

export type StorefrontSummaryDTO = {
  productCount: number;
  activeProductCount: number;
  pendingOrderCount: number;
  paidOrderCount: number;
  totalRevenue: number;
  netProfit: number;
};

export type InventoryStockLotDTO = {
  id: string;
  inventoryItemId: string;
  purchasedAt: string;
  source: string;
  quantity: number;
  costPerUnit: number;
  purchaseExtraCost: number | null;
  totalCost: number;
  remainingQuantity: number;
  notes: string | null;
  receiptNumber: string | null;
  receiptImageUrl: string | null;
  orderNumber: string | null;
  transactionId: string | null;
  sourceStore: string | null;
  paymentMethod: string | null;
  createdAt: string;
};

export type InventorySaleDTO = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  quantitySold: number;
  soldPricePerItem: number;
  grossSale: number;
  platform: string;
  fees: number;
  shippingCost: number;
  netSale: number;
  costBasis: number;
  profitLoss: number;
  roiPercent: number | null;
  soldAt: string;
  notes: string | null;
  createdAt: string;
};

export type InventoryMarketCompDTO = {
  id: string;
  inventoryItemId: string;
  saleTitle: string;
  salePrice: number;
  soldAt: string;
  sourceUrl: string | null;
  sourceQuality: CompSourceQuality;
  matchScore: number;
  notes: string | null;
  createdAt: string;
};

export type BarcodeScanDTO = {
  id: string;
  upc: string;
  rawCode: string | null;
  normalizedUpc: string | null;
  variantsChecked: string[];
  source: string;
  status: "PRODUCT_FOUND" | "NEW_UPC" | "LOOKUP_FAILED";
  resultType: string;
  productId: string | null;
  inventoryItemId: string | null;
  productName: string | null;
  notes: string | null;
  createdAt: string;
};

export type UpcLookupProductDTO = {
  upc: string;
  title: string;
  productName: string;
  brand: string | null;
  category: string | null;
  setName: string | null;
  description: string | null;
  imageUrl: string | null;
  additionalImages: string[];
  msrp: number | null;
  model: string | null;
  manufacturer: string | null;
  sku: string | null;
  retailer: string | null;
  exactProductUrl: string | null;
  productId: string | null;
  source: "inventory" | "watched_product" | "external";
  confidence: number | null;
  matchQuality: "HIGH" | "MEDIUM" | "LOW" | null;
};

export type UpcLookupFailureDTO = {
  source: string;
  reason: string;
  configured?: boolean;
  statusCode?: number;
  detail?: string;
};

export type UpcLookupDebugDTO = {
  attemptedSources: string[];
  failures: UpcLookupFailureDTO[];
  rawCode?: string;
  normalizedUpc?: string;
  variantsChecked?: string[];
  matchedInventoryProduct?: boolean;
  matchedWatchedProduct?: boolean;
  matchedPreviousScan?: boolean;
  externalLookupAttempted?: boolean;
  resultReason?: string;
  providerConfig: {
    configuredUpcProvider: boolean;
    publicUpcProvider: boolean;
    searchFallback: boolean;
    searchProvider: string | null;
  };
};

export type UpcLookupResultDTO = {
  upc: string;
  rawCode: string;
  normalizedUpc: string;
  variantsChecked: string[];
  nextAction: "ADD_STOCK" | "CREATE_FROM_WATCHED" | "CREATE_MANUAL";
  status: "PRODUCT_FOUND" | "NEW_UPC" | "LOOKUP_FAILED";
  message: string;
  matchedInventoryItem: InventoryItemDTO | null;
  matchedProduct: ProductDTO | null;
  lookupProduct: UpcLookupProductDTO | null;
  externalLookupConfigured: boolean;
  debug: UpcLookupDebugDTO;
  history: BarcodeScanDTO[];
};

export type InventorySummaryDTO = {
  totalSpent: number;
  totalCost: number;
  currentInventoryValue: number;
  estimatedMarketValue: number;
  totalSalesGross: number;
  totalSalesNet: number;
  estimatedProfit: number;
  realizedProfitLoss: number;
  netProfitLoss: number;
  totalRoiPercent: number | null;
  itemsOwned: number;
  itemsSold: number;
  spendingThisWeek: number;
  spendingThisMonth: number;
  salesThisWeek: number;
  salesThisMonth: number;
  profitByPlatform: Array<{ platform: string; profit: number; sales: number }>;
  quantityByCategory: Array<{ category: string; quantity: number }>;
  bestItem: InventoryItemDTO | null;
  worstItem: InventoryItemDTO | null;
  sellNowCount: number;
  holdCount: number;
  missingMarketDataCount: number;
};

export type DailyRecapDTO = {
  id: string;
  recapDate: string;
  summary: string;
  productChecks: number;
  storeVisits: number;
  purchases: number;
  alertsCreated: number;
  createdAt: string;
};

export type SavedFilterPresetDTO = {
  id: string;
  name: string;
  section: string;
  filters: string;
  createdAt: string;
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
  imageUrl: string | null;
  expectedTitleKeywords: string | null;
  url: string;
  sku: string | null;
  upc: string | null;
  dpci: string | null;
  retailerProductId: string | null;
  verificationStatus: ProductVerificationStatus;
  verifiedAt: string | null;
  verifiedFinalUrl: string | null;
  verificationNotes: string | null;
  retailPrice: number | null;
  liveTitle: string | null;
  livePrice: number | null;
  livePriceSource: string | null;
  livePriceVerifiedAt: string | null;
  liveStockStatus: ProductStatus | null;
  liveStockVerifiedAt: string | null;
  liveImageUrl: string | null;
  liveConfidenceScore: number | null;
  liveBlockedType: string | null;
  isDemoData: boolean;
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
  archivedAt: string | null;
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
  zone: Zone;
  zoneLabel: string;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  isFavorite: boolean;
  hiddenByUser: boolean;
  distanceRank: number;
  notes: string | null;
  typicalRestockDays: string;
  typicalRestockTimeWindow: string;
  vendorNotes: string | null;
  confidenceScore: number;
  prediction: StorePredictionDTO;
};

export type StoreDiscoveryCandidateDTO = {
  id: string;
  retailerId: string;
  retailerName: string;
  storeName: string;
  address: string;
  city: string;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  placeId: string | null;
  googleMapsUrl: string | null;
  distanceMiles: number | null;
  duplicate: boolean;
  duplicateReason: string | null;
  source: "google_places" | "manual";
};

export type StoreDiscoveryResponseDTO = {
  mode: "google_places" | "manual";
  configured: boolean;
  origin: {
    label: string;
    latitude: number | null;
    longitude: number | null;
  };
  radiusMiles: number;
  message: string;
  candidates: StoreDiscoveryCandidateDTO[];
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

export type ZoneOptionDTO = {
  value: Zone;
  label: string;
};

export type UserAreaPreferencesDTO = {
  preferredZone: Zone;
  customZoneName: string | null;
  hideDistantStores: boolean;
  currentLatitude: number | null;
  currentLongitude: number | null;
  locationUpdatedAt: string | null;
  favoriteStoreIds: string[];
  hiddenStoreIds: string[];
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
  ebayIncludeWords: string | null;
  ebayExcludeWords: string | null;
  ebayExactSetName: boolean;
  ebayCardNumberRequired: boolean;
  ebayRawKeywords: string | null;
  ebayPsa9Keywords: string | null;
  ebayPsa10Keywords: string | null;
  ebayAllowNonEnglish: boolean;
  lastCompAt: string | null;
  compCount: number;
  recentCompCount: number;
  rawCompCount: number;
  psa9CompCount: number;
  psa10CompCount: number;
  lastThreeComps: CardCompSaleDTO[];
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
  score: number;
  dedupeKey: string | null;
  explanation: string | null;
  falsePositiveAt: string | null;
  suppressedAt: string | null;
  cooldownUntil: string | null;
};

export type AlertAnalyticsDTO = {
  totalAlerts: number;
  unreadAlerts: number;
  highPriorityAlerts: number;
  falsePositiveAlerts: number;
  suppressedAlerts: number;
  averageScore: number;
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

export type ScannerStatusDTO = {
  activeProductsScanned: number;
  activeDiscoverySourcesScanned: number;
  cronActive: boolean;
  lastScanTime: string | null;
  nextScanEstimate: string | null;
  newFindsPendingReview: number;
  liveRestocksDetectedToday: number;
};

export type ProductDiscoverySourceDTO = {
  id: string;
  retailerId: string;
  retailerName: string;
  name: string;
  url: string;
  notes: string | null;
  enabled: boolean;
  checkFrequencyMinutes: number;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulCheckedAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  lastFoundCount: number;
};

export type ProductDiscoveryCandidateDTO = {
  id: string;
  sourceId: string;
  sourceName: string;
  retailerId: string;
  retailerName: string;
  url: string;
  finalUrl: string | null;
  productName: string;
  productType: string | null;
  retailerProductId: string | null;
  imageUrl: string | null;
  livePrice: number | null;
  stockStatus: ProductStatus | null;
  confidenceScore: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "IGNORED";
  approvedProductId: string | null;
  reviewedAt: string | null;
  ignoredAt: string | null;
  createdAt: string;
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
  alertDigestMode: boolean;
  urgentOnlyMode: boolean;
  highPriorityOverride: boolean;
  watchedRetailers: string | null;
  watchedProducts: string | null;
  alertCooldownMinutes: number;
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
  auth: {
    authSecretConfigured: boolean;
    authSecretStrong: boolean;
    authReady: boolean;
    sessionCookieName: string;
    secureCookie: boolean;
    sameSite: string;
    sessionDays: number;
    currentSessionValid: boolean;
    currentSessionEmail: string | null;
    currentSessionRole: Role | null;
    adminUserCount: number;
    configuredAdminEmailPresent: boolean;
    configuredAdminEmailExists: boolean;
    lastAdminLoginAt: string | null;
    passwordResetEmailConfigured: boolean;
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
    upc: {
      configuredUpcProvider: boolean;
      publicUpcProvider: boolean;
      searchFallbackConfigured: boolean;
      searchProvider: string | null;
    };
    stripe: {
      configured: boolean;
      secretKeyConfigured: boolean;
      webhookSecretConfigured: boolean;
      storeBaseUrlConfigured: boolean;
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
  tab: "products" | "stores" | "releases" | "alerts" | "cards";
  entityId?: string;
};

export type OwnerLaunchChecklistItemDTO = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  severity: Priority;
  tab: "dashboard" | "products" | "stores" | "releases" | "cards" | "alerts";
};

export type AlertCalibrationItemDTO = {
  id: string;
  severity: Priority;
  category: string;
  title: string;
  detail: string;
  recommendation: string;
  productId: string | null;
  productName: string | null;
  retailerName: string | null;
  lastSeenAt: string | null;
  tab: "products" | "alerts";
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
  saleTitle: string | null;
  matchScore: number;
  conditionNotes: string | null;
  reviewStatus: "ACCEPTED" | "REJECTED";
  rejectedAt: string | null;
};

export type EbayEnvironmentStatusDTO = {
  name: "EBAY_CLIENT_ID" | "EBAY_CLIENT_SECRET" | "EBAY_ENVIRONMENT" | "EBAY_MARKETPLACE_ID";
  configured: boolean;
  masked: string;
};

export type EbayConnectionStatusDTO = {
  mode: "api" | "manual";
  ready: boolean;
  environment: "production" | "sandbox";
  marketplaceId: string;
  variables: EbayEnvironmentStatusDTO[];
  message: string;
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
  zoneOptions: ZoneOptionDTO[];
  userAreaPreferences: UserAreaPreferencesDTO;
  users: FriendUserDTO[];
  friendInvites: FriendInviteDTO[];
  auditLogs: AuditLogDTO[];
  dailyPlan: DailyPlanDTO;
  inventory: InventoryItemDTO[];
  inventorySummary: InventorySummaryDTO;
  storefrontOrders: StorefrontOrderDTO[];
  storefrontSummary: StorefrontSummaryDTO;
  storefrontSettings: StorefrontSettingsDTO;
  barcodeScans: BarcodeScanDTO[];
  dailyRecaps: DailyRecapDTO[];
  savedFilterPresets: SavedFilterPresetDTO[];
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
  ebayStatus: EbayConnectionStatusDTO;
  alerts: AlertDTO[];
  monitorLogs: MonitorLogDTO[];
  monitorAccuracyStats: MonitorAccuracyStatsDTO;
  scannerStatus: ScannerStatusDTO;
  productDiscoverySources: ProductDiscoverySourceDTO[];
  productDiscoveryCandidates: ProductDiscoveryCandidateDTO[];
  alertAnalytics: AlertAnalyticsDTO;
  notificationSettings: NotificationSettingsDTO;
  investmentSettings: InvestmentSettingsDTO;
  health: AppHealthDTO | null;
  setupChecklist: SetupChecklistItemDTO[];
  dataQualityWarnings: DataQualityWarningDTO[];
  ownerLaunchChecklist: OwnerLaunchChecklistItemDTO[];
  alertCalibrationItems: AlertCalibrationItemDTO[];
  stats: {
    actionableProducts: number;
    unreadAlerts: number;
    highProbabilityStores: number;
    profitablePsa10Cards: number;
  };
};
