import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractPublicImageUrlFromHtml,
  isLikelyDirectProductImageUrl
} from "../src/lib/image-url-resolver";

import {
  inventoryCreateSchema,
  inventoryImageSanitizationMessage,
  inventoryProductImageCreateSchema,
  inventoryProductImageUpdateSchema,
  inventoryStockLotUpdateSchema,
  inventoryStoreListingSchema,
  sanitizeInventoryImagePayload,
  sanitizePublicImageUrl
} from "../src/lib/validation";

const baseInventoryPayload = {
  itemName: "Pokemon Test Booster Bundle",
  category: "booster_bundles",
  cost: 6.99,
  quantity: 3,
  source: "Target",
  purchasedAt: "2026-06-12"
};

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

test("inventory image URLs keep normal hosted URLs and public paths", () => {
  const hosted = sanitizePublicImageUrl(" https://example.com/product.png ");
  const relative = sanitizePublicImageUrl("/brand/gamedaygrabs-icon.png");

  assert.equal(hosted.value, "https://example.com/product.png");
  assert.equal(relative.value, "/brand/gamedaygrabs-icon.png");
  assert.equal(hosted.warning, undefined);
  assert.equal(relative.warning, undefined);
});

test("product page image resolver extracts direct, og, and json-ld images", () => {
  assert.equal(isLikelyDirectProductImageUrl("https://example.com/card-product.webp?width=800"), true);
  assert.equal(isLikelyDirectProductImageUrl("https://example.com/product-page"), false);

  const ogImage = extractPublicImageUrlFromHtml(
    `<html><head><meta property="og:image" content="/images/pokemon-box.png"></head></html>`,
    "https://example.com/products/pokemon-box"
  );
  assert.equal(ogImage, "https://example.com/images/pokemon-box.png");

  const jsonLdImage = extractPublicImageUrlFromHtml(
    `<script type="application/ld+json">{"@type":"Product","image":["https://cdn.example.com/box.jpg"]}</script>`,
    "https://example.com/products/pokemon-box"
  );
  assert.equal(jsonLdImage, "https://cdn.example.com/box.jpg");
});

test("inventory create strips raw base64 image data and still validates", () => {
  const rawImage = `data:image/png;base64,${"A".repeat(260000)}`;
  const { payload, warnings } = sanitizeInventoryImagePayload({
    ...baseInventoryPayload,
    imageUrl: rawImage,
    receiptImageUrl: rawImage
  });

  const parsed = inventoryCreateSchema.parse(payload);
  assert.equal(parsed.imageUrl, undefined);
  assert.equal(parsed.receiptImageUrl, undefined);
  assert.equal(parsed.itemName, baseInventoryPayload.itemName);
  assert.deepEqual(warnings.map((warning) => warning.field).sort(), ["imageUrl", "receiptImageUrl"]);
  assert.match(inventoryImageSanitizationMessage(warnings) ?? "", /saved without that image/i);
});

test("oversized non-data image URLs are stripped instead of blocking save", () => {
  const tooLongUrl = `https://example.com/${"a".repeat(5000)}.png`;
  const { payload, warnings } = sanitizeInventoryImagePayload({
    ...baseInventoryPayload,
    imageUrl: tooLongUrl
  });

  const parsed = inventoryCreateSchema.parse(payload);
  assert.equal(parsed.imageUrl, undefined);
  assert.equal(warnings[0]?.reason, "too_long");
});

test("storefront public images strip raw data but keep valid image URLs", () => {
  const { payload, warnings } = sanitizeInventoryImagePayload({
    publishToStore: true,
    publicTitle: "Pokemon Test Booster Bundle",
    publicPrice: 25,
    publicImages: ["data:image/png;base64,AAA", "https://example.com/public-product.png"],
    availableForSale: 1,
    storeStatus: "active"
  });

  const parsed = inventoryStoreListingSchema.parse(payload);
  assert.deepEqual(parsed.publicImages, ["https://example.com/public-product.png"]);
  assert.equal(warnings[0]?.field, "publicImages");
});

test("receipt image upload data does not block stock lot edits", () => {
  const { payload, warnings } = sanitizeInventoryImagePayload({
    quantity: 3,
    costPerUnit: 6.99,
    totalCost: 20.97,
    source: "Target",
    purchasedAt: "2026-06-12",
    adjustmentReason: "physical_count_correction",
    receiptImageUrl: "data:image/jpeg;base64,AAA"
  });

  const parsed = inventoryStockLotUpdateSchema.parse(payload);
  assert.equal(parsed.receiptImageUrl, undefined);
  assert.equal(parsed.quantity, 3);
  assert.equal(warnings[0]?.field, "receiptImageUrl");
});

test("shared image input does not write selected files as base64 data URLs", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  assert.doesNotMatch(appSource, /readAsDataURL/);
  assert.doesNotMatch(appSource, /new FileReader\(\)/);
});

test("product image gallery schema validates source, primary, and storefront visibility", () => {
  const parsed = inventoryProductImageCreateSchema.parse({
    url: "https://example.com/gallery-image.webp",
    altText: "Front of booster bundle",
    sortOrder: "2",
    isPrimary: "true",
    showInStore: "false",
    source: "uploaded"
  });

  assert.equal(parsed.url, "https://example.com/gallery-image.webp");
  assert.equal(parsed.sortOrder, 2);
  assert.equal(parsed.isPrimary, true);
  assert.equal(parsed.showInStore, false);
  assert.equal(parsed.source, "uploaded");

  const updated = inventoryProductImageUpdateSchema.parse({
    altText: "Back of box",
    sortOrder: "1",
    isPrimary: "true",
    showInStore: "true"
  });
  assert.equal(updated.sortOrder, 1);
  assert.equal(updated.isPrimary, true);
});

test("product image gallery model and API routes are wired", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const service = readFileSync("src/lib/radar-service.ts", "utf8");
  const storefront = readFileSync("src/lib/storefront.ts", "utf8");
  const uploadRoute = readFileSync("src/app/api/radar/inventory/images/upload/route.ts", "utf8");
  const resolveRoute = readFileSync("src/app/api/radar/inventory/images/resolve-url/route.ts", "utf8");
  const attachRoute = readFileSync("src/app/api/radar/inventory/[itemId]/images/route.ts", "utf8");
  const imageRoute = readFileSync("src/app/api/radar/inventory/[itemId]/images/[imageId]/route.ts", "utf8");

  assert.match(schema, /model InventoryProductImage/);
  assert.match(schema, /@@unique\(\[inventoryItemId, url\]\)/);
  assert.match(uploadRoute, /BLOB_READ_WRITE_TOKEN/);
  assert.match(uploadRoute, /@vercel\/blob/);
  assert.match(uploadRoute, /image\/jpeg/);
  assert.doesNotMatch(uploadRoute, /image\/gif/);
  assert.match(resolveRoute, /extractPublicImageUrlFromHtml/);
  assert.match(attachRoute, /attachInventoryProductImage/);
  assert.match(imageRoute, /updateInventoryProductImage/);
  assert.match(imageRoute, /deleteInventoryProductImage/);
  assert.match(service, /backfillInventoryProductImages/);
  assert.match(service, /sanitizePublicImageUrl/);
  assert.doesNotMatch(service, /imageUrl: null, publicImages: null/);
  assert.match(service, /source: "existing_image_url"/);
  assert.match(service, /syncInventoryImageFields/);
  assert.match(storefront, /productImages/);
  assert.match(storefront, /getSavedProductImageUrls/);
  assert.match(appSource, /ProductImageGalleryManager/);
  assert.match(appSource, /Upload Images/);
  assert.match(appSource, /Set primary/);
  assert.match(appSource, /images\/resolve-url/);
  assert.match(appSource, /Product Image Uploads/);
});

test("listing image manager keeps public image controls readable", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const managerSource = appSource.slice(appSource.indexOf("function ProductImageGalleryManager"), appSource.indexOf("function StoreStack"));
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");

  assert.match(managerSource, /Product images/);
  assert.match(managerSource, /Add clean product images for the public storefront\. Costs, receipts, and notes are never exposed\./);
  assert.match(managerSource, /No product images yet/);
  assert.match(managerSource, /Upload an image or paste a direct image URL\./);
  assert.match(managerSource, /product-image-add-fields/);
  assert.match(managerSource, /product-image-add-actions/);
  assert.match(managerSource, /product-image-upload-note/);
  assert.ok(
    managerSource.indexOf("product-image-empty") < managerSource.indexOf("product-image-add-row"),
    "gallery or empty state should render before URL/upload controls"
  );
  assert.match(css, /body \.product-image-manager \{[\s\S]*border: 1px solid #e5e7eb/);
  assert.match(css, /body \.product-image-manager-head \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /body \.product-image-add-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /body \.product-image-add-fields \{[\s\S]*grid-template-columns: minmax\(260px, 1\.45fr\) minmax\(220px, 1fr\)/);
  assert.match(css, /body \.product-image-add-actions \{[\s\S]*min-width: max-content/);
  assert.match(css, /body \.product-image-add-actions \.mini-action,[\s\S]*white-space: nowrap/);
  assert.match(css, /body \.product-image-manager > \.product-image-empty,[\s\S]*grid-area: auto/);
  assert.match(css, /body \.product-image-manager > \.product-image-empty \{[\s\S]*text-align: left/);
  assert.match(css, /body \.product-image-empty-state span \{[\s\S]*display: block[\s\S]*width: auto[\s\S]*height: auto[\s\S]*background: transparent/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*body \.product-image-add-row,[\s\S]*body \.product-image-add-fields,[\s\S]*grid-template-columns: 1fr/);
  assert.ok(
    listingModal.indexOf("<ProductImageGalleryManager item={item} runAction={runAction} context=\"storefront\" />") < listingModal.indexOf("shipping-profile-card"),
    "image manager should stay before the shipping profile card"
  );
});

test("admin listing editor renders a clean shipping profile card", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");

  assert.match(listingModal, /className="shipping-profile-card"/);
  assert.match(listingModal, /<strong>Shipping package details<\/strong>/);
  assert.match(listingModal, /Used to calculate USPS shipping\. Leave blank to use safe fallback\./);
  assert.match(listingModal, /Weigh the product as it will be shipped, measure the box or mailer, and enter ounces and inches\./);
  assert.match(listingModal, /Leave unknown values blank so checkout can use profile defaults or safe fallback\./);
  assert.match(listingModal, /shipping-profile-issue-list/);
  assert.match(listingModal, /inventoryShippingProfileBadges\(draftShippingItem, shippingProfiles\)\.map/);
  assert.match(listingModal, /Using profile defaults\./);
  assert.match(listingModal, /Selected profile is missing package defaults\./);
  assert.match(listingModal, /Selected shipping profile is unavailable\./);
  assert.match(listingModal, /Needs shipping profile/);
  assert.match(listingModal, /Shipping profile set/);
  assert.match(listingModal, /Complete before relying on storefront estimates/);
  assert.match(listingModal, /Measure the packed shipment, choose the closest package profile, and confirm whether local pickup should be offered/);
  assert.match(appSource, /Using fallback shipping profile/);
  assert.match(appSource, /Measured shipping data/);
  assert.match(appSource, /Estimated shipping data/);
  assert.match(appSource, /Missing weight/);
  assert.match(appSource, /Missing dimensions/);
  assert.match(appSource, /Local pickup only/);
  assert.match(appSource, /Shipping disabled/);

  for (const field of [
    "shippingProfile",
    "shippingMetadataSource",
    "packageWeightOz",
    "packageLengthIn",
    "packageWidthIn",
    "packageHeightIn",
    "freeShippingEligible",
    "localPickupAvailable",
    "requiresBox",
    "insuranceRecommended"
  ]) {
    assert.match(listingModal, new RegExp(`name="${field}"`), `missing shipping field ${field}`);
  }

  assert.match(listingModal, /options=\{shippingProfileSelectOptions\(shippingProfiles, item\.shippingProfile\)\}/);
  assert.match(appSource, /function shippingProfileSelectOptions/);
  assert.match(appSource, /const shippingMetadataSourceOptions/);
  assert.match(appSource, /Metadata source/);
  assert.match(appSource, /inactive - existing products only/);
  assert.match(appSource, /Inactive profile in use/);
  assert.match(appSource, /Selected profile is unavailable/);

  for (const label of [
    "Weight in ounces",
    "Length in inches",
    "Width in inches",
    "Height in inches",
    "Metadata source",
    "Free shipping eligible",
    "Local pickup eligible",
    "Requires box",
    "Insurance recommended"
  ]) {
    assert.match(listingModal, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing shipping label ${label}`);
  }

  assert.match(css, /body \.shipping-profile-card \{[\s\S]*display: grid[\s\S]*border: 1px solid #e5e7eb/);
  assert.match(css, /body \.shipping-profile-card-head \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /body \.shipping-profile-issue-list \{[\s\S]*align-items: center/);
  assert.match(css, /body \.shipping-profile-guidance \{[\s\S]*display: grid[\s\S]*background: #fffbeb/);
  assert.match(css, /body \.shipping-profile-chip \{[\s\S]*white-space: nowrap/);
  assert.match(css, /body \.shipping-package-grid,[\s\S]*body \.shipping-option-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /body \.shipping-toggle-card \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*body \.shipping-profile-card-head,[\s\S]*body \.shipping-package-grid,[\s\S]*body \.shipping-option-grid \{[\s\S]*grid-template-columns: 1fr/);
});

test("admin listing editor offers existing storefront categories with custom entry", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");

  assert.match(appSource, /import \{ STOREFRONT_CATEGORY_OPTIONS \} from "@\/lib\/storefront-categories"/);
  assert.match(appSource, /const CUSTOM_STOREFRONT_CATEGORY_VALUE = "__custom_storefront_category__"/);
  assert.match(appSource, /function storefrontCategorySelectValue/);
  assert.match(listingModal, /className="storefront-category-field"/);
  assert.match(listingModal, /<input type="hidden" name="storefrontCategory" value=\{selectedStorefrontCategory\} \/>/);
  assert.match(listingModal, /STOREFRONT_CATEGORY_OPTIONS\.map\(\(category\) =>/);
  assert.match(listingModal, /<option value=\{CUSTOM_STOREFRONT_CATEGORY_VALUE\}>Add new category\.\.\.<\/option>/);
  assert.match(listingModal, /aria-label="Custom store category"/);
  assert.match(listingModal, /Choose an existing storefront category, or scroll to add a new one\./);
  assert.doesNotMatch(listingModal, /TextInput name="storefrontCategory"/);
  assert.match(css, /body \.storefront-category-field \{/);
  assert.match(css, /body \.storefront-category-field small \{/);
});

test("admin shipping profile selection is guarded against missing profile data", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const helperSource = sourceSlice(appSource, "function safeShippingProfileKey", "const completedShippingProfileValues");
  const productShippingModal = sourceSlice(appSource, "function ProductShippingEditorModal", "function ShippingProfileEditorModal");
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");

  assert.match(helperSource, /function safeShippingProfileKey\(value: unknown\)/);
  assert.match(helperSource, /typeof value === "string" \? value\.trim\(\)\.toLowerCase\(\) : ""/);
  assert.match(helperSource, /function safeShippingProfiles\(shippingProfiles: ShippingProfileDTO\[\] \| null \| undefined\)/);
  assert.match(helperSource, /Array\.isArray\(shippingProfiles\)/);
  assert.match(appSource, /function shippingProfileRecordMap\(shippingProfiles: ShippingProfileDTO\[\] \| null \| undefined = \[\]\)/);
  assert.match(appSource, /safeShippingProfiles\(shippingProfiles\)\.map/);
  assert.match(appSource, /function shippingMetadataDraftText\(value: unknown\)/);
  assert.match(appSource, /function shippingMetadataDraftWithNumberField\(draft: ShippingMetadataDraft, field: ShippingMetadataNumberField, value: unknown\): ShippingMetadataDraft/);
  assert.match(appSource, /draftShippingNumber\(value: unknown\)/);
  assert.match(appSource, /shippingMetadataDraftText\(value\)\.trim\(\)/);
  assert.doesNotMatch(appSource, /profile\.key\.trim\(\)/);
  assert.match(appSource, /selectedProfileUnavailable: Boolean\(selectedProfileKey && selectedProfileKey !== "standard" && !profile\)/);
  assert.match(appSource, /Selected shipping profile is unavailable\./);
  assert.match(appSource, /shippingProfile: inventoryShippingProfileValue\(item\) \|\| "standard"/);
  assert.match(appSource, /shippingProfile: safeShippingProfileKey\(draft\.shippingProfile\) \|\| "standard"/);
  assert.match(productShippingModal, /const nextShippingProfile = safeShippingProfileKey\(event\.currentTarget\.value\) \|\| "standard"/);
  assert.match(productShippingModal, /const nextMetadataSource = safeShippingMetadataSource\(event\.currentTarget\.value\)/);
  assert.match(productShippingModal, /const nextValue = event\.currentTarget\.value/);
  assert.match(productShippingModal, /setShippingDraft\(\(draft\) => \(\{ \.\.\.draft, shippingProfile: nextShippingProfile \}\)\)/);
  assert.match(productShippingModal, /shippingMetadataDraftWithNumberField\(draft, "packageWeightOz", nextValue\)/);
  assert.match(productShippingModal, /shippingMetadataDraftWithNumberField\(draft, "packageLengthIn", nextValue\)/);
  assert.match(productShippingModal, /shippingMetadataDraftWithNumberField\(draft, "packageWidthIn", nextValue\)/);
  assert.match(productShippingModal, /shippingMetadataDraftWithNumberField\(draft, "packageHeightIn", nextValue\)/);
  assert.doesNotMatch(productShippingModal, /setShippingDraft\(\(draft\) =>[^\n]+event\.currentTarget\.value/);
  assert.doesNotMatch(productShippingModal, /setShippingDraft\(\(draft\) => \(\{ \.\.\.draft, shippingProfile: safeShippingProfileKey\(event\.currentTarget\.value\)/);
  assert.match(listingModal, /const nextShippingProfile = safeShippingProfileKey\(event\.currentTarget\.value\) \|\| "standard"/);
  assert.match(listingModal, /const nextMetadataSource = safeShippingMetadataSource\(event\.currentTarget\.value\)/);
  assert.match(listingModal, /const nextValue = event\.currentTarget\.value/);
  assert.match(listingModal, /setShippingDraft\(\(draft\) => \(\{ \.\.\.draft, shippingProfile: nextShippingProfile \}\)\)/);
  assert.match(listingModal, /shippingMetadataDraftWithNumberField\(draft, "packageWeightOz", nextValue\)/);
  assert.match(listingModal, /shippingMetadataDraftWithNumberField\(draft, "packageLengthIn", nextValue\)/);
  assert.match(listingModal, /shippingMetadataDraftWithNumberField\(draft, "packageWidthIn", nextValue\)/);
  assert.match(listingModal, /shippingMetadataDraftWithNumberField\(draft, "packageHeightIn", nextValue\)/);
  assert.doesNotMatch(listingModal, /setShippingDraft\(\(draft\) =>[^\n]+event\.currentTarget\.value/);
  assert.doesNotMatch(listingModal, /setShippingDraft\(\(draft\) => \(\{ \.\.\.draft, shippingProfile: safeShippingProfileKey\(event\.currentTarget\.value\)/);
});

test("admin inventory can find products that need shipping profiles", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const filterState = sourceSlice(appSource, "type InventoryFiltersState", "type InventoryMutationReason");
  const filterLogic = sourceSlice(appSource, "function inventoryItemMatchesFilters", "function sortInventoryItemsForFilters");
  const filtersComponent = sourceSlice(appSource, "function InventoryFilters", "function InventoryList");
  const listComponent = sourceSlice(appSource, "function InventoryList", "function InventoryDetailsModal");

  assert.match(appSource, /function inventoryShippingProfileComplete\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryUsesFallbackShipping\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryEffectiveShippingData\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryMissingShippingWeight\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryMissingShippingDimensions\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryShippingProfileBadges\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryStoreReadinessRowBadge\(item: InventoryItemDTO\)/);
  assert.match(appSource, /function inventoryShippingProfileRowBadges\(item: InventoryItemDTO, shippingProfiles: ShippingProfileDTO\[\] = \[\]\)/);
  assert.match(appSource, /function inventoryHasAuthoritativeProductPackageData/);
  assert.match(appSource, /completedShippingProfileValues/);
  assert.match(appSource, /inventoryShippingProfileRecord\(item, shippingProfiles\)/);
  assert.match(appSource, /effectiveWeightOz = productWeight \?\? profileWeight/);
  assert.match(appSource, /effectiveLengthIn = productLength \?\? profileLength/);
  assert.match(appSource, /usesProfileDefaultWeight/);
  assert.match(appSource, /usesProfileDefaultDimensions/);
  assert.match(filterState, /shippingProfileStatus: string/);
  assert.match(appSource, /shippingProfileStatus: "ALL"/);
  assert.match(filterLogic, /filters\.shippingProfileStatus === "NEEDS_SHIPPING_PROFILE" && inventoryShippingProfileComplete\(item, shippingProfiles\)/);
  assert.match(filterLogic, /filters\.shippingProfileStatus === "PROFILE_READY" && !inventoryShippingProfileComplete\(item, shippingProfiles\)/);
  assert.match(filtersComponent, /name="shippingProfileStatus"/);
  assert.match(filtersComponent, /All Shipping Profiles/);
  assert.match(filtersComponent, /Needs shipping profile/);
  assert.match(filtersComponent, /Profile ready/);
  assert.match(listComponent, /inventoryStoreReadinessRowBadge\(item\)/);
  assert.match(listComponent, /inventoryShippingProfileRowBadges\(item, shippingProfiles\)/);
  assert.match(listComponent, /aria-label="Inventory readiness status"/);
  assert.match(listComponent, /createPortal\(/);
  assert.match(listComponent, /catalog-action-menu catalog-action-menu-floating/);
  assert.match(listComponent, /actionMenuPositionFor\(trigger, item\)/);
  assert.match(listComponent, /window\.addEventListener\("scroll", closeOnViewportChange, true\)/);
  assert.match(listComponent, /aria-haspopup="menu"/);
  assert.match(appSource, /Store Ready/);
  assert.match(appSource, /Shipping Ready/);
  assert.match(appSource, /Defaults/);
  assert.match(appSource, /Needs Shipping/);
  assert.match(appSource, /Needs shipping profile/);
  assert.match(appSource, /Using fallback shipping profile/);
  assert.match(appSource, /Measured shipping data/);
  assert.match(appSource, /Estimated shipping data/);
  assert.match(appSource, /Missing weight/);
  assert.match(appSource, /Missing dimensions/);
  assert.match(appSource, /Using profile default weight/);
  assert.match(appSource, /Using profile default dimensions/);
  assert.doesNotMatch(listComponent, /Using profile default weight/);
  assert.doesNotMatch(listComponent, /Using profile default dimensions/);
  assert.doesNotMatch(listComponent, /Open Edit Listing to complete packed weight, dimensions, and profile/);
  assert.doesNotMatch(listComponent, /inventoryShippingProfileBadges\(item, shippingProfiles\)\.map/);
  assert.match(css, /\.inventory-row-readiness-badges \{[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.inventory-row-badge \{[\s\S]*white-space: nowrap/);
  assert.match(css, /\.inventory-row-badge\.neutral \{[\s\S]*background: #eff6ff/);
  assert.match(css, /Phase 18H inventory width and viewport-safe action menus/);
  assert.match(css, /body \.app-main-inventory \.catalog-table,[\s\S]*body \.catalog-table \{[\s\S]*overflow: visible !important/);
  assert.match(css, /body \.catalog-action-menu-floating \{[\s\S]*position: fixed !important/);
  assert.match(css, /body \.catalog-action-menu-floating \{[\s\S]*z-index: 1000 !important/);
  assert.match(css, /\.inventory-shipping-badges,[\s\S]*\.shipping-profile-issue-list \{[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.publish-ready-note\.shipping-needed \{[\s\S]*color: var\(--warning\)/);
  assert.doesNotMatch(filterLogic, /quantityOwned\s*[+\-]=|quantitySold\s*[+\-]=|remainingQuantity/);
});

test("store listing save path persists shipping metadata without stock quantity mutation", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const validation = readFileSync("src/lib/validation.ts", "utf8");
  const storefront = readFileSync("src/lib/storefront.ts", "utf8");
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");
  const listingSchema = sourceSlice(validation, "export const inventoryStoreListingSchema", "export const inventoryBulkStorePublishSchema");
  const updateListing = sourceSlice(storefront, "export async function updateInventoryStoreListing", "export async function bulkPublishInventoryStoreListings");

  assert.match(listingModal, /body: JSON\.stringify\(formJson\(form\)\)/);
  for (const field of ["purchaseLimitEnabled", "maxQuantityPerOrder", "packageWeightOz", "packageLengthIn", "packageWidthIn", "packageHeightIn", "shippingMetadataSource", "freeShippingEligible", "requiresBox", "insuranceRecommended"]) {
    assert.match(listingSchema, new RegExp(`${field}:`), `schema should accept ${field}`);
    if (field === "maxQuantityPerOrder") {
      assert.match(updateListing, /maxQuantityPerOrder,/);
    } else if (field === "purchaseLimitEnabled") {
      assert.match(updateListing, /purchaseLimitEnabled,/);
    } else {
      assert.match(updateListing, new RegExp(`${field}: input\\.${field}`), `save path should persist ${field}`);
    }
  }
  assert.match(listingModal, /name="purchaseLimitEnabled"/);
  assert.match(listingModal, /Enable purchase limit/);
  assert.match(listingModal, /Entering a max quantity enables the limit/);
  assert.match(updateListing, /const purchaseLimitEnabled = Boolean\(input\.purchaseLimitEnabled \|\| enteredPurchaseLimit !== null\)/);
  assert.match(updateListing, /: DEFAULT_STOREFRONT_PURCHASE_LIMIT/);

  const parsed = inventoryStoreListingSchema.parse({
    publishToStore: true,
    publicTitle: "Pokemon Test Booster Bundle",
    publicPrice: 25,
    publicImages: ["https://example.com/public-product.png"],
    availableForSale: 1,
    purchaseLimitEnabled: "true",
    maxQuantityPerOrder: 4,
    shippingProfile: "small_box",
    packageWeightOz: "12.5",
    packageLengthIn: "10",
    packageWidthIn: "7",
    packageHeightIn: "4",
    shippingMetadataSource: "measured",
    freeShippingEligible: "true",
    localPickupAvailable: "true",
    shippingAvailable: "true",
    requiresBox: "true",
    insuranceRecommended: "true",
    storeStatus: "active"
  });

  assert.equal(parsed.packageWeightOz, 12.5);
  assert.equal(parsed.packageLengthIn, 10);
  assert.equal(parsed.packageWidthIn, 7);
  assert.equal(parsed.packageHeightIn, 4);
  assert.equal(parsed.shippingMetadataSource, "measured");
  assert.equal(parsed.freeShippingEligible, true);
  assert.equal(parsed.purchaseLimitEnabled, true);
  assert.equal(parsed.localPickupAvailable, true);
  assert.equal(parsed.requiresBox, true);
  assert.equal(parsed.insuranceRecommended, true);

  const blankLimit = inventoryStoreListingSchema.parse({
    publishToStore: false,
    maxQuantityPerOrder: "",
    shippingProfile: "standard",
    storeStatus: "draft"
  });
  assert.equal(blankLimit.purchaseLimitEnabled, false);
  assert.equal(blankLimit.maxQuantityPerOrder, null);
  assert.equal(blankLimit.shippingMetadataSource, null);

  const blankPackageFields = inventoryStoreListingSchema.parse({
    publishToStore: false,
    shippingProfile: "small_box",
    packageWeightOz: "",
    packageLengthIn: "",
    packageWidthIn: "",
    packageHeightIn: "",
    shippingMetadataSource: "estimated",
    storeStatus: "draft"
  });
  assert.equal(blankPackageFields.packageWeightOz, null);
  assert.equal(blankPackageFields.packageLengthIn, null);
  assert.equal(blankPackageFields.packageWidthIn, null);
  assert.equal(blankPackageFields.packageHeightIn, null);
  assert.equal(blankPackageFields.shippingMetadataSource, null);

  const defaultSource = inventoryStoreListingSchema.parse({
    publishToStore: false,
    shippingProfile: "small_box",
    packageWeightOz: "12",
    packageLengthIn: "10",
    packageWidthIn: "7",
    packageHeightIn: "4",
    storeStatus: "draft"
  });
  assert.equal(defaultSource.shippingMetadataSource, "estimated");

  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageWeightOz: "abc",
        storeStatus: "draft"
      }),
    /Expected number|Invalid input|received nan|NaN/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageWeightOz: "Infinity",
        storeStatus: "draft"
      }),
    /Package weight must stay under 500 ounces|Expected number|Invalid input/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageWeightOz: "-1",
        storeStatus: "draft"
      }),
    /Package weight must be greater than 0 ounces/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageWeightOz: "0",
        storeStatus: "draft"
      }),
    /Package weight must be greater than 0 ounces/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageLengthIn: "0",
        storeStatus: "draft"
      }),
    /Package dimensions must be greater than 0 inches/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        packageWeightOz: "501",
        storeStatus: "draft"
      }),
    /Package weight must stay under 500 ounces/
  );
  assert.throws(
    () =>
      inventoryStoreListingSchema.parse({
        publishToStore: false,
        shippingProfile: "small_box",
        shippingMetadataSource: "raw",
        storeStatus: "draft"
      }),
    /Invalid enum value|Invalid option/
  );
  assert.doesNotMatch(updateListing, /\bquantity:\s*input\./);
  assert.doesNotMatch(updateListing, /inventoryStockLot|inventorySale|remainingQuantity|quantitySold/);
});

test("admin inventory storefront availability is capped by on-hand stock", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const storefront = readFileSync("src/lib/storefront.ts", "utf8");
  const service = readFileSync("src/lib/radar-service.ts", "utf8");
  const helperSource = sourceSlice(appSource, "function storefrontListingAvailableForSale", "function positiveInventoryNumber");
  const detailsModal = sourceSlice(appSource, "function InventoryDetailsModal", "function InventoryEditStockLotModal");
  const listingModal = sourceSlice(appSource, "function StoreListingModal", "function InventoryMarketHero");
  const updateListing = sourceSlice(storefront, "export async function updateInventoryStoreListing", "export async function bulkPublishInventoryStoreListings");

  assert.match(helperSource, /const onHand = Math\.max\(0, item\.quantityOwned\)/);
  assert.match(helperSource, /return Math\.min\(onHand, publicCap\)/);
  assert.match(helperSource, /function storefrontListingHasStockMismatch/);
  assert.match(helperSource, /Stock mismatch detected: manual listing quantity/);
  assert.match(helperSource, /On hand exists, but online availability is capped at 0\./);
  assert.match(helperSource, /Listing is active but currently sold out\./);
  assert.match(helperSource, /Sold out online/);
  assert.match(detailsModal, /DetailStat label="On hand"/);
  assert.match(detailsModal, /DetailStat label="Available online"/);
  assert.match(detailsModal, /Manual listing cap/);
  assert.match(detailsModal, /storefrontListingStockWarnings\(item\)/);
  assert.match(detailsModal, /storefrontListingPublicStatus\(item\)/);
  assert.match(listingModal, /max=\{String\(Math\.max\(0, item\.quantityOwned\)\)\}/);
  assert.match(listingModal, /Available online is capped by on-hand stock/);
  assert.match(listingModal, /manualAvailableForSale/);
  assert.match(updateListing, /const onHandQuantity = Math\.max\(0, quantityOwned\(item\)\)/);
  assert.match(updateListing, /const requestedAvailableForSale/);
  assert.match(updateListing, /const availableForSale = Math\.min\(onHandQuantity, requestedAvailableForSale\)/);
  assert.match(updateListing, /input\.publishToStore && availableForSale <= 0 \? "sold_out"/);
  assert.match(service, /async function syncInventoryStoreStatusAfterStockChange/);
  assert.match(service, /availableOnline > 0 && item\.storeStatus === "sold_out"/);
  assert.match(service, /onHand <= 0 && item\.storeStatus === "active"/);
});

test("inventory row actions and stock lot details make sold-out corrections obvious", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const listComponent = sourceSlice(appSource, "function InventoryList", "function inventoryStockStatusLabel");
  const actionMenu = sourceSlice(listComponent, "const floatingActionMenu", "return (");
  const detailsModal = sourceSlice(appSource, "function InventoryDetailsModal", "function InventoryEditStockLotModal");
  const lotsComponent = sourceSlice(appSource, "function CompactLotsList", "function CompactSalesList");

  assert.match(listComponent, /inventory-row-primary-action/);
  assert.match(listComponent, /item\.quantityOwned <= 0/);
  assert.doesNotMatch(listComponent, /<details className="catalog-action-menu-wrap">/);
  assert.doesNotMatch(listComponent, /<summary className="catalog-action-trigger">/);
  assert.match(actionMenu, /role="menu"/);
  assert.match(listComponent, /Manage/);
  assert.match(actionMenu, /catalog-action-menu-section/);
  assert.match(actionMenu, /aria-label="Inventory"/);
  assert.match(actionMenu, /aria-label="Storefront"/);
  assert.match(actionMenu, /aria-label="Product"/);
  assert.ok(actionMenu.indexOf("Inventory") < actionMenu.indexOf("Add Stock"), "Inventory group should label stock actions");
  assert.ok(actionMenu.indexOf("Add Stock") < actionMenu.indexOf("Adjust Stock"), "Add Stock should come before Adjust Stock");
  assert.ok(actionMenu.indexOf("Adjust Stock") < actionMenu.indexOf("Record Sale"), "Adjust Stock should come before Record Sale");
  assert.ok(actionMenu.indexOf("Record Sale") < actionMenu.indexOf("Storefront"), "Inventory actions should stay grouped before storefront actions");
  assert.ok(actionMenu.indexOf("Storefront") < actionMenu.indexOf("Edit Listing"), "Storefront group should label listing actions");
  assert.ok(actionMenu.indexOf("Edit Listing") < actionMenu.indexOf("View Public Page"), "Public page action should stay with storefront actions");
  assert.ok(actionMenu.indexOf("View Public Page") < actionMenu.indexOf("Product"), "Product actions should be grouped last");
  assert.ok(actionMenu.indexOf("View Details") < actionMenu.indexOf("Edit Product"), "View Details should remain before Edit Product");
  assert.match(detailsModal, /Adjust Stock/);
  assert.match(lotsComponent, /Active stock lots/);
  assert.match(lotsComponent, /Depleted stock lots/);
  assert.match(lotsComponent, /remainingQuantity > 0/);
  assert.match(lotsComponent, /remainingQuantity <= 0/);
  assert.match(lotsComponent, /Starting qty/);
  assert.match(lotsComponent, /Remaining cost/);
  assert.match(lotsComponent, /stock-lot-depleted/);
  assert.match(lotsComponent, /Edit Lot/);
  assert.match(lotsComponent, /Adjust Lot/);
  assert.match(css, /body \.inventory-row-primary-action/);
  assert.match(css, /body \.catalog-action-trigger\.is-open/);
  assert.match(css, /body \.catalog-action-menu-section/);
  assert.match(css, /body \.catalog-action-menu-label/);
  assert.match(css, /body \.catalog-actions \{[\s\S]*justify-content: flex-end !important/);
  assert.match(css, /body \.stock-lot-group\.depleted/);
  assert.match(css, /body \.compact-ledger-list article\.stock-lot-depleted/);
});

test("inventory dashboard polish keeps counts filters notice and shipping metadata concise", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const publishToolbar = sourceSlice(appSource, "function InventoryStorefrontPublishToolbar", "function PurchaseFlow");
  const filtersComponent = sourceSlice(appSource, "function InventoryFilters", "function InventoryList");
  const notice = sourceSlice(appSource, "function InventoryMutationNotice", "function AddProductChoiceModal");
  const shippingRows = sourceSlice(appSource, "function inventoryShippingMetadataRowBadge", "function InventoryRowBadgeIcon");
  const noticeCss = sourceSlice(css, "body .inventory-save-notice {", "body .inventory-save-notice.is-hidden-by-filter");

  assert.match(publishToolbar, /inventory-publish-counts/);
  assert.match(publishToolbar, /Listed/);
  assert.match(publishToolbar, /Ready/);
  assert.match(publishToolbar, /Needs Setup/);
  assert.match(publishToolbar, /publishedCount/);
  assert.match(publishToolbar, /eligibleCount/);
  assert.match(publishToolbar, /needsQualityCount/);
  assert.doesNotMatch(publishToolbar, /listed in this view \(active\/sold out\)/);

  assert.match(filtersComponent, /onClearFilters/);
  assert.match(filtersComponent, /Clear filters/);
  assert.match(appSource, /function inventoryFiltersAreDefault/);
  assert.match(appSource, /activeInventoryFilterLabels/);
  assert.match(css, /\.inventory-filter-actions/);

  assert.match(appSource, /function inventoryMutationChangeLabel/);
  assert.match(appSource, /Stock changed/);
  assert.match(appSource, /Listing changed/);
  assert.match(appSource, /Product details changed/);
  assert.match(notice, /\$\{notice\.itemName\} saved\./);
  assert.match(notice, /<strong>\{changeLabel\}\.<\/strong>/);
  assert.match(notice, /inventory-mutation-diagnostics/);
  assert.doesNotMatch(noticeCss, /position:\s*fixed/);

  assert.match(shippingRows, /Measured/);
  assert.match(shippingRows, /Estimated/);
  assert.match(shippingRows, /Defaults/);
  assert.match(shippingRows, /Measured data gives the most accurate shipping quote/);
  assert.match(shippingRows, /badges\.push\(inventoryShippingMetadataRowBadge\(item, effectiveData, complete\)\)/);
  assert.doesNotMatch(shippingRows, /Missing Weight/);
  assert.doesNotMatch(shippingRows, /Missing Dimensions/);
  assert.match(css, /\.inventory-publish-counts/);
  assert.match(css, /\.inventory-row-badge \{[\s\S]*border-radius: 8px/);
});

test("stock lot adjustment requires a reason and records the audit context", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const validation = readFileSync("src/lib/validation.ts", "utf8");
  const service = readFileSync("src/lib/radar-service.ts", "utf8");
  const route = readFileSync("src/app/api/radar/inventory/[itemId]/stock-lots/[lotId]/route.ts", "utf8");
  const modal = sourceSlice(appSource, "function InventoryEditStockLotModal", "function InventoryEditProductModal");
  const schema = sourceSlice(validation, "export const inventoryStockLotUpdateSchema", "export const upcLookupSchema");
  const updateLot = sourceSlice(service, "export async function updateInventoryStockLot", "export async function deleteInventoryStockLot");

  assert.throws(() =>
    inventoryStockLotUpdateSchema.parse({
      quantity: 3,
      costPerUnit: 6.99,
      totalCost: 20.97,
      source: "Target",
      purchasedAt: "2026-06-12"
    })
  );

  const parsed = inventoryStockLotUpdateSchema.parse({
    quantity: 3,
    costPerUnit: 6.99,
    totalCost: 20.97,
    source: "Target",
    purchasedAt: "2026-06-12",
    adjustmentReason: "damaged_item",
    adjustmentNote: "Box crushed during storage."
  });

  assert.equal(parsed.adjustmentReason, "damaged_item");
  assert.equal(parsed.adjustmentNote, "Box crushed during storage.");
  assert.match(validation, /physical_count_correction/);
  assert.match(validation, /duplicate_entry_correction/);
  assert.match(schema, /adjustmentReason: inventoryStockAdjustmentReasonSchema/);
  assert.match(modal, /<h2>Adjust Stock<\/h2>/);
  assert.match(modal, /name="adjustmentReason"/);
  assert.match(modal, /Physical count correction/);
  assert.match(modal, /Damaged item/);
  assert.match(modal, /Lost item/);
  assert.match(modal, /Returned to supplier/);
  assert.match(modal, /name="adjustmentNote"/);
  assert.match(modal, /Current on hand/);
  assert.match(modal, /Selected lot starting/);
  assert.match(modal, /Selected lot remaining/);
  assert.match(modal, /Sold \/ allocated/);
  assert.match(modal, /Projected on hand/);
  assert.match(modal, /This lot is depleted\. To add physical units, use Add Stock or create a correction lot\./);
  assert.match(modal, /No stock quantity changed\./);
  assert.match(updateLot, /Adjustment reason:/);
  assert.match(updateLot, /Lot quantity: \$\{lot\.quantity\} -> \$\{input\.quantity\}/);
  assert.match(updateLot, /Lot remaining: \$\{lot\.remainingQuantity\} -> \$\{nextRemainingBeforeRecalculation\}/);
  assert.match(updateLot, /stockQuantityChanged:/);
  assert.match(updateLot, /nextNotes/);
  assert.match(route, /inventory\.stock_lot\.updated/);
  assert.match(route, /Reason: \$\{adjustmentReasonLabel\(input\.adjustmentReason\)\}/);
  assert.match(route, /previousOnHand: adjustment\.previousOnHand/);
  assert.match(route, /newOnHand: adjustment\.nextOnHand/);
  assert.match(route, /No stock quantity changed\./);
  assert.match(route, /Stock updated\. On hand is now \$\{adjustment\.nextOnHand\}\./);
});

test("add stock reports real on-hand quantity and records stock-added audit metadata", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const route = readFileSync("src/app/api/radar/inventory/route.ts", "utf8");
  const service = readFileSync("src/lib/radar-service.ts", "utf8");
  const purchaseFlow = sourceSlice(appSource, "function PurchaseFlow", "function InventoryFilters");
  const notice = sourceSlice(appSource, "function InventoryMutationNotice", "function AddProductChoiceModal");

  assert.match(purchaseFlow, /Add Stock creates a new stock lot and increases real on-hand quantity/);
  assert.match(purchaseFlow, /On hand: \{selectedExisting\.quantityOwned\} to \{projectedOnHand\}/);
  assert.match(purchaseFlow, /success: selectedExisting \? "Stock updated" : "Purchase added"/);
  assert.match(notice, /On hand is now \{notice\.onHand\}/);
  assert.match(notice, /Available online is \{notice\.availableOnline\}/);
  assert.match(route, /stockAddedToExistingItem/);
  assert.match(route, /inventory\.stock_added/);
  assert.match(route, /quantityAdded: input\.quantity/);
  assert.match(route, /newOnHand: item\.quantityOwned/);
  assert.match(route, /On hand is now \$\{item\.quantityOwned\}\./);
  assert.match(service, /await syncInventoryStoreStatusAfterStockChange\(item\.id\);[\s\S]*return autoMatchInventoryItemMarket\(currentUser, item\.id\);/);
});

test("admin and storefront image surfaces handle broken or unsafe product images cleanly", () => {
  const appSource = readFileSync("src/components/RadarApp.tsx", "utf8");
  const clientSource = readFileSync("src/components/StorefrontClient.tsx", "utf8");
  const storefront = readFileSync("src/lib/storefront.ts", "utf8");

  assert.match(appSource, /ProductImageUnavailable/);
  assert.match(appSource, /function InventoryDetailImageGallery/);
  assert.match(appSource, /function InventoryDetailImageFigure/);
  assert.match(appSource, /productImageQaLabels/);
  assert.match(appSource, /Storefront-safe image exists/);
  assert.match(appSource, /Image unavailable\. Add a replacement URL or upload a clean product photo\./);
  assert.match(appSource, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(appSource, /source: "uploaded"/);
  assert.match(appSource, /Set primary/);
  assert.match(appSource, /showInStore: true/);

  const inventoryImageSource = appSource.slice(
    appSource.indexOf("function InventoryImage"),
    appSource.indexOf("function InventoryFallbackImage")
  );
  const saleThumbSource = appSource.slice(
    appSource.indexOf("function SaleProductThumb"),
    appSource.indexOf("function SalesSummaryCard")
  );
  assert.doesNotMatch(inventoryImageSource, /initials/);
  assert.doesNotMatch(saleThumbSource, /initials/);

  assert.match(clientSource, /isStorefrontDisplayImageUrl/);
  assert.match(clientSource, /visibleGalleryImages/);
  assert.match(clientSource, /onError=\{\(\) => setFailedImages/);
  assert.match(storefront, /\.filter\(isStorefrontDisplayImageUrl\)/);
  assert.match(storefront, /const primaryImageUrl = images\[0\] \?\? null/);
});
