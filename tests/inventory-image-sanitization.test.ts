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
  assert.match(service, /imageUrl: null, publicImages: null/);
  assert.match(service, /syncInventoryImageFields/);
  assert.match(storefront, /productImages/);
  assert.match(storefront, /filter\(\(image\) => image\.showInStore\)/);
  assert.match(appSource, /ProductImageGalleryManager/);
  assert.match(appSource, /Upload Images/);
  assert.match(appSource, /Set primary/);
  assert.match(appSource, /images\/resolve-url/);
  assert.match(appSource, /Product Image Uploads/);
});
