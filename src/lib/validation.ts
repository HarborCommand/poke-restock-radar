import { z } from "zod";

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const ratingSchema = z.enum(["BUY", "WATCH", "SKIP", "AVOID"]);
export const gradeTypeSchema = z.enum(["RAW", "PSA_9", "PSA_10", "BGS_9_5", "BGS_10", "BGS_BLACK_LABEL"]);
export const eraSchema = z.enum(["MODERN", "VINTAGE"]);
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

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2),
  retailerId: z.string().min(1),
  releaseId: optionalTrimmed,
  setName: optionalTrimmed,
  productType: optionalTrimmed,
  url: httpUrl,
  sku: optionalSkuLike,
  upc: optionalUpc,
  dpci: optionalDpci,
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

export const storeCreateSchema = z.object({
  retailerId: z.string().min(1),
  storeName: z.string().trim().min(2),
  address: z.string().trim().min(2),
  city: z.string().trim().min(2),
  state: z.string().trim().min(2).max(24),
  typicalRestockDays: z.string().trim().min(2),
  typicalRestockTimeWindow: z.string().trim().min(2),
  vendorNotes: optionalTrimmed,
  confidenceScore: z.coerce.number().int().min(0).max(100).default(50),
  notes: optionalTrimmed
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
  lastRefreshed: boundedDate.default(() => new Date()),
  notes: optionalTrimmed,
  characterName: optionalTrimmed,
  era: eraSchema.default("MODERN"),
  lowPop: checkboxBoolean,
  newRelease: checkboxBoolean,
  lowNumberedSerialized: checkboxBoolean,
  strongCharacterDemand: checkboxBoolean
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
  minimumPriority: prioritySchema.default("LOW")
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
  salePrice: requiredMoney,
  soldAt: boundedDate,
  sourceUrl: optionalHttpUrl,
  conditionNotes: optionalTrimmed,
  characterName: optionalTrimmed,
  era: eraSchema.default("MODERN"),
  lowNumberedSerialized: checkboxBoolean,
  strongCharacterDemand: checkboxBoolean,
  lowPop: checkboxBoolean,
  newRelease: checkboxBoolean
});

export const investmentSettingsSchema = z.object({
  gradingCost: requiredMoney.default(20),
  ebaySellingFee: z.coerce.number().min(0).max(0.5).default(0.1325),
  shippingCost: requiredMoney.default(5),
  minimumProfitTarget: requiredMoney.default(20)
});

export const bulkImportSchema = z.object({
  format: z.enum(["csv", "json"]),
  data: z.string().trim().min(2)
});
