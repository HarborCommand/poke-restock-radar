import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  POS_DEFAULT_TAX_RATE,
  POS_DISCOUNT_REASON_LABELS,
  POS_DISCOUNT_REASON_VALUES,
  POS_REFUND_REASON_LABELS,
  POS_REFUND_REASON_VALUES,
  calculatePosTotals,
  getPosExcludedReason,
  getPosSellableReason,
  isPosSellableInventoryItem,
  normalizePosDiscountReason,
  posItemExactCodeMatch,
  posItemMatchesQuery,
  posDiscountReasonLabel,
  posUnitPrice
} from "../src/lib/pos";
import { posSaleCreateSchema, posSaleRefundSchema } from "../src/lib/validation";
import type { InventoryItemDTO } from "../src/types/radar";

const validPosQuoteId = "q".repeat(80);

function readSource(path: string) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

function posItem(overrides: Partial<InventoryItemDTO> = {}): InventoryItemDTO {
  return {
    id: "item-1",
    itemType: "product",
    itemName: "Pokemon 151 Booster Box",
    category: "booster_boxes",
    taxCategory: null,
    stripeTaxCode: null,
    taxableOverride: null,
    setName: "151",
    productId: "prod-1",
    linkedProductName: null,
    linkedProductRetailer: null,
    linkedProductLivePrice: null,
    linkedProductLiveStockStatus: null,
    cardId: null,
    cost: 80,
    quantity: 4,
    quantityOwned: 4,
    quantitySold: 0,
    averageCost: 80,
    totalCost: 320,
    purchaseExtraCost: null,
    source: "Distributor",
    retailer: "GameDayGrabs",
    brand: "Pokemon",
    description: null,
    manufacturer: null,
    model: null,
    msrp: 120,
    purchasedAt: new Date().toISOString(),
    receiptNumber: null,
    receiptImageUrl: null,
    orderNumber: null,
    transactionId: null,
    sourceStore: null,
    paymentMethod: null,
    exactProductUrl: null,
    upc: "820650858585",
    sku: "PKM-151-BB",
    dpci: null,
    asin: null,
    imageUrl: null,
    condition: "sealed",
    itemStatus: "sealed",
    targetSellPrice: 149.99,
    minimumAcceptablePrice: null,
    listingPlatform: null,
    listingStatus: "listed",
    soldPrice: null,
    soldAt: null,
    buyerPlatform: null,
    currentMarketEstimate: null,
    marketAverageSalePrice: null,
    marketLowestRecentComp: null,
    marketHighestRecentComp: null,
    marketAverageLast3: null,
    marketMedianLast3: null,
    marketCompCount: 0,
    marketLastRefreshedAt: null,
    marketConfidence: "NONE",
    marketProvider: null,
    marketProviderProductId: null,
    marketProviderProductName: null,
    marketProviderMatchStatus: "UNMATCHED",
    marketProviderConfidenceScore: 0,
    marketProviderMatchReason: null,
    marketProviderMatchedAt: null,
    marketProviderLastPricedAt: null,
    grossMarketValue: null,
    netMarketValue: null,
    marketProfitLoss: null,
    marketRoiPercent: null,
    estimatedEbayFee: null,
    estimatedShippingCost: null,
    estimatedNetProfit: null,
    roiPercent: null,
    recommendedAction: "HOLD",
    recommendationReason: null,
    netProfitAfterFees: null,
    publishToStore: true,
    publicSlug: "pokemon-151-booster-box",
    publicTitle: "Pokemon 151 Booster Box",
    publicDescription: null,
    publicPrice: 159.99,
    compareAtPrice: null,
    publicImages: [],
    availableForSale: null,
    maxQuantityPerOrder: 4,
    purchaseLimitEnabled: false,
    shippingProfile: "standard",
    packageWeightOz: null,
    packageLengthIn: null,
    packageWidthIn: null,
    packageHeightIn: null,
    shippingMetadataSource: null,
    freeShippingEligible: false,
    localPickupEligible: true,
    requiresBox: true,
    insuranceRecommended: false,
    needsShippingProfile: false,
    storeStatus: "active",
    localPickupAvailable: true,
    shippingAvailable: true,
    storefrontCategory: null,
    storefrontTags: [],
    publishedAt: null,
    authenticityProofStatus: "missing",
    authenticityReceiptStatus: "missing",
    authenticityPhotoStatus: "missing",
    authenticityUpcVerified: false,
    authenticityNotes: null,
    totalSalesGross: 0,
    totalSalesNet: 0,
    realizedProfitLoss: 0,
    realizedRoiPercent: null,
    businessProfitLoss: null,
    lastThreeComps: [],
    productImages: [],
    stockLots: [],
    sales: [],
    expectedPlan: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test("POS helper uses storefront public price before target sell price", () => {
  assert.equal(posUnitPrice(posItem({ publicPrice: 159.99, targetSellPrice: 149.99 })), 159.99);
  assert.equal(posUnitPrice(posItem({ publicPrice: null, targetSellPrice: 149.99 })), 149.99);
});

test("POS search by name and exact UPC/SKU scan match sellable products", () => {
  const item = posItem();
  assert.equal(posItemMatchesQuery(item, "151 booster"), true);
  assert.equal(posItemExactCodeMatch(item, "820650858585"), true);
  assert.equal(posItemExactCodeMatch(item, "PKM-151-BB"), true);
  assert.equal(posItemExactCodeMatch(item, "missing-code"), false);
});

test("POS helper blocks out-of-stock and unpriced products", () => {
  assert.equal(isPosSellableInventoryItem(posItem({ quantityOwned: 1 })), true);
  assert.equal(isPosSellableInventoryItem(posItem({ quantityOwned: 0 })), false);
  assert.equal(isPosSellableInventoryItem(posItem({ publicPrice: null, targetSellPrice: null })), false);
  assert.equal(getPosExcludedReason(posItem({ quantityOwned: 0 })), "No on-hand quantity");
  assert.equal(getPosExcludedReason(posItem({ publicPrice: null, targetSellPrice: null })), "Missing POS sale price");
  assert.equal(isPosSellableInventoryItem(posItem({ itemStatus: "archived" })), false);
  assert.equal(isPosSellableInventoryItem(posItem({ itemStatus: "disposed" })), false);
  assert.equal(getPosExcludedReason(posItem({ itemStatus: "archived" })), "Archived or disposed");
  assert.equal(getPosExcludedReason(posItem({ itemStatus: "disposed" })), "Archived or disposed");
});

test("POS helper keeps sold-status items sellable when on-hand inventory remains", () => {
  const soldWithInventory = posItem({
    quantity: 4,
    quantityOwned: 3,
    quantitySold: 1,
    listingStatus: "sold",
    publicPrice: 60,
    targetSellPrice: 60
  });

  assert.equal(isPosSellableInventoryItem(soldWithInventory), true);
  assert.equal(getPosSellableReason(soldWithInventory), "Ready for POS sale");
  assert.equal(getPosExcludedReason(soldWithInventory), null);
  assert.equal(posItemExactCodeMatch(soldWithInventory, "820650858585"), true);
  assert.notEqual(getPosExcludedReason(soldWithInventory), "Marked sold");
  assert.equal(isPosSellableInventoryItem(posItem({ quantityOwned: 0, listingStatus: "sold" })), false);
  assert.equal(getPosExcludedReason(posItem({ quantityOwned: 0, listingStatus: "sold" })), "No on-hand quantity");
});

test("POS eligibility is independent of storefront publishing and Google feed readiness", () => {
  const unpublished = posItem({ publishToStore: false, publicSlug: null, storeStatus: "draft", publicPrice: null, targetSellPrice: 24.99 });
  assert.equal(isPosSellableInventoryItem(unpublished), true);
  assert.equal(getPosSellableReason(unpublished), "Ready for POS sale");

  const hiddenStorefrontListing = posItem({ publishToStore: false, storeStatus: "hidden", publicPrice: null, targetSellPrice: 24.99 });
  assert.equal(isPosSellableInventoryItem(hiddenStorefrontListing), true);

  const soldOutStorefrontWithStock = posItem({ storeStatus: "sold_out", quantityOwned: 3, publicPrice: null, targetSellPrice: 24.99 });
  assert.equal(isPosSellableInventoryItem(soldOutStorefrontWithStock), true);

  const heldPlan = posItem({ listingStatus: "held", recommendedAction: "HOLD", expectedPlan: "Hold" });
  assert.equal(isPosSellableInventoryItem(heldPlan), true);
});

test("POS totals calculate subtotal, tax, and total from line snapshots", () => {
  assert.deepEqual(calculatePosTotals([{ quantity: 2, unitPrice: 49.99 }, { quantity: 1, unitPrice: 149.99 }], POS_DEFAULT_TAX_RATE), {
    subtotal: 249.97,
    tax: 0,
    total: 249.97
  });
  assert.deepEqual(calculatePosTotals([{ quantity: 3, unitPrice: 10 }], 0.0625), {
    subtotal: 30,
    tax: 1.88,
    total: 31.88
  });
});

test("POS discount reasons normalize to stable labels", () => {
  assert.deepEqual(POS_DISCOUNT_REASON_VALUES, ["customer_discount", "price_match", "damaged_packaging", "promotion", "owner_override", "other"]);
  assert.equal(normalizePosDiscountReason("price_match"), "price_match");
  assert.equal(posDiscountReasonLabel("damaged_packaging"), POS_DISCOUNT_REASON_LABELS.damaged_packaging);
  assert.equal(normalizePosDiscountReason("not-real"), null);
});

test("POS sale request requires payment method and rejects browser prices or totals", () => {
  const parsed = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    quoteId: validPosQuoteId,
    items: [{ inventoryItemId: "item-1", quantity: 2 }],
    paymentMethod: "cash",
    total: 0,
    unitPrice: 0
  });
  assert.equal(parsed.success, false);

  const missingPayment = posSaleCreateSchema.safeParse({ idempotencyKey: "20260702T120000-test-sale", items: [{ inventoryItemId: "item-1", quantity: 1 }] });
  assert.equal(missingPayment.success, false);

  const missingIdempotency = posSaleCreateSchema.safeParse({ items: [{ inventoryItemId: "item-1", quantity: 1 }], paymentMethod: "cash" });
  assert.equal(missingIdempotency.success, false);
});

test("POS sale request accepts only explicit adjusted price metadata, not fake browser totals", () => {
  const rejected = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    items: [{
      inventoryItemId: "item-1",
      quantity: 1,
      adjustedUnitPrice: "55.00",
      discountReason: "price_match",
      discountNote: "Preview discount",
      unitPrice: 1,
      total: 1
    }],
    paymentMethod: "cash",
    total: 1
  });
  assert.equal(rejected.success, false);

  const parsed = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    quoteId: validPosQuoteId,
    items: [{
      inventoryItemId: "item-1",
      quantity: 1,
      adjustedUnitPrice: "55.00",
      discountReason: "price_match",
      discountNote: "Preview discount"
    }],
    paymentMethod: "cash"
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? Object.keys(parsed.data.items[0]).sort() : [], ["adjustedUnitPrice", "discountNote", "discountReason", "inventoryItemId", "quantity"]);
  assert.equal(parsed.success ? parsed.data.items[0].adjustedUnitPrice : null, 55);

  const zeroPrice = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    quoteId: validPosQuoteId,
    items: [{ inventoryItemId: "item-1", quantity: 1, adjustedUnitPrice: 0, discountReason: "price_match" }],
    paymentMethod: "cash"
  });
  assert.equal(zeroPrice.success, false);

  const invalidReason = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    quoteId: validPosQuoteId,
    items: [{ inventoryItemId: "item-1", quantity: 1, adjustedUnitPrice: 55, discountReason: "fake_reason" }],
    paymentMethod: "cash"
  });
  assert.equal(invalidReason.success, false);
});

test("POS sale request accepts optional customer contact without trusting reward state", () => {
  const rejected = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-contact-sale",
    items: [{ inventoryItemId: "item-1", quantity: 1 }],
    paymentMethod: "zelle",
    selectedCustomerAccountId: "selected-customer",
    customerEmail: "collector@example.test",
    customerPhone: "(555) 123-4567",
    customerAccountId: "browser-fake",
    rewardsEligible: true,
    points: 999
  });
  assert.equal(rejected.success, false);

  const parsed = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-contact-sale",
    quoteId: validPosQuoteId,
    items: [{ inventoryItemId: "item-1", quantity: 1 }],
    paymentMethod: "zelle",
    selectedCustomerAccountId: "selected-customer",
    customerEmail: "collector@example.test",
    customerPhone: "(555) 123-4567"
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? Object.keys(parsed.data).sort() : [], ["customerEmail", "customerPhone", "idempotencyKey", "items", "paymentMethod", "quoteId", "selectedCustomerAccountId"]);

  const invalidEmail = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-contact-sale",
    quoteId: validPosQuoteId,
    items: [{ inventoryItemId: "item-1", quantity: 1 }],
    paymentMethod: "cash",
    customerEmail: "not-an-email"
  });
  assert.equal(invalidEmail.success, false);
});

test("POS API is private admin-only and delegates to server-side sale creation", () => {
  const route = readSource("../src/app/api/radar/pos/sales/route.ts");
  const matchRoute = readSource("../src/app/api/radar/pos/customer-match/route.ts");
  assert.match(route, /requireUser/);
  assert.match(route, /authorizeAdminMutation/);
  assert.match(route, /posSaleCreateSchema\.parse\(await readJson\(request\)\)/);
  assert.match(route, /createPosSale\(user, input\)/);
  assert.match(matchRoute, /requireUser/);
  assert.match(matchRoute, /authorizeAdminMutation\(request, user\)/);
  assert.match(matchRoute, /withPrivateNoStore/);
  assert.match(matchRoute, /withRequestId/);
  assert.match(matchRoute, /posCustomerMatchSchema\.parse\(await readJson\(request\)\)/);
  assert.match(matchRoute, /resolvePosCustomerMatch\(input, user\.id\)/);
  assert.match(matchRoute, /privateOk\(\{ match \}\)/);
  assert.doesNotMatch(matchRoute, /passwordHash|tokenHash|sessionToken|rewardBalance|rewardLedger|savedAddresses|address|authenticityNotes|stripePaymentIntent|stripeCheckout/i);
  assert.doesNotMatch(route, /stripe|checkout|terminal|tapToPay/i);
});

test("POS server revalidates inventory, price, and availability before recording sale", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const posCustomer = readSource("../src/lib/pos-customer.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  assert.match(service, /getPosExcludedReason/);
  assert.match(service, /resolvePosCustomerMatch/);
  assert.match(posCustomer, /workspaceCustomerWhere/);
  assert.match(posCustomer, /findEmailMatches/);
  assert.match(posCustomer, /workspaceCustomerWhereWithLegacy\(client, ownerUserId\)/);
  assert.match(posCustomer, /normalizePosCustomerPhone/);
  assert.match(posCustomer, /phone_possible/);
  assert.match(posCustomer, /phone_multiple/);
  assert.doesNotMatch(posCustomer, /findOrCreateCustomerAccountByNormalizedEmail|customerAccount\.create/);
  assert.match(createPosSale, /tx\.inventoryItem\.findMany/);
  assert.match(createPosSale, /posSaleReferenceFromIdempotencyKey\(currentUser\.id, input\.idempotencyKey\)/);
  assert.match(createPosSale, /receiptForExistingPosSale\(prisma, currentUser, saleReference\)/);
  assert.match(createPosSale, /tx\.inventoryItem\.updateMany/);
  assert.match(createPosSale, /data: \{ updatedAt: soldAt \}/);
  assert.match(createPosSale, /isPosSellableInventoryItem\(dto\)/);
  assert.match(createPosSale, /getPosExcludedReason\(dto\)/);
  assert.match(createPosSale, /cartItem\.quantity > dto\.quantityOwned/);
  assert.match(createPosSale, /const originalUnitPrice = posUnitPrice\(dto\)/);
  assert.match(createPosSale, /normalizePosDiscountReason\(cartItem\.discountReason\)/);
  assert.match(createPosSale, /requestedAdjustedUnitPrice !== null && requestedAdjustedUnitPrice >= originalUnitPrice/);
  assert.match(createPosSale, /Adjusted POS price for \$\{dto\.itemName\} cannot exceed or equal the current POS price in Phase 1/);
  assert.match(createPosSale, /Select a discount reason for \$\{dto\.itemName\}/);
  assert.match(createPosSale, /calculateConfiguredPosTax/);
  assert.match(createPosSale, /saleReference/);
  assert.match(createPosSale, /paymentMethod/);
  assert.match(createPosSale, /customerMatch\.customerAccountId/);
  assert.match(createPosSale, /customerMatch\.customerEmail/);
  assert.match(createPosSale, /customerMatch\.customerPhone/);
  assert.match(createPosSale, /customerMatch\.rewardsEligible/);
  assert.match(createPosSale, /await createPosInventorySaleLine\(tx, currentUser, line/);
  assert.match(createPosSale, /syncInventoryStoreStatusAfterStockChange/);
});

test("POS inventory deduction happens only through completed sale creation path", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  const beforeCreateSale = sourceSlice(createPosSale, "const lines = cartItems.map", "for (const line of linesWithTax)");
  assert.doesNotMatch(beforeCreateSale, /inventoryStockLot\.update|remainingQuantity|recalculateInventorySalesAndLots/);
  assert.match(createPosSale, /await createPosInventorySaleLine\(tx, currentUser, line/);
  assert.match(service, /await tx\.inventoryStockLot\.updateMany/);
  assert.match(service, /remainingQuantity: \{ decrement: quantityFromLot \}/);
  assert.match(service, /await tx\.inventorySale\.create/);
});

test("POS partial sale does not mark the whole product sold while on-hand inventory remains", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createLine = sourceSlice(service, "async function createPosInventorySaleLine", "export async function createPosSale");

  assert.match(createLine, /const availabilityBeforeSale = inventorySaleAvailability\(item\)/);
  assert.match(createLine, /const availabilityAfterSale = Math\.max\(0, availabilityBeforeSale - line\.quantity\)/);
  assert.match(createLine, /availabilityBeforeSale > 0 && availabilityAfterSale <= 0\s*\?\s*"sold"/);
  assert.match(createLine, /item\.listingStatus === "sold" && availabilityAfterSale > 0\s*\?\s*"held"/);
  assert.doesNotMatch(createLine, /totalSold >= item\.quantity && item\.quantity > 0\s*\?\s*"sold"/);
});

test("POS adjusted sale stores original price, adjusted price, discount metadata, and receipt metadata", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createLine = sourceSlice(service, "async function createPosInventorySaleLine", "export async function createPosSale");
  const receipt = sourceSlice(service, "async function receiptForExistingPosSale", "function inventorySaleAvailability");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  assert.match(createLine, /soldPricePerItem: line\.unitPrice/);
  assert.match(createLine, /originalUnitPrice: line\.originalUnitPrice/);
  assert.match(createLine, /adjustedUnitPrice: line\.adjustedUnitPrice/);
  assert.match(createLine, /discountAmount: line\.discountAmount/);
  assert.match(createLine, /discountReason: line\.discountReason/);
  assert.match(createLine, /discountNote: line\.discountNote/);
  assert.match(receipt, /sale\.originalUnitPrice \?\? sale\.soldPricePerItem/);
  assert.match(receipt, /sale\.adjustedUnitPrice \?\? sale\.soldPricePerItem/);
  assert.match(receipt, /normalizePosDiscountReason\(sale\.discountReason\)/);
  assert.match(receipt, /discountReasonLabel: discountReason \? posDiscountReasonLabel\(discountReason\) : null/);
  assert.match(createPosSale, /discountAmount: line\.discountAmount/);
  assert.match(createPosSale, /discountNote: line\.discountNote/);
});

test("POS duplicate submit and same-item oversell are guarded server-side", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  assert.match(service, /function posSaleReferenceFromIdempotencyKey/);
  assert.match(createPosSale, /const existingReceipt = await receiptForExistingPosSale\(prisma, currentUser, saleReference\)/);
  assert.match(createPosSale, /const duplicateReceipt = await receiptForExistingPosSale\(tx, currentUser, saleReference\)/);
  assert.match(createPosSale, /const receipt = await runRewardSerializableTransaction\(async \(tx\) =>/);
  assert.match(createPosSale, /const sortedCartItems = \[\.\.\.cartItems\]\.sort/);
  assert.match(createPosSale, /await tx\.inventoryItem\.updateMany/);
  assert.match(service, /remainingQuantity: \{ gte: quantityFromLot \}/);
  assert.match(service, /if \(updated\.count !== 1\)/);
  assert.match(service, /Duplicate POS cart lines for the same item must use the same price adjustment/);
});

test("POS client sends idempotency key and clamps cart quantities to available stock", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(app, /function newPosSaleIdempotencyKey/);
  assert.match(posPanel, /const \[saleIdempotencyKey, setSaleIdempotencyKey\]/);
  assert.match(posPanel, /idempotencyKey: saleIdempotencyKey/);
  assert.match(posPanel, /adjustedUnitPrice: line\.discountAmount > 0 \? line\.adjustedUnitPrice : undefined/);
  assert.match(posPanel, /discountReason: line\.discountAmount > 0 \? line\.discountReason \?\? undefined : undefined/);
  assert.match(posPanel, /setSaleIdempotencyKey\(newPosSaleIdempotencyKey\(\)\)/);
  assert.match(posPanel, /Math\.min\(item\.quantityOwned, quantity\)/);
  assert.match(posPanel, /if \(submitting\) return/);
  assert.match(posPanel, /disabled=\{submitting\}/);
  assert.match(posPanel, /aria-label=\{`Decrease \$\{posDisplayTitle\(line\.item\)\} quantity`\}/);
  assert.match(posPanel, /aria-label=\{`Increase \$\{posDisplayTitle\(line\.item\)\} quantity`\}/);
});

test("POS tab renders for admin with scan, cart, payment, and confirmation affordances", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  assert.match(app, /\{ id: "pos", label: "POS"/);
  assert.match(app, /activeTab === "pos" && isAdmin/);
  assert.match(app, /Scanner tip: scan a barcode or type UPC\/SKU and press Enter\./);
  assert.match(app, /inventory products/);
  assert.match(app, /POS sellable/);
  assert.match(app, /excluded/);
  assert.match(app, /Ready for POS/);
  assert.match(app, /Excluded/);
  assert.match(app, /All inventory/);
  assert.match(app, /aria-label="POS inventory view"/);
  assert.doesNotMatch(app, /Hide excluded/);
  assert.match(app, /Cart \(\{cartQuantity\}\)/);
  assert.match(app, /Payment Method/);
  assert.match(app, /Confirm Sale/);
  assert.match(app, /Clear/);
  assert.match(app, /Math\.min\(item\.quantityOwned, quantity\)/);
});

test("POS cart exposes line-item price adjustment UI without saving immediately", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const css = readSource("../src/app/globals.css");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(app, /type PosPriceAdjustmentDraft/);
  assert.match(posPanel, /priceAdjustmentDraft/);
  assert.match(posPanel, /openPriceAdjustment\(line\)/);
  assert.match(posPanel, /Adjust price/);
  assert.match(posPanel, /Edit discount/);
  assert.match(posPanel, /Remove discount/);
  assert.match(posPanel, /aria-label="Adjust POS price"/);
  assert.match(posPanel, /Current POS unit price/);
  assert.match(posPanel, /New POS unit price/);
  assert.match(posPanel, /Discount/);
  assert.match(posPanel, /POS_DISCOUNT_REASON_VALUES\.map/);
  assert.match(posPanel, /This only updates the POS cart/);
  assert.match(posPanel, /setCart\(\(current\) =>\s*current\.map/);
  assert.doesNotMatch(sourceSlice(posPanel, "function openPriceAdjustment", "function clearCart"), /requestJson|createPosSale|api\/radar\/pos\/sales/);
  assert.match(css, /\.pos-price-adjust-modal/);
  assert.match(css, /\.pos-line-price-stack/);
  assert.match(css, /\.pos-line-discount/);
});

test("POS cart exposes customer profile search and explicit selection", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /Customer \(optional\)/);
  assert.match(posPanel, /Search by name, email, or phone/);
  assert.match(posPanel, /searchPosCustomers/);
  assert.match(posPanel, /\/api\/radar\/customers\?/);
  assert.match(posPanel, /\/api\/radar\/pos\/customer-match/);
  assert.match(posPanel, /CustomerSearchProfileCard/);
  assert.match(posPanel, /CustomerProfileSummaryCard/);
  assert.match(posPanel, /View Profile/);
  assert.match(app, /Select Customer/);
  assert.match(posPanel, /Clear Customer/);
  assert.match(posPanel, /Search is discovery only/);
  assert.match(posPanel, /Eligible after sale/);
  assert.match(posPanel, /selectedCustomerAccountId: selectedCustomer\?\.id/);
  assert.doesNotMatch(posPanel, /Customer email/);
  assert.doesNotMatch(posPanel, /Customer phone/);
  assert.doesNotMatch(posPanel, /Phone alone never awards points/);
  assert.doesNotMatch(posPanel, /customerEmail: customerEmail\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(posPanel, /customerPhone: customerPhone\.trim\(\) \|\| undefined/);
});

test("POS receipt masks optional customer contact without exposing account identifiers", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const receipt = sourceSlice(app, "function PosReceipt", "function ProfitLossPanel");
  const receiptSummary = sourceSlice(app, "function maskPosReceiptEmail", "function PosPanel");
  assert.match(receiptSummary, /maskPosReceiptEmail/);
  assert.match(receiptSummary, /maskPosReceiptPhone/);
  assert.match(receipt, /maskPosReceiptEmail\(receipt\.customerEmail\)/);
  assert.match(receipt, /maskPosReceiptPhone\(receipt\.customerPhone\)/);
  assert.match(receipt, /receipt\.rewardPointsEarned > 0/);
  assert.match(receipt, /point\{receipt\.rewardPointsEarned === 1 \? "" : "s"\} earned/);
  assert.match(receipt, /POS rewards are not active yet/);
  assert.match(receiptSummary, /receipt\.rewardPointsEarned > 0/);
  assert.doesNotMatch(receipt + receiptSummary, /Customer account ID|internal ID|\$\{receipt\.customerAccountId\}/i);
});
test("POS price adjustment client validation requires valid lower price and reason", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /Enter a valid POS unit price\./);
  assert.match(posPanel, /New POS price must be greater than \$0\./);
  assert.match(posPanel, /Phase 1 only allows lowering the POS unit price\./);
  assert.match(posPanel, /Select a discount reason\./);
  assert.match(posPanel, /nextPrice >= line\.originalUnitPrice/);
  assert.match(posPanel, /discountReason: priceAdjustmentDraft\.reason \|\| undefined/);
});

test("POS empty cart keeps payment and completion inactive", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /const cartEmpty = cartLines\.length === 0/);
  assert.match(posPanel, /cartEmpty \|\| !paymentMethod/);
  assert.match(posPanel, /Add item to complete sale/);
  assert.match(posPanel, /Payment options activate after an item is in the cart\./);
  assert.match(posPanel, /disabled=\{cartEmpty\}/);
  assert.match(posPanel, /disabled=\{!cart\.length \|\| submitting\}/);
  assert.match(posPanel, /Cart is empty/);
  assert.match(posPanel, /Search or scan a product to start an in-person sale\./);
});

test("POS scanner feedback handles exact add, no match, and ambiguous code safely", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /dashboard\.inventory\.filter\(\(item\) => posItemExactCodeMatch\(item, query\)\)/);
  assert.match(posPanel, /exactSellableMatches/);
  assert.match(posPanel, /addToCart\(exactSellableMatches\[0\]\)/);
  assert.match(posPanel, /Product found but excluded from POS/);
  assert.match(posPanel, /getPosExcludedReason\(exactMatches\[0\]\)/);
  assert.match(posPanel, /setInventoryView\("excluded"\)/);
  assert.match(posPanel, /No product found for this UPC\/SKU\./);
  assert.match(posPanel, /Multiple products matched that code/);
  assert.match(posPanel, /searchInputRef\.current\?\.focus\(\)/);
});

test("POS quantity and product cards show low stock, added feedback, and max available state", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const css = readSource("../src/app/globals.css");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /recentlyAddedItemId/);
  assert.match(posPanel, /Added/);
  assert.match(posPanel, /Max available reached\./);
  assert.match(posPanel, /Low stock/);
  assert.match(posPanel, /On hand: \{item\.quantityOwned\}/);
  assert.match(posPanel, /getPosSellableReason\(item\)/);
  assert.match(css, /\.pos-product-card\.just-added/);
  assert.match(css, /\.pos-stock-warning/);
  assert.match(css, /\.pos-max-message/);
  assert.match(css, /\.pos-product-card:hover/);
  assert.match(css, /\.pos-filter:focus-visible/);
  assert.match(css, /\.pos-payment:focus-visible/);
  assert.match(css, /\.pos-add-button:focus-visible/);
  assert.match(css, /\.pos-cart-quantity\s*\{[\s\S]*grid-template-columns:\s*40px minmax\(38px, 1fr\) 40px/);
});

test("POS product list does not silently cap results and exposes excluded reasons", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const css = readSource("../src/app/globals.css");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");

  assert.match(posPanel, /POS_RESULT_BATCH_SIZE/);
  assert.match(app, /type PosInventoryView = "sellable" \| "excluded" \| "all"/);
  assert.match(app, /posInventoryViews/);
  assert.match(posPanel, /useState<PosInventoryView>\("sellable"\)/);
  assert.match(posPanel, /inventoryView === "sellable" \? sellableItems : inventoryView === "excluded" \? excludedItems : allInventoryItems/);
  assert.match(posPanel, /filteredViewItems\.slice\(0, visibleLimit\)/);
  assert.match(posPanel, /posInventoryResultsTitle\(inventoryView, filteredViewItems\.length\)/);
  assert.match(posPanel, /posInventoryShowMoreLabel\(inventoryView\)/);
  assert.match(app, /Search Results/);
  assert.match(app, /Excluded Products/);
  assert.match(app, /Inventory Results/);
  assert.match(posPanel, /Excluded from POS: \{excludedReason\}/);
  assert.match(posPanel, /title=\{sellable \? undefined : excludedReason\}/);
  assert.match(posPanel, /sellable \? \(added \? "Added" : canAdd \? "Add" : "Max added"\) : "Excluded"/);
  assert.match(posPanel, /getPosExcludedReason\(item\)/);
  assert.match(css, /\.pos-inventory-status/);
  assert.match(css, /\.pos-view-chip/);
  assert.match(css, /\.pos-product-card\.excluded/);
  assert.match(css, /\.pos-excluded-reason/);
  assert.match(css, /\.pos-load-more/);
});

test("POS confirmation modal shows server tax quote, payment, reference, and warning before final submit", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /aria-label="Confirm POS sale"/);
  assert.match(posPanel, /pos-confirm-lines/);
  assert.match(posPanel, /Original \{money\(line\.originalUnitPrice\)\} - POS \{money\(line\.adjustedUnitPrice\)\}/);
  assert.match(posPanel, /line\.discountReasonLabel/);
  assert.match(posPanel, /taxQuote\?\.merchandiseSubtotal/);
  assert.match(posPanel, /taxQuote\?\.taxableSubtotal/);
  assert.match(posPanel, /taxQuote\.stateTax/);
  assert.match(posPanel, /taxQuote\.countySurtax/);
  assert.match(posPanel, /money\(quotedTotal\)/);
  assert.match(posPanel, /Payment <strong>\{paymentMethod \? posPaymentMethodLabel\(paymentMethod\) : "Not selected"\}/);
  assert.match(posPanel, /Reference <strong>\{maskPosPaymentReference\(paymentReference\)\}/);
  assert.match(posPanel, /This will record the sale and deduct inventory/);
  assert.match(posPanel, /Close or cancel does not save anything/);
  assert.match(posPanel, /Confirming/);
});
test("POS receipt success state includes operational, tax, refund, and copy metadata", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const receipt = sourceSlice(app, "function PosReceipt", "function ProfitLossPanel");
  assert.match(app, /function posReceiptSummary/);
  assert.match(app, /GameDayGrabs/);
  assert.match(app, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
  assert.match(app, /Date: \$\{dateTime\(receipt\.completedAt\)\}/);
  assert.match(app, /POS price \$\{money\(line\.adjustedUnitPrice\)\}/);
  assert.match(app, /discount \$\{money\(line\.discountAmount\)\}/);
  assert.match(receipt, /Sale Complete/);
  assert.match(receipt, /gamedaygrabs-logo-horizontal\.png/);
  assert.match(receipt, /receipt\.saleReference/);
  assert.match(receipt, /dateTime\(receipt\.completedAt\)/);
  assert.match(receipt, /receipt\.cashierName/);
  assert.match(receipt, /receipt\.registerLabel/);
  assert.match(receipt, /receipt\.paymentMethodLabel/);
  assert.match(receipt, /receipt\.paymentReference/);
  assert.match(receipt, /receipt\.subtotal/);
  assert.match(receipt, /receipt\.stateTax/);
  assert.match(receipt, /receipt\.countySurtax/);
  assert.match(receipt, /receipt\.refundedAmount/);
  assert.match(receipt, /receipt\.refundedTax/);
  assert.match(receipt, /line\.discountAmount > 0/);
  assert.match(receipt, /New Sale/);
  assert.match(receipt, /Copy Receipt/);
  assert.match(receipt, /Print Receipt/);
  assert.match(receipt, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
});
test("POS mobile layout keeps cart and product rows compact without obvious overflow risk", () => {
  const css = readSource("../src/app/globals.css");
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.pos-workspace\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.pos-scan-row,[\s\S]*\.pos-result-grid,[\s\S]*\.pos-product-card,[\s\S]*\.pos-cart-line,[\s\S]*\.pos-receipt/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.pos-view-row,[\s\S]*?\.pos-filter-row\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?overflow: visible;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.pos-product-card\s*\{[\s\S]*?grid-template-columns: 64px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.pos-product-card \.inventory-image-frame\s*\{[\s\S]*?width: 64px;[\s\S]*?height: 64px;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.pos-cart-line\s*\{[\s\S]*?grid-template-columns: 56px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.pos-confirm-modal,[\s\S]*?\.pos-price-adjust-modal,[\s\S]*?max-height: calc\(100dvh - 24px\);/);
  assert.match(css, /\.pos-cart-panel\s*\{[\s\S]*position:\s*sticky/);
});

test("POS change is isolated from public checkout, shipping, refunds, and live payments", () => {
  const checkoutRoute = readSource("../src/app/api/storefront/checkout/route.ts");
  const shippingPolicy = readSource("../src/lib/shipping-policy.ts");
  const refundRoute = readSource("../src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts");
  assert.doesNotMatch(checkoutRoute, /createPosSale|posSale|api\/radar\/pos|terminal|tapToPay/i);
  assert.doesNotMatch(shippingPolicy, /createPosSale|posSale|api\/radar\/pos|terminal|tapToPay/i);
  assert.doesNotMatch(refundRoute, /createPosSale|posSale|api\/radar\/pos|terminal|tapToPay/i);
});

test("POS customer contact fields stay out of public storefront surfaces", () => {
  const types = readSource("../src/types/radar.ts");
  const publicProduct = sourceSlice(types, "export type PublicStoreProductDTO", "export type StorefrontSettingsDTO");
  const feed = readSource("../src/lib/storefront-product-feed.ts");
  const storefrontSeo = readSource("../src/lib/storefront-seo.ts");
  const storeClient = readSource("../src/components/StorefrontClient.tsx");
  const accountPages = readSource("../src/components/CustomerAccountPages.tsx");

  for (const source of [publicProduct, feed, storefrontSeo, storeClient, accountPages]) {
    assert.doesNotMatch(source, /customerMatchMethod|rewardsEligible|customerAccountId.*pos|POS customer|pos customer/i);
  }
});

test("POS customer capture stays out of account and public product output", () => {
  const accountPages = readSource("../src/components/CustomerAccountPages.tsx");
  const storefront = readSource("../src/lib/storefront.ts");
  const feed = readSource("../src/lib/storefront-product-feed.ts");
  const seo = readSource("../src/lib/storefront-seo.ts");
  const publicProductMapper = sourceSlice(storefront, "function publicProductToDTO", "export async function getStorefrontSettings");

  for (const source of [accountPages, publicProductMapper, feed, seo]) {
    assert.doesNotMatch(source, /InventorySale|customerMatchMethod|rewardsEligible|customerPhone|POS receipt|POS customer|refundNote|authenticityNotes/i);
  }
});

test("POS rewards are server-side, separately flagged, and excluded from browser authority", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const route = readSource("../src/app/api/radar/pos/sales/route.ts");
  const posCustomer = readSource("../src/lib/pos-customer.ts");
  const rewards = readSource("../src/lib/customer-rewards.ts");
  const customerConfig = readSource("../src/lib/customer-accounts.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");

  assert.match(posCustomer, /customerPosRewardsEnabled/);
  assert.match(posCustomer, /selectedCustomerAccountId/);
  assert.match(posCustomer, /accountById\(client, selectedCustomerAccountId, ownerUserId\)/);
  assert.match(createPosSale, /await awardRewardsForCompletedPosSale/);
  assert.match(createPosSale, /eligibleSubtotalCents: totals\.subtotalCents - totals\.discountCents/);
  assert.match(customerConfig, /CUSTOMER_POS_REWARDS_ENABLED/);
  assert.match(rewards, /customerPosRewardsEnabled/);
  assert.match(rewards, /idempotencyKey: `rewards:pos:earn:\$\{input\.saleReference\}`/);
  assert.match(rewards, /source: rewardSources\.pos/);
  assert.match(rewards, /availableDelta: points/);
  assert.match(rewards, /lifetimeEarnedDelta: points/);
  assert.match(rewards, /Manual POS rewards are available immediately after completed sale/);
  assert.doesNotMatch(route, /rewardPoints|points|customerAccountId|rewardsEligible/i);
  assert.match(createPosSale, /selectedCustomerAccountId: input\.selectedCustomerAccountId/);
  assert.doesNotMatch(createPosSale, /input\.customerAccountId|input\.rewardsEligible|input\.points/i);
  assert.doesNotMatch(createPosSale, /releasePendingRewardsForOrder|awardRewardsForPaidOrder/i);
});

test("POS refund request requires an idempotency key, reason, and full manual refund type", () => {
  const parsed = posSaleRefundSchema.safeParse({
    idempotencyKey: "pos-refund-test-1",
    refundType: "full",
    reason: "customer_return",
    restoreInventory: "true"
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success ? parsed.data.reason : null, "customer_return");
  assert.equal(parsed.success ? parsed.data.restoreInventory : null, true);
  assert.deepEqual(POS_REFUND_REASON_VALUES, ["customer_return", "damaged_product", "wrong_item", "duplicate_sale", "price_correction", "other"]);
  assert.equal(POS_REFUND_REASON_LABELS.price_correction, "Price correction");

  assert.equal(posSaleRefundSchema.safeParse({ idempotencyKey: "pos-refund-test-2", refundType: "full", restoreInventory: "true" }).success, false);
  assert.equal(posSaleRefundSchema.safeParse({ idempotencyKey: "pos-refund-test-3", refundType: "partial", reason: "customer_return" }).success, false);
});

test("Sales detail exposes POS receipt copy print and refund controls", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const saleDetails = sourceSlice(app, "function SaleDetailsModal", "function EditSaleModal");
  assert.match(saleDetails, /Print receipt/);
  assert.match(saleDetails, /Copy receipt/);
  assert.match(saleDetails, /Manual refund records the refund in admin/);
  assert.match(saleDetails, /It does not send money through Stripe or Zelle automatically/);
  assert.match(saleDetails, /Record Refund/);
  assert.match(saleDetails, /POS_REFUND_REASON_VALUES\.map/);
  assert.match(saleDetails, /restoreInventory/);
  assert.match(saleDetails, /encodeURIComponent\(sale\.saleReference/);
});

test("Sales detail shows POS metadata and discount details", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const saleDetails = sourceSlice(app, "function SaleDetailsModal", "function EditSaleModal");
  assert.match(saleDetails, /Payment Method/i);
  assert.match(saleDetails, /Payment Reference/i);
  assert.match(saleDetails, /Sale Reference/i);
  assert.match(saleDetails, /Rewards/);
  assert.match(app, /function saleRewardLabel/);
  assert.match(app, /Rewards awarded/);
  assert.match(app, /Rewards reversed/);
  assert.match(saleDetails, /Discount details/);
  assert.match(saleDetails, /Original \{money\(rowSale\.originalUnitPrice/);
  assert.match(saleDetails, /adjusted \{money\(rowSale\.adjustedUnitPrice/);
  assert.match(saleDetails, /Discount \{money\(rowSale\.discountAmount\)/);
});

test("POS refund route is admin-only, records manual refunds, and does not call Stripe", () => {
  const route = readSource("../src/app/api/radar/pos/sales/[saleReference]/refund/route.ts");
  const service = readSource("../src/lib/radar-service.ts");
  const rewards = readSource("../src/lib/customer-rewards.ts");
  const refundPosSale = sourceSlice(service, "export async function refundPosSale", "export async function updateInventorySale");

  assert.match(route, /requireUser/);
  assert.match(route, /authorizeAdminMutation\(request, user\)/);
  assert.match(route, /posSaleRefundSchema\.parse/);
  assert.match(route, /refundPosSale/);
  assert.match(refundPosSale, /platform:\s*"pos"/);
  assert.match(refundPosSale, /refundIdempotencyKey/);
  assert.match(refundPosSale, /This POS sale has already been fully refunded/);
  assert.match(refundPosSale, /inventoryStockLot\.create/);
  assert.match(refundPosSale, /POS refund return/);
  assert.match(refundPosSale, /await reverseRewardsForPosSale/);
  assert.match(refundPosSale, /saleReference: normalizedReference/);
  assert.match(rewards, /rewardRefundIdempotencyKey/);
  assert.match(rewards, /`rewards:pos:refund:\$\{input\.saleReference\}`/);
  assert.match(service, /Manual refund record only/);
  assert.doesNotMatch(route + refundPosSale, /stripeClient|stripe\.refunds|refunds\.create|Stripe Terminal|tapToPay/i);
});

test("POS refund inventory restoration clears stale sold listing state", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const recalculate = sourceSlice(service, "async function recalculateInventorySalesAndLots", "export async function createInventoryItem");

  assert.match(recalculate, /const totalOnHand = \[\.\.\.virtualRemaining\.values\(\)\]\.reduce/);
  assert.match(recalculate, /item\.listingStatus === "sold" && totalOnHand > 0\s*\?\s*"held"/);
  assert.match(recalculate, /totalSold >= item\.quantity && item\.quantity > 0 && totalOnHand <= 0/);
});
