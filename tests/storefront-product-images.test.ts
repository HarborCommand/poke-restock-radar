import assert from "node:assert/strict";
import test from "node:test";

import { publicProductToDTO } from "../src/lib/storefront";

function storefrontItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    itemName: "Pokemon TCG UPC Image Product",
    publicTitle: "Pokemon TCG UPC Image Product",
    publishToStore: true,
    publicSlug: "pokemon-tcg-upc-image-product",
    publicPrice: 25,
    targetSellPrice: null,
    msrp: null,
    currentMarketEstimate: null,
    compareAtPrice: null,
    storeStatus: "active",
    imageUrl: null,
    publicImages: null,
    exactProductUrl: null,
    sku: null,
    upc: null,
    dpci: null,
    category: "Tins",
    storefrontCategory: null,
    storefrontTags: null,
    setName: null,
    brand: "Pokemon",
    publicDescription: null,
    description: null,
    condition: "New",
    quantity: 1,
    availableForSale: null,
    maxQuantityPerOrder: null,
    localPickupAvailable: true,
    shippingAvailable: true,
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    stockLots: [],
    sales: [],
    stockReservations: [],
    productImages: [],
    product: null,
    ...overrides
  } as never;
}

test("storefront DTO uses UPC cover image fallback before placeholder", () => {
  const dto = publicProductToDTO(storefrontItem({ upc: "196214136946" }));

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, "https://covers1.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg");
  assert.deepEqual(dto.images.slice(0, 4), [
    "https://covers1.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg",
    "https://covers2.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg",
    "https://covers3.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg",
    "https://covers4.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg"
  ]);
});

test("storefront DTO includes UPC-A fallback for leading-zero EAN-13", () => {
  const dto = publicProductToDTO(storefrontItem({ upc: "0196214136946" }));

  assert.ok(dto);
  assert.ok(dto.images.includes("https://covers1.booksamillion.com/covers/gift/0/19/621/413/0196214136946.jpg"));
  assert.ok(dto.images.includes("https://covers1.booksamillion.com/covers/gift/1/96/214/136/196214136946.jpg"));
});

test("storefront DTO uses known public UPC image repair before generic cover guesses", () => {
  const dto = publicProductToDTO(storefrontItem({ upc: "196214155787" }));

  assert.ok(dto);
  assert.equal(
    dto.primaryImageUrl,
    "https://cdn11.bigcommerce.com/s-karer354/images/stencil/1280x1280/products/296360/1121259/lumiose-city-mini-tin-264181539__60569.1780614126.jpg?c=2"
  );
  assert.equal(dto.images[1], "https://covers1.booksamillion.com/covers/gift/1/96/214/155/196214155787.jpg");
});
