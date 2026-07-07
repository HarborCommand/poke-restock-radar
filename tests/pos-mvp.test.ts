import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  POS_DEFAULT_TAX_RATE,
  calculatePosTotals,
  getPosExcludedReason,
  getPosSellableReason,
  isPosSellableInventoryItem,
  posItemExactCodeMatch,
  posItemMatchesQuery,
  posUnitPrice
} from "../src/lib/pos";
import { posSaleCreateSchema } from "../src/lib/validation";
import type { InventoryItemDTO } from "../src/types/radar";

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
  assert.equal(isPosSellableInventoryItem(posItem({ listingStatus: "sold" })), false);
  assert.equal(getPosExcludedReason(posItem({ quantityOwned: 0 })), "No on-hand quantity");
  assert.equal(getPosExcludedReason(posItem({ publicPrice: null, targetSellPrice: null })), "Missing POS sale price");
  assert.equal(getPosExcludedReason(posItem({ listingStatus: "sold" })), "Marked sold");
});

test("POS eligibility is independent of storefront publishing and Google feed readiness", () => {
  const unpublished = posItem({ publishToStore: false, publicSlug: null, storeStatus: "draft", publicPrice: null, targetSellPrice: 24.99 });
  assert.equal(isPosSellableInventoryItem(unpublished), true);
  assert.equal(getPosSellableReason(unpublished), "Ready for POS sale");

  const hiddenStorefrontListing = posItem({ publishToStore: false, storeStatus: "hidden", publicPrice: null, targetSellPrice: 24.99 });
  assert.equal(isPosSellableInventoryItem(hiddenStorefrontListing), true);

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

test("POS sale request requires payment method and never accepts browser prices or totals", () => {
  const parsed = posSaleCreateSchema.safeParse({
    idempotencyKey: "20260702T120000-test-sale",
    items: [{ inventoryItemId: "item-1", quantity: 2 }],
    paymentMethod: "cash",
    total: 0,
    unitPrice: 0
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? Object.keys(parsed.data).sort() : [], ["idempotencyKey", "items", "paymentMethod"]);

  const missingPayment = posSaleCreateSchema.safeParse({ idempotencyKey: "20260702T120000-test-sale", items: [{ inventoryItemId: "item-1", quantity: 1 }] });
  assert.equal(missingPayment.success, false);

  const missingIdempotency = posSaleCreateSchema.safeParse({ items: [{ inventoryItemId: "item-1", quantity: 1 }], paymentMethod: "cash" });
  assert.equal(missingIdempotency.success, false);
});

test("POS API is private admin-only and delegates to server-side sale creation", () => {
  const route = readSource("../src/app/api/radar/pos/sales/route.ts");
  assert.match(route, /requireUser/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /posSaleCreateSchema\.parse\(await readJson\(request\)\)/);
  assert.match(route, /createPosSale\(user, input\)/);
  assert.doesNotMatch(route, /stripe|checkout|terminal|tapToPay/i);
});

test("POS server revalidates inventory, price, and availability before recording sale", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  assert.match(service, /getPosExcludedReason/);
  assert.match(createPosSale, /tx\.inventoryItem\.findMany/);
  assert.match(createPosSale, /posSaleReferenceFromIdempotencyKey\(currentUser\.id, input\.idempotencyKey\)/);
  assert.match(createPosSale, /receiptForExistingPosSale\(prisma, currentUser, saleReference\)/);
  assert.match(createPosSale, /tx\.inventoryItem\.updateMany/);
  assert.match(createPosSale, /data: \{ updatedAt: soldAt \}/);
  assert.match(createPosSale, /isPosSellableInventoryItem\(dto\)/);
  assert.match(createPosSale, /getPosExcludedReason\(dto\)/);
  assert.match(createPosSale, /cartItem\.quantity > dto\.quantityOwned/);
  assert.match(createPosSale, /const unitPrice = posUnitPrice\(dto\)/);
  assert.match(createPosSale, /calculatePosTotals\(lines, taxRate\)/);
  assert.match(createPosSale, /saleReference/);
  assert.match(createPosSale, /paymentMethod/);
  assert.match(createPosSale, /await createPosInventorySaleLine\(tx, currentUser, line/);
  assert.match(createPosSale, /syncInventoryStoreStatusAfterStockChange/);
});

test("POS inventory deduction happens only through completed sale creation path", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  const beforeCreateSale = sourceSlice(createPosSale, "const lines = cartItems.map", "for (const line of lines)");
  assert.doesNotMatch(beforeCreateSale, /inventoryStockLot\.update|remainingQuantity|recalculateInventorySalesAndLots/);
  assert.match(createPosSale, /await createPosInventorySaleLine\(tx, currentUser, line/);
  assert.match(service, /await tx\.inventoryStockLot\.updateMany/);
  assert.match(service, /remainingQuantity: \{ decrement: quantityFromLot \}/);
  assert.match(service, /await tx\.inventorySale\.create/);
});

test("POS duplicate submit and same-item oversell are guarded server-side", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  assert.match(service, /function posSaleReferenceFromIdempotencyKey/);
  assert.match(createPosSale, /const existingReceipt = await receiptForExistingPosSale\(prisma, currentUser, saleReference\)/);
  assert.match(createPosSale, /const duplicateReceipt = await receiptForExistingPosSale\(tx, currentUser, saleReference\)/);
  assert.match(createPosSale, /const receipt = await prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(createPosSale, /const sortedCartItems = \[\.\.\.cartItems\]\.sort/);
  assert.match(createPosSale, /await tx\.inventoryItem\.updateMany/);
  assert.match(service, /remainingQuantity: \{ gte: quantityFromLot \}/);
  assert.match(service, /if \(updated\.count !== 1\)/);
});

test("POS client sends idempotency key and clamps cart quantities to available stock", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(app, /function newPosSaleIdempotencyKey/);
  assert.match(posPanel, /const \[saleIdempotencyKey, setSaleIdempotencyKey\]/);
  assert.match(posPanel, /idempotencyKey: saleIdempotencyKey/);
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
  assert.match(app, /Show excluded/);
  assert.match(app, /Excluded from POS/);
  assert.match(app, /Cart \(\{cartQuantity\}\)/);
  assert.match(app, /Payment Method/);
  assert.match(app, /Confirm Sale/);
  assert.match(app, /Clear/);
  assert.match(app, /Math\.min\(item\.quantityOwned, quantity\)/);
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
  assert.match(posPanel, /filteredSellableItems\.slice\(0, visibleLimit\)/);
  assert.match(posPanel, /Show more POS products/);
  assert.match(posPanel, /filteredExcludedItems\.slice\(0, 12\)/);
  assert.match(posPanel, /Add disabled/);
  assert.match(posPanel, /getPosExcludedReason\(item\)/);
  assert.match(css, /\.pos-inventory-status/);
  assert.match(css, /\.pos-product-card\.excluded/);
  assert.match(css, /\.pos-excluded-reason/);
  assert.match(css, /\.pos-load-more/);
});

test("POS confirmation modal shows item lines, totals, payment, reference, and warning before final submit", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /aria-label="Confirm POS sale"/);
  assert.match(posPanel, /pos-confirm-lines/);
  assert.match(posPanel, /Subtotal <strong>\{money\(cartTotals\.subtotal\)\}/);
  assert.match(posPanel, /Tax <strong>\{money\(cartTotals\.tax\)\}/);
  assert.match(posPanel, /Payment <strong>\{paymentMethod \? posPaymentMethodLabel\(paymentMethod\) : "Not selected"\}/);
  assert.match(posPanel, /Reference <strong>\{paymentReference\.trim\(\)\}/);
  assert.match(posPanel, /This will record the sale and deduct inventory/);
  assert.match(posPanel, /Close or cancel does not save anything/);
  assert.match(posPanel, /Confirming/);
});

test("POS receipt success state includes metadata and copy receipt affordance", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const receipt = sourceSlice(app, "function PosReceipt", "function ProfitLossPanel");
  assert.match(app, /function posReceiptSummary/);
  assert.match(app, /GameDayGrabs/);
  assert.match(app, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
  assert.match(app, /Date: \$\{dateTime\(receipt\.completedAt\)\}/);
  assert.match(receipt, /Sale Complete/);
  assert.match(receipt, /GameDayGrabs/);
  assert.match(receipt, /Inventory updated/);
  assert.match(receipt, /receipt\.saleReference/);
  assert.match(receipt, /dateTime\(receipt\.completedAt\)/);
  assert.match(receipt, /receipt\.paymentMethodLabel/);
  assert.match(receipt, /receipt\.paymentReference/);
  assert.match(receipt, /receipt\.subtotal/);
  assert.match(receipt, /receipt\.tax/);
  assert.match(receipt, /New Sale/);
  assert.match(receipt, /Copy Receipt/);
  assert.match(receipt, /Print Receipt/);
  assert.match(receipt, /GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL/);
});

test("POS mobile layout keeps cart and product rows stacked without obvious overflow risk", () => {
  const css = readSource("../src/app/globals.css");
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.pos-workspace\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.pos-scan-row,[\s\S]*\.pos-result-grid,[\s\S]*\.pos-product-card,[\s\S]*\.pos-cart-line,[\s\S]*\.pos-receipt/);
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

test("POS manual sales do not participate in Phase 1 rewards", () => {
  const service = readSource("../src/lib/radar-service.ts");
  const route = readSource("../src/app/api/radar/pos/sales/route.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");

  assert.doesNotMatch(createPosSale + route, /awardRewardsForPaidOrder|releasePendingRewardsForOrder|reverseRewardsForOrder|rewardLedgerEntry|RewardLedgerEntry|rewardBalance|points/i);
});
