import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  inventoryCreateSchema,
  inventoryImageSanitizationMessage,
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
