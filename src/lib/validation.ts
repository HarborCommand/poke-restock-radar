import { z } from "zod";

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const ratingSchema = z.enum(["BUY", "WATCH", "SKIP", "AVOID"]);
export const gradeTypeSchema = z.enum(["RAW", "PSA_9", "PSA_10", "BGS_9_5", "BGS_10", "BGS_BLACK_LABEL"]);
export const compSourceQualitySchema = z.enum(["EBAY_SOLD", "PRICECHARTING", "TCGPLAYER", "MANUAL_ESTIMATE"]);
export const inventoryCategorySchema = z.enum([
  "sealed_packs",
  "sleeved_boosters",
  "etbs",
  "booster_bundles",
  "booster_boxes",
  "collection_boxes",
  "single_cards",
  "graded_cards",
  "raw_cards"
]);
export const inventoryItemStatusSchema = z.enum(["sealed", "opened", "graded", "raw"]);
export const inventoryListingStatusSchema = z.enum(["not_listed", "listed", "sold", "held"]);
export const inventoryRecommendationSchema = z.enum(["HOLD", "SELL_NOW", "LIST_HIGH", "GRADE_FIRST", "RIP_OPEN", "AVOID_BUYING_MORE"]);
export const eraSchema = z.enum(["MODERN", "VINTAGE"]);
export const zoneSchema = z.enum(["MIAMI", "FORT_LAUDERDALE", "ORLANDO", "TAMPA", "JACKSONVILLE", "CUSTOM"]);
export const productVerificationStatusSchema = z.enum([
  "UNVERIFIED",
  "VERIFIED_URL",
  "UPC_MATCHED",
  "VERIFIED_EXACT",
  "SEARCH_OR_CATEGORY_LINK",
  "POSSIBLE_MISMATCH",
  "NEEDS_IDENTIFIERS"
]);
export const productStatusSchema = z.enum([
  "UNAVAILABLE",
  "SOLD_OUT",
  "PREORDER_LIVE",
  "ADD_TO_CART_AVAILABLE",
  "IN_STOCK",
  "PRICE_CHANGE",
  "PAGE_UPDATED"
]);
export const storeVisitResultSchema = z.enum([
  "stock_seen",
  "empty_shelf",
  "vendor_spotted",
  "bought_product",
  "no_visit"
]);

const currentYear = new Date().getFullYear();

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalDetectionWords = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .max(800, "Detection words must stay under 800 characters")
    .refine((value) => {
      if (!value) return true;
      return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .every((item) => item.length >= 2 && item.length <= 80);
    }, "Use comma-separated or newline-separated words between 2 and 80 characters")
    .optional()
);

const checkboxBoolean = z.preprocess((value) => value === true || value === "true" || value === "on" || value === "1", z.boolean());

const checkboxBooleanDefaultTrue = z.preprocess(
  (value) => (value === undefined ? true : value === true || value === "true" || value === "on" || value === "1"),
  z.boolean()
);

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only http and https URLs are allowed");

const optionalHttpUrl = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  httpUrl.optional()
);

const optionalLatitude = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(-90).max(90).optional()
);

const optionalLongitude = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(-180).max(180).optional()
);

const optionalUrlList = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .optional()
    .refine((value) => {
      if (!value) return true;
      return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .every((item) => {
          try {
            const url = new URL(item);
            return ["http:", "https:"].includes(url.protocol);
          } catch {
            return false;
          }
        });
    }, "Every product link must be a valid http or https URL")
);

const optionalMoney = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().nonnegative().max(100000).optional()
);

const requiredMoney = z.coerce.number().nonnegative().max(100000);

const boundedDate = z.coerce
  .date()
  .refine((value) => value.getFullYear() >= 2020 && value.getFullYear() <= currentYear + 5, {
    message: `Date must be between 2020 and ${currentYear + 5}`
  });

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  boundedDate.optional()
);

const sightingDate = boundedDate.refine((value) => value.getTime() <= Date.now() + 30 * 60 * 1000, {
  message: "Sighting time cannot be in the future"
});

const skuLike = z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9._:/#-]+$/, "Use letters, numbers, dashes, dots, slashes, colons, or # only");
const optionalSkuLike = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  skuLike.optional()
);

const optionalUpc = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, "UPC must be 8 to 14 digits")
    .optional()
);

const optionalDpci = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\d{3}-\d{2}-\d{4}$|^[A-Za-z0-9-]{4,32}$/, "DPCI must look like 087-12-1234 or a short retailer identifier")
    .optional()
);

const optionalTime = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM 24-hour time")
    .optional()
);

const optionalPhone = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, "Use an E.164-style phone number")
    .optional()
);

const cardNumber = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9-]{1,8}(\/[A-Za-z0-9-]{1,8})?$/, "Use a card number like 025/198, SV001, or 123");

const securePassword = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Password must stay under 128 characters")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[a-z]/, "Include at least one lowercase letter")
  .regex(/[0-9]/, "Include at least one number");

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email()
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(24).max(256),
    password: securePassword,
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match"
  });

export const adminPasswordResetSchema = z
  .object({
    currentPassword: z.string().min(1),
    password: securePassword,
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match"
  });

export const adminEmailUpdateSchema = z.object({
  currentPassword: z.string().min(1),
  email: z.string().trim().email()
});

export const friendInviteCreateSchema = z.object({
  email: z.string().trim().email(),
  name: optionalTrimmed,
  canAddSightings: checkboxBoolean.default(true),
  canAddComps: checkboxBoolean.default(false),
  canRunChecks: checkboxBoolean.default(false),
  canReceivePushAlerts: checkboxBoolean.default(true)
});

export const friendInviteAcceptSchema = z
  .object({
    token: z.string().trim().min(24).max(256),
    email: z.string().trim().email(),
    name: z.string().trim().min(2).max(80),
    password: securePassword,
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match"
  });

export const userAccessUpdateSchema = z.object({
  role: z.enum(["ADMIN", "FRIEND"]).optional(),
  canAddSightings: checkboxBoolean.optional(),
  canAddComps: checkboxBoolean.optional(),
  canRunChecks: checkboxBoolean.optional(),
  canReceivePushAlerts: checkboxBoolean.optional(),
  disabled: checkboxBoolean.optional()
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2),
  retailerId: z.string().min(1),
  releaseId: optionalTrimmed,
  setName: optionalTrimmed,
  productType: optionalTrimmed,
  imageUrl: optionalHttpUrl,
  expectedTitleKeywords: optionalDetectionWords,
  url: httpUrl,
  sku: optionalSkuLike,
  upc: optionalUpc,
  dpci: optionalDpci,
  retailerProductId: optionalTrimmed,
  retailPrice: optionalMoney,
  stockStatus: productStatusSchema.default("UNAVAILABLE"),
  priority: prioritySchema.default("MEDIUM"),
  rating: z.enum(["BUY", "WATCH", "SKIP"]).default("WATCH"),
  monitorEnabled: checkboxBooleanDefaultTrue,
  checkFrequencyMinutes: z.coerce.number().int().min(15).max(10080).default(60),
  requiredWords: optionalDetectionWords,
  ignoreWords: optionalDetectionWords,
  sealedResaleNotes: optionalTrimmed,
  scarcityNotes: optionalTrimmed,
  manualPriorityOverride: z.enum(["BUY", "WATCH", "SKIP"]).optional(),
  notes: optionalTrimmed
});

export const productUpdateSchema = productCreateSchema.extend({
  reason: optionalTrimmed
});

export const productDiscoverySourceCreateSchema = z.object({
  retailerId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  url: httpUrl,
  notes: optionalTrimmed,
  enabled: checkboxBooleanDefaultTrue,
  checkFrequencyMinutes: z.coerce.number().int().min(30).max(10080).default(360)
});

export const productDiscoveryReviewSchema = z.object({
  action: z.enum(["approve", "ignore"]),
  priority: prioritySchema.default("MEDIUM"),
  rating: z.enum(["BUY", "WATCH", "SKIP"]).default("WATCH"),
  checkFrequencyMinutes: z.coerce.number().int().min(15).max(10080).default(60),
  notes: optionalTrimmed
});

export const storeCreateSchema = z.object({
  retailerId: z.string().min(1),
  storeName: z.string().trim().min(2),
  address: z.string().trim().min(2),
  city: z.string().trim().min(2),
  state: z.string().trim().min(2).max(24),
  zone: zoneSchema.default("MIAMI"),
  latitude: optionalLatitude,
  longitude: optionalLongitude,
  typicalRestockDays: z.string().trim().min(2),
  typicalRestockTimeWindow: z.string().trim().min(2),
  vendorNotes: optionalTrimmed,
  confidenceScore: z.coerce.number().int().min(0).max(100).default(50),
  notes: optionalTrimmed
});

export const userAreaPreferencesSchema = z.object({
  preferredZone: zoneSchema.default("MIAMI"),
  customZoneName: optionalTrimmed,
  hideDistantStores: checkboxBoolean.default(false),
  currentLatitude: optionalLatitude,
  currentLongitude: optionalLongitude
});

export const storePreferenceSchema = z.object({
  storeId: z.string().min(1),
  favorite: checkboxBoolean.optional(),
  hidden: checkboxBoolean.optional()
});

export const storeDiscoverySearchSchema = z
  .object({
    locationQuery: optionalTrimmed,
    latitude: optionalLatitude,
    longitude: optionalLongitude,
    radiusMiles: z.coerce.number().int().refine((value) => [5, 10, 25, 50].includes(value), "Use 5, 10, 25, or 50 miles"),
    retailers: z
      .array(z.enum(["Target", "Walmart", "GameStop", "Best Buy"]))
      .min(1, "Select at least one retailer")
      .max(4)
  })
  .refine((value) => value.locationQuery || (value.latitude !== undefined && value.longitude !== undefined), {
    message: "Enter a ZIP/city or use browser location",
    path: ["locationQuery"]
  });

const storeDiscoveryCandidateSchema = z.object({
  id: z.string().trim().min(1),
  retailerId: z.string().trim().min(1),
  retailerName: z.enum(["Target", "Walmart", "GameStop", "Best Buy"]),
  storeName: z.string().trim().min(2).max(160),
  address: z.string().trim().min(2).max(240),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(24),
  zip: optionalTrimmed,
  latitude: optionalLatitude.nullable(),
  longitude: optionalLongitude.nullable(),
  phone: optionalTrimmed,
  placeId: optionalTrimmed.nullable(),
  googleMapsUrl: optionalHttpUrl.nullable(),
  distanceMiles: z.coerce.number().nonnegative().max(1000).nullable().optional(),
  duplicate: checkboxBoolean.default(false),
  duplicateReason: optionalTrimmed.nullable(),
  source: z.enum(["google_places", "manual"]).default("google_places")
});

export const storeDiscoveryAddSchema = z.object({
  candidates: z.array(storeDiscoveryCandidateSchema).min(1, "Select at least one store").max(80)
});

export const sightingCreateSchema = z.object({
  storeId: z.string().min(1),
  productSeen: z.string().trim().min(2),
  resultType: storeVisitResultSchema.default("stock_seen"),
  seenAt: sightingDate,
  quantityEstimate: z.string().trim().min(1),
  shelfPhotoUrl: optionalHttpUrl,
  notes: optionalTrimmed
});

export const sightingUpdateSchema = sightingCreateSchema.omit({ storeId: true }).extend({
  storeId: z.string().min(1).optional()
});

export const releaseCreateSchema = z.object({
  setName: z.string().trim().min(2),
  productType: optionalTrimmed,
  officialReleaseDate: boundedDate,
  preorderDate: optionalDate.nullable(),
  productTypes: z.string().trim().min(2),
  pokemonCenterExclusiveVersion: checkboxBoolean,
  chaseCards: optionalTrimmed,
  demandRating: prioritySchema.default("MEDIUM"),
  estimatedDemand: prioritySchema.default("MEDIUM"),
  priority: prioritySchema.default("MEDIUM"),
  sealedProductPriority: prioritySchema.default("MEDIUM"),
  notes: optionalTrimmed,
  productLinks: optionalUrlList
}).refine((value) => !value.preorderDate || value.preorderDate <= value.officialReleaseDate, {
  message: "Preorder date cannot be after official release date",
  path: ["preorderDate"]
});

export const cardCreateSchema = z.object({
  releaseId: optionalTrimmed,
  cardName: z.string().trim().min(2),
  setName: z.string().trim().min(2),
  cardNumber,
  rarity: z.string().trim().min(2),
  rawAveragePrice: requiredMoney,
  psa9AverageSalePrice: requiredMoney,
  psa10AverageSalePrice: requiredMoney,
  bgs95AverageSalePrice: requiredMoney.default(0),
  bgs10AverageSalePrice: requiredMoney.default(0),
  bgsBlackLabelAverageSalePrice: requiredMoney.default(0),
  estimatedEbayFee: z.coerce.number().min(0).max(0.5).default(0.1325),
  estimatedGradingCost: requiredMoney.default(20),
  estimatedShippingCost: requiredMoney.default(5),
  minimumProfitTarget: requiredMoney.default(20),
  rating: ratingSchema.optional(),
  dataSource: z.string().trim().min(2).default("Manual entry"),
  lastRefreshed: boundedDate,
  notes: optionalTrimmed,
  characterName: optionalTrimmed,
  era: eraSchema.default("MODERN"),
  lowPop: checkboxBoolean,
  newRelease: checkboxBoolean,
  lowNumberedSerialized: checkboxBoolean,
  strongCharacterDemand: checkboxBoolean,
  ebayIncludeWords: optionalDetectionWords,
  ebayExcludeWords: optionalDetectionWords,
  ebayExactSetName: checkboxBooleanDefaultTrue,
  ebayCardNumberRequired: checkboxBooleanDefaultTrue,
  ebayRawKeywords: optionalDetectionWords,
  ebayPsa9Keywords: optionalDetectionWords,
  ebayPsa10Keywords: optionalDetectionWords,
  ebayAllowNonEnglish: checkboxBoolean.default(false)
});

export const backupImportSchema = z.object({
  version: z.literal(1),
  tables: z.record(z.string(), z.array(z.unknown()))
});

export const monitorRunSchema = z.object({
  mode: z.enum(["due", "all"]).default("due")
});

export const productMonitorActionSchema = z.object({
  action: z.enum(["pause", "resume", "force_alert", "mark_false_positive"]),
  monitorLogId: optionalTrimmed,
  reason: optionalTrimmed
});

export const notificationSettingsSchema = z.object({
  inApp: checkboxBoolean,
  email: checkboxBoolean,
  sms: checkboxBoolean,
  browserPush: checkboxBoolean,
  phone: optionalPhone,
  emailTo: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().email().optional()
  ),
  quietHoursStart: optionalTime,
  quietHoursEnd: optionalTime,
  minimumPriority: prioritySchema.default("LOW"),
  alertDigestMode: checkboxBoolean.default(false),
  urgentOnlyMode: checkboxBoolean.default(false),
  highPriorityOverride: checkboxBoolean.default(true),
  watchedRetailers: optionalTrimmed,
  watchedProducts: optionalTrimmed,
  alertCooldownMinutes: z.coerce.number().int().min(0).max(1440).default(30)
});

export const testAlertSchema = z.object({
  channel: z.enum(["inApp", "email", "sms", "browserPush"])
});

export const pushSubscriptionSchema = z.object({
  endpoint: httpUrl,
  keys: z.object({
    p256dh: z.string().trim().min(8),
    auth: z.string().trim().min(8)
  })
});

export const pushUnsubscribeSchema = z.object({
  endpoint: optionalHttpUrl
});

export const cardCompCreateSchema = z.object({
  cardName: z.string().trim().min(2),
  setName: z.string().trim().min(2),
  cardNumber,
  gradeType: gradeTypeSchema,
  sourceQuality: compSourceQualitySchema.default("EBAY_SOLD"),
  salePrice: requiredMoney,
  soldAt: boundedDate,
  sourceUrl: optionalHttpUrl,
  saleTitle: optionalTrimmed,
  matchScore: z.coerce.number().int().min(0).max(100).default(100),
  conditionNotes: optionalTrimmed,
  characterName: optionalTrimmed,
  era: eraSchema.default("MODERN"),
  lowNumberedSerialized: checkboxBoolean,
  strongCharacterDemand: checkboxBoolean,
  lowPop: checkboxBoolean,
  newRelease: checkboxBoolean
});

export const cardCompReviewSchema = z.object({
  action: z.enum(["accept", "reject"])
});

export const investmentSettingsSchema = z.object({
  gradingCost: requiredMoney.default(20),
  ebaySellingFee: z.coerce.number().min(0).max(0.5).default(0.1325),
  shippingCost: requiredMoney.default(5),
  minimumProfitTarget: requiredMoney.default(20)
});

export const weeklyInvestmentReportSchema = z.object({
  notes: optionalTrimmed
});

export const bulkImportSchema = z.object({
  format: z.enum(["csv", "json"]),
  data: z.string().trim().min(2)
});

export const markCheckedTodaySchema = z.object({
  note: optionalTrimmed
});

export const inventoryCreateSchema = z.object({
  existingInventoryItemId: optionalTrimmed,
  itemType: z.enum(["product", "card", "sealed", "other"]).default("product"),
  itemName: z.string().trim().min(2).max(160),
  category: inventoryCategorySchema.default("sealed_packs"),
  setName: optionalTrimmed,
  productId: optionalTrimmed,
  cardId: optionalTrimmed,
  cost: requiredMoney,
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  totalCost: optionalMoney,
  purchaseExtraCost: optionalMoney,
  source: z.string().trim().min(2).max(120),
  retailer: optionalTrimmed,
  purchasedAt: boundedDate.default(() => new Date()),
  receiptNumber: optionalTrimmed,
  receiptImageUrl: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().max(250000).optional()
  ),
  orderNumber: optionalTrimmed,
  transactionId: optionalTrimmed,
  sourceStore: optionalTrimmed,
  paymentMethod: optionalTrimmed,
  exactProductUrl: optionalHttpUrl,
  upc: optionalTrimmed,
  sku: optionalTrimmed,
  dpci: optionalTrimmed,
  asin: optionalTrimmed,
  imageUrl: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().max(250000).optional()
  ),
  condition: optionalTrimmed,
  itemStatus: inventoryItemStatusSchema.default("sealed"),
  targetSellPrice: optionalMoney,
  minimumAcceptablePrice: optionalMoney,
  listingPlatform: optionalTrimmed,
  listingStatus: inventoryListingStatusSchema.default("not_listed"),
  soldPrice: optionalMoney,
  soldAt: optionalDate,
  buyerPlatform: optionalTrimmed,
  currentMarketEstimate: optionalMoney,
  estimatedEbayFee: optionalMoney,
  estimatedShippingCost: optionalMoney,
  expectedPlan: optionalTrimmed,
  notes: optionalTrimmed
});

export const inventoryUpdateSchema = inventoryCreateSchema.partial();

export const upcLookupSchema = z.object({
  upc: z
    .string()
    .trim()
    .regex(/^\d{6,14}$/, "UPC/EAN must be 6 to 14 digits."),
  source: z.enum(["camera", "manual"]).default("manual")
});

export const inventorySaleCreateSchema = z.object({
  quantitySold: z.coerce.number().int().min(1).max(1000),
  soldPricePerItem: requiredMoney,
  platform: z.enum(["ebay", "facebook", "whatnot", "friend", "local", "other"]).default("ebay"),
  fees: optionalMoney.default(0),
  shippingCost: optionalMoney.default(0),
  soldAt: boundedDate.default(() => new Date()),
  notes: optionalTrimmed
});

export const inventoryCompCreateSchema = z.object({
  inventoryItemId: z.string().trim().min(2),
  saleTitle: z.string().trim().min(2).max(220),
  salePrice: requiredMoney,
  soldAt: boundedDate,
  sourceUrl: optionalHttpUrl,
  sourceQuality: compSourceQualitySchema.default("EBAY_SOLD"),
  matchScore: z.coerce.number().int().min(0).max(100).default(100),
  notes: optionalTrimmed
});

export const productBoughtSchema = z.object({
  cost: optionalMoney,
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  source: optionalTrimmed,
  expectedPlan: optionalTrimmed,
  notes: optionalTrimmed
});

export const savedFilterPresetSchema = z.object({
  name: z.string().trim().min(2).max(80),
  section: z.enum(["dashboard", "products", "stores", "releases", "cards", "alerts", "field"]),
  filters: z.string().trim().min(2).max(2000)
});

export const dailyRecapCreateSchema = z.object({
  recapDate: optionalDate
});
