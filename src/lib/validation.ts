import { z } from "zod";
import { POS_DISCOUNT_REASON_VALUES, POS_PAYMENT_METHOD_VALUES, POS_REFUND_REASON_VALUES } from "@/lib/pos";

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const ratingSchema = z.enum(["BUY", "WATCH", "SKIP", "AVOID"]);
export const gradeTypeSchema = z.enum(["RAW", "PSA_9", "PSA_10", "BGS_9_5", "BGS_10", "BGS_BLACK_LABEL"]);
export const compSourceQualitySchema = z.enum(["EBAY_SOLD", "PRICECHARTING", "TCGPLAYER", "MANUAL_ESTIMATE", "ACTIVE_ASKING"]);
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
export const storeStatusSchema = z.enum(["draft", "active", "hidden", "sold_out"]);
export const authenticityProofStatusSchema = z.enum(["missing", "partial", "complete"]);
export const authenticityReceiptStatusSchema = z.enum(["missing", "receipt", "invoice", "order_history", "other"]);
export const authenticityPhotoStatusSchema = z.enum(["missing", "front_only", "front_back", "front_back_upc"]);
export const inventoryProductImageSourceSchema = z.enum(["uploaded", "url", "upc_lookup", "retailer", "manual", "existing_image_url"]);
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

export const MAX_PUBLIC_IMAGE_URL_LENGTH = 4096;

export type ImageSanitizationWarning = {
  field: string;
  reason: "raw_data_url" | "too_long" | "invalid_url";
};

function isAllowedPublicImageUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return value.length <= MAX_PUBLIC_IMAGE_URL_LENGTH;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && value.length <= MAX_PUBLIC_IMAGE_URL_LENGTH;
  } catch {
    return false;
  }
}

export function sanitizePublicImageUrl(value: unknown, field = "imageUrl"): { value?: string; warning?: ImageSanitizationWarning } {
  if (value === "" || value === null || value === undefined) return {};
  if (typeof value !== "string") return { warning: { field, reason: "invalid_url" } };

  const trimmed = value.trim();
  if (!trimmed) return {};
  if (/^data:image\//i.test(trimmed)) return { warning: { field, reason: "raw_data_url" } };
  if (trimmed.length > MAX_PUBLIC_IMAGE_URL_LENGTH) return { warning: { field, reason: "too_long" } };
  if (isAllowedPublicImageUrl(trimmed)) return { value: trimmed };

  return { warning: { field, reason: "invalid_url" } };
}

function publicImageUrlSchema(field: string) {
  return z.preprocess((value) => sanitizePublicImageUrl(value, field).value, z.string().trim().max(MAX_PUBLIC_IMAGE_URL_LENGTH).optional());
}

function publicImageUrlListSchema(field: string) {
  return z.preprocess((value) => sanitizePublicImageUrlList(value, field).value, z.array(z.string().trim().max(MAX_PUBLIC_IMAGE_URL_LENGTH)).optional());
}

export function sanitizePublicImageUrlList(value: unknown, field = "publicImages"): { value?: string[]; warnings: ImageSanitizationWarning[] } {
  const warnings: ImageSanitizationWarning[] = [];
  if (value === "" || value === null || value === undefined) return { warnings };

  const rawValues =
    Array.isArray(value)
      ? value
      : typeof value === "string" && /^data:image\//i.test(value.trim())
        ? [value]
        : typeof value === "string"
          ? value.split(/[\n,]/)
          : [value];

  const sanitized = rawValues
    .map((entry) => {
      const result = sanitizePublicImageUrl(entry, field);
      if (result.warning) warnings.push(result.warning);
      return result.value;
    })
    .filter((entry): entry is string => Boolean(entry));

  return sanitized.length ? { value: sanitized, warnings } : { warnings };
}

export function sanitizeInventoryImagePayload(payload: unknown) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...source };
  const warnings: ImageSanitizationWarning[] = [];

  for (const field of ["imageUrl", "receiptImageUrl"] as const) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    const result = sanitizePublicImageUrl(next[field], field);
    if (result.warning) warnings.push(result.warning);
    if (result.value) next[field] = result.value;
    else delete next[field];
  }

  if (Object.prototype.hasOwnProperty.call(next, "publicImages")) {
    const result = sanitizePublicImageUrlList(next.publicImages, "publicImages");
    warnings.push(...result.warnings);
    if (result.value) next.publicImages = result.value;
    else delete next.publicImages;
  }

  return { payload: next, warnings };
}

export function inventoryImageSanitizationMessage(warnings: ImageSanitizationWarning[]) {
  if (!warnings.length) return null;
  const fields = Array.from(new Set(warnings.map((warning) => warning.field))).join(", ");
  const hasRawData = warnings.some((warning) => warning.reason === "raw_data_url" || warning.reason === "too_long");
  return hasRawData
    ? `${fields} was skipped because uploaded image data must be stored as a hosted URL. The product was saved without that image.`
    : `${fields} was skipped because it was not a valid http/https URL or public path. The product was saved.`;
}

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

const optionalPackageNumber = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().nonnegative().max(500).optional()
);

const optionalProductPackageWeightOz = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.coerce
    .number()
    .positive("Package weight must be greater than 0 ounces")
    .max(500, "Package weight must stay under 500 ounces")
    .nullable()
    .optional()
);

const optionalProductPackageDimensionIn = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.coerce
    .number()
    .positive("Package dimensions must be greater than 0 inches")
    .max(120, "Package dimensions must stay under 120 inches")
    .nullable()
    .optional()
);

const requiredPackageWeight = z.coerce.number().nonnegative().max(500);

const shippingProfileKeySchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return String(value).trim().toLowerCase();
  },
  z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{1,79}$/, "Use lowercase letters, numbers, dashes, or underscores")
    .optional()
);

const shippingMetadataSourceSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return String(value).trim().toLowerCase();
  },
  z.enum(["measured", "estimated", "fallback"]).optional()
);

export const shippingProfileCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  key: shippingProfileKeySchema,
  packageType: z.string().trim().min(2).max(120),
  defaultWeightOz: requiredPackageWeight,
  packageLengthIn: optionalPackageNumber,
  packageWidthIn: optionalPackageNumber,
  packageHeightIn: optionalPackageNumber,
  defaultShippingCharge: optionalMoney,
  localPickupEligibleDefault: checkboxBoolean.default(false),
  freeShippingEligibleDefault: checkboxBoolean.default(false),
  requiresBoxDefault: checkboxBoolean.default(false),
  insuranceRecommendedDefault: checkboxBoolean.default(false),
  active: checkboxBoolean.default(true)
});

export const shippingProfileUpdateSchema = shippingProfileCreateSchema.partial();

const optionalPurchaseLimit = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.coerce.number().int().min(1).max(25).nullable().optional()
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
  action: z.enum(["approve", "ignore", "reject_non_tcg"]),
  priority: prioritySchema.default("MEDIUM"),
  rating: z.enum(["BUY", "WATCH", "SKIP"]).default("WATCH"),
  checkFrequencyMinutes: z.coerce.number().int().min(15).max(10080).default(60),
  notes: optionalTrimmed
});

export const productDiscoveryIdentifierSchema = z.object({
  upc: optionalTrimmed,
  dpci: optionalTrimmed,
  retailerProductId: optionalTrimmed,
  sku: optionalTrimmed,
  productType: optionalTrimmed
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
  releaseName: optionalTrimmed,
  productType: optionalTrimmed,
  releaseType: z.string().trim().min(2).default("expansion"),
  officialReleaseDate: optionalDate.nullable(),
  preorderDate: optionalDate.nullable(),
  preorderWindowText: optionalTrimmed,
  region: z.string().trim().min(2).default("US"),
  retailer: optionalTrimmed,
  productTypes: z.string().trim().min(2),
  pokemonCenterExclusiveVersion: checkboxBoolean,
  productImage: optionalHttpUrl,
  productUrl: optionalHttpUrl,
  chaseCards: optionalTrimmed,
  demandRating: prioritySchema.default("MEDIUM"),
  estimatedDemand: prioritySchema.default("MEDIUM"),
  priority: prioritySchema.default("MEDIUM"),
  sealedProductPriority: prioritySchema.default("MEDIUM"),
  notes: optionalTrimmed,
  productLinks: optionalUrlList,
  sourceUrl: optionalHttpUrl,
  sourceName: optionalTrimmed,
  sourceType: z.string().trim().min(2).default("manual"),
  confidence: prioritySchema.default("MEDIUM"),
  status: z.string().trim().min(2).default("upcoming"),
  createdByManualEntry: checkboxBoolean.default(true),
  needsReview: checkboxBoolean.default(false),
  reviewReason: optionalTrimmed
}).refine((value) => !value.preorderDate || !value.officialReleaseDate || value.preorderDate <= value.officialReleaseDate, {
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
  mode: z.enum(["due", "all", "target_due", "target_priority"]).default("due")
});

export const productMonitorActionSchema = z.object({
  action: z.enum(["pause", "resume", "force_alert", "simulate_tracker_drop", "mark_false_positive"]),
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
  brand: optionalTrimmed,
  description: optionalTrimmed,
  manufacturer: optionalTrimmed,
  model: optionalTrimmed,
  msrp: optionalMoney,
  purchasedAt: boundedDate.default(() => new Date()),
  receiptNumber: optionalTrimmed,
  receiptImageUrl: publicImageUrlSchema("receiptImageUrl"),
  orderNumber: optionalTrimmed,
  transactionId: optionalTrimmed,
  sourceStore: optionalTrimmed,
  paymentMethod: optionalTrimmed,
  exactProductUrl: optionalHttpUrl,
  upc: optionalTrimmed,
  sku: optionalTrimmed,
  dpci: optionalTrimmed,
  asin: optionalTrimmed,
  imageUrl: publicImageUrlSchema("imageUrl"),
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
  authenticityProofStatus: authenticityProofStatusSchema.default("missing"),
  authenticityReceiptStatus: authenticityReceiptStatusSchema.default("missing"),
  authenticityPhotoStatus: authenticityPhotoStatusSchema.default("missing"),
  authenticityUpcVerified: checkboxBoolean.default(false),
  authenticityNotes: optionalTrimmed,
  notes: optionalTrimmed
});

export const inventoryUpdateSchema = inventoryCreateSchema.partial();

export const inventoryStoreListingSchema = z.object({
  publishToStore: checkboxBoolean.default(false),
  publicSlug: optionalTrimmed,
  publicTitle: z.string().trim().min(2).max(180).optional(),
  publicDescription: z.string().trim().max(4000).optional(),
  publicPrice: optionalMoney,
  compareAtPrice: optionalMoney,
  publicImages: publicImageUrlListSchema("publicImages"),
  availableForSale: z.coerce.number().int().min(0).max(10000).optional(),
  purchaseLimitEnabled: checkboxBoolean.default(false),
  maxQuantityPerOrder: optionalPurchaseLimit,
  shippingProfile: z.string().trim().min(1).max(80).default("standard"),
  packageWeightOz: optionalProductPackageWeightOz,
  packageLengthIn: optionalProductPackageDimensionIn,
  packageWidthIn: optionalProductPackageDimensionIn,
  packageHeightIn: optionalProductPackageDimensionIn,
  shippingMetadataSource: shippingMetadataSourceSchema,
  freeShippingEligible: checkboxBoolean.default(false),
  requiresBox: checkboxBoolean.default(false),
  insuranceRecommended: checkboxBoolean.default(false),
  storeStatus: storeStatusSchema.default("draft"),
  localPickupAvailable: checkboxBooleanDefaultTrue.default(true),
  shippingAvailable: checkboxBooleanDefaultTrue.default(true),
  storefrontCategory: optionalTrimmed,
  storefrontTags: z.union([z.array(z.string().trim().min(1).max(80)), z.string().trim().max(500)]).optional()
}).transform((input) => {
  const hasAnyProductPackageField = Boolean(input.packageWeightOz || input.packageLengthIn || input.packageWidthIn || input.packageHeightIn);
  return {
    ...input,
    shippingMetadataSource: hasAnyProductPackageField ? input.shippingMetadataSource ?? "estimated" : null
  };
});

export const inventoryBulkStorePublishSchema = z.object({
  mode: z.enum(["selected", "eligible"]),
  itemIds: z.array(z.string().trim().min(1)).max(250).optional()
});

export const inventoryProductImageCreateSchema = z.object({
  url: publicImageUrlSchema("url"),
  altText: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().max(180).optional()
  ),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isPrimary: checkboxBoolean.default(false),
  showInStore: checkboxBooleanDefaultTrue.default(true),
  source: inventoryProductImageSourceSchema.default("manual")
}).refine((input) => Boolean(input.url), {
  path: ["url"],
  message: "Use a valid http/https image URL or public path."
});

export const inventoryProductImageUpdateSchema = z.object({
  altText: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().max(180).optional()
  ),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  isPrimary: checkboxBoolean.optional(),
  showInStore: checkboxBoolean.optional()
});

const inventoryStockAdjustmentReasonSchema = z.enum([
  "physical_count_correction",
  "damaged_item",
  "lost_item",
  "personal_use",
  "returned_to_supplier",
  "duplicate_entry_correction",
  "other"
]);

export const inventoryStockLotUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(1000),
  costPerUnit: requiredMoney,
  purchaseExtraCost: optionalMoney.default(0),
  totalCost: optionalMoney,
  source: z.string().trim().min(2).max(120),
  purchasedAt: boundedDate.default(() => new Date()),
  receiptNumber: optionalTrimmed,
  receiptImageUrl: publicImageUrlSchema("receiptImageUrl"),
  orderNumber: optionalTrimmed,
  transactionId: optionalTrimmed,
  sourceStore: optionalTrimmed,
  paymentMethod: optionalTrimmed,
  adjustmentReason: inventoryStockAdjustmentReasonSchema,
  adjustmentNote: optionalTrimmed,
  notes: optionalTrimmed
});

export const upcLookupSchema = z.object({
  upc: z.preprocess(
    (value) => String(value ?? "").replace(/\D/g, "").slice(0, 14),
    z.string().regex(/^\d{6,14}$/, "UPC/EAN must be 6 to 14 digits.")
  ),
  source: z.enum(["camera", "manual"]).default("manual")
});

export const inventorySaleCreateSchema = z.object({
  quantitySold: z.coerce.number().int().min(1).max(1000),
  actualSalePrice: optionalMoney,
  soldPricePerItem: optionalMoney,
  platform: z.enum(["ebay", "facebook", "whatnot", "website", "friend", "local", "other"]).default("ebay"),
  fees: optionalMoney.default(0),
  shippingCost: optionalMoney.default(0),
  soldAt: boundedDate.default(() => new Date()),
  notes: optionalTrimmed
}).transform((input, context) => {
  const actualSalePrice = input.actualSalePrice ?? input.soldPricePerItem;
  if (actualSalePrice === undefined || actualSalePrice === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actualSalePrice"],
      message: "Actual sale price is required."
    });
    return z.NEVER;
  }
  return {
    ...input,
    actualSalePrice,
    soldPricePerItem: actualSalePrice
  };
});

export const inventorySaleUpdateSchema = z.object({
  quantitySold: z.coerce.number().int().min(1).max(1000).optional(),
  actualSalePrice: optionalMoney,
  soldPricePerItem: optionalMoney,
  platform: z.enum(["ebay", "facebook", "whatnot", "website", "friend", "local", "other"]).optional(),
  fees: optionalMoney,
  shippingCost: optionalMoney,
  soldAt: boundedDate.optional(),
  notes: optionalTrimmed
}).transform((input) => {
  const actualSalePrice = input.actualSalePrice ?? input.soldPricePerItem;
  return {
    ...input,
    ...(actualSalePrice === undefined || actualSalePrice === null
      ? {}
      : { actualSalePrice, soldPricePerItem: actualSalePrice })
  };
});

export const posSaleCreateSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
  items: z.array(z.object({
    inventoryItemId: z.string().trim().min(2),
    quantity: z.coerce.number().int().min(1).max(1000),
    adjustedUnitPrice: z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? undefined : value),
      z.coerce.number().positive("Adjusted POS price must be greater than $0.").max(100000).optional()
    ),
    discountReason: z.enum(POS_DISCOUNT_REASON_VALUES).optional(),
    discountNote: optionalTrimmed
  })).min(1).max(100),
  paymentMethod: z.enum(POS_PAYMENT_METHOD_VALUES),
  paymentReference: optionalTrimmed,
  customerEmail: z.string().trim().email().optional(),
  customerPhone: optionalTrimmed
});

export const posCustomerMatchSchema = z.object({
  customerEmail: z.string().trim().email().optional(),
  customerPhone: optionalTrimmed
});

export const rewardAdminAdjustmentSchema = z.object({
  customerAccountId: z.string().trim().min(2),
  action: z.enum(["add", "deduct"]),
  points: z.coerce.number().int().positive().max(100000),
  reason: z.string().trim().min(4).max(160),
  note: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.string().trim().max(1000).optional()
  ),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9._:-]+$/)
});

export const posSaleRefundSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
  refundType: z.enum(["full"]).default("full"),
  reason: z.enum(POS_REFUND_REASON_VALUES),
  note: optionalTrimmed,
  restoreInventory: checkboxBoolean.default(true)
});

export const storefrontCartItemSchema = z.object({
  id: z.string().trim().min(2),
  quantity: z.coerce.number().int().min(1).max(25)
});

export const storefrontCheckoutSchema = z.object({
  items: z.array(storefrontCartItemSchema).min(1).max(25),
  fulfillmentMethod: z.enum(["shipping", "pickup"]).default("shipping"),
  customerEmail: z.string().trim().email().optional(),
  customerName: optionalTrimmed,
  shippingQuoteToken: optionalTrimmed
});

export const storefrontShippingQuoteSchema = z.object({
  items: z.array(storefrontCartItemSchema).min(1).max(25),
  destinationZip: z.string().trim().regex(/^\d{5}$/, "Enter a valid 5-digit ZIP code."),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter state code.")
    .optional(),
  country: z.enum(["US"]).default("US")
});

export const storefrontInvoiceRequestSchema = storefrontCheckoutSchema.extend({
  customerEmail: z.string().trim().email(),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: optionalTrimmed,
  customerNotes: optionalTrimmed
});

export const storefrontContactMessageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  subject: z.string().trim().min(2).max(160),
  message: z.string().trim().min(10).max(2000)
});

export const storefrontOrderCancelRefundSchema = z
  .object({
    reason: z.enum([
      "out_of_stock",
      "customer_requested",
      "address_issue",
      "fraud_suspicious",
      "duplicate_order",
      "customer_return",
      "damaged_in_transit",
      "lost_shipment",
      "wrong_item",
      "support_adjustment",
      "test_order_cleanup",
      "other"
    ]),
    adminNote: optionalTrimmed,
    refundType: z.enum(["full", "partial", "none"]),
    partialRefundAmount: optionalMoney,
    returnItemsToStock: checkboxBoolean,
    sendCustomerEmail: checkboxBoolean,
    idempotencyKey: z.string().trim().min(8).max(120)
  })
  .superRefine((input, context) => {
    if (input.refundType === "partial" && (!input.partialRefundAmount || input.partialRefundAmount <= 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partialRefundAmount"],
        message: "Enter a partial refund amount greater than $0."
      });
    }
  });

export const storefrontSettingsSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
  storeLogoUrl: optionalHttpUrl,
  sportsCardsExternalUrl: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    httpUrl.nullable().optional()
  ),
  contactEmail: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.string().trim().email().optional()),
  featuredHeroProductId: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.string().trim().min(2).max(120).nullable().optional()
  ),
  homepageHeroMode: z.enum(["automatic_latest", "manual_product", "brand_only"]).default("automatic_latest"),
  newArrivalDays: z.coerce.number().int().min(1).max(60).default(14),
  showSoldOutInHero: z.preprocess(
    (value) => (value === undefined ? undefined : value === true || value === "true" || value === "on" || value === "1"),
    z.boolean().default(true)
  ),
  returnPolicyText: z.string().trim().max(4000).optional(),
  shippingPolicyText: z.string().trim().max(4000).optional(),
  localPickupInstructions: z.string().trim().max(4000).optional(),
  announcementBanner: z.string().trim().max(240).optional(),
  defaultShippingPrice: optionalMoney.default(5),
  freeShippingThreshold: optionalMoney,
  socialLinks: z.union([z.array(z.string().trim().min(1).max(500)), z.string().trim().max(2000)]).optional()
});

export const orderFulfillmentUpdateSchema = z.object({
  status: z.enum(["contact_message", "invoice_requested", "pending_payment", "paid", "packing", "shipped", "canceled", "refunded"]).optional(),
  fulfillmentStatus: z.enum(["inquiry", "unfulfilled", "packing", "shipped", "pickup_ready", "picked_up", "canceled"]).optional(),
  trackingNumber: optionalTrimmed,
  carrier: optionalTrimmed,
  shippingCost: optionalMoney,
  notes: optionalTrimmed,
  isTestOrder: checkboxBoolean.optional(),
  testOrderReason: z.enum(["stripe_test_mode", "live_checkout_smoke", "email_smoke_test", "shipping_smoke_test", "refund_smoke_test", "other"]).optional()
}).superRefine((input, context) => {
  if (input.isTestOrder === true && !input.testOrderReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["testOrderReason"],
      message: "Select a test/smoke reason before marking this order."
    });
  }
});

export const publicOrderStatusLookupSchema = z.object({
  orderNumber: z.string().trim().min(6).max(80),
  email: z.string().trim().email().max(254)
});

export const inventoryCompCreateSchema = z.object({
  inventoryItemId: z.string().trim().min(2),
  saleTitle: z.string().trim().min(2).max(220),
  salePrice: requiredMoney,
  shippingCharged: optionalMoney,
  soldAt: boundedDate,
  sourceUrl: optionalHttpUrl,
  sourceQuality: compSourceQualitySchema.default("EBAY_SOLD"),
  platform: optionalTrimmed,
  condition: optionalTrimmed,
  quantity: z.coerce.number().int().min(1).max(1000).optional(),
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
