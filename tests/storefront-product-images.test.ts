import assert from "node:assert/strict";
import test from "node:test";

import { isPublicStorefrontListingSellable, isPublicStorefrontListingVisible, publicProductToDTO } from "../src/lib/storefront";

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

test("storefront DTO does not invent UPC cover image fallbacks", () => {
  const dto = publicProductToDTO(storefrontItem({ upc: "196214136946" }));

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, null);
  assert.deepEqual(dto.images, []);
});

test("public storefront detail visibility keeps sold-out history pages but separates sellable products", () => {
  const active = storefrontItem();
  const soldOut = storefrontItem({ storeStatus: "sold_out", quantity: 0, availableForSale: 0 });
  const activeWithoutStock = storefrontItem({ quantity: 0, availableForSale: 0 });
  const hidden = storefrontItem({ publishToStore: false });

  assert.equal(isPublicStorefrontListingVisible(active), true);
  assert.equal(isPublicStorefrontListingSellable(active), true);
  assert.equal(publicProductToDTO(active)?.status, "active");

  assert.equal(isPublicStorefrontListingVisible(soldOut), true);
  assert.equal(isPublicStorefrontListingSellable(soldOut), false);
  assert.equal(publicProductToDTO(soldOut)?.status, "sold_out");
  assert.equal(publicProductToDTO(soldOut)?.publicMaxQuantity, 0);

  assert.equal(isPublicStorefrontListingVisible(activeWithoutStock), true);
  assert.equal(isPublicStorefrontListingSellable(activeWithoutStock), false);
  assert.equal(publicProductToDTO(activeWithoutStock)?.status, "sold_out");
  assert.equal(publicProductToDTO(activeWithoutStock)?.publicMaxQuantity, 0);

  assert.equal(isPublicStorefrontListingVisible(hidden), false);
  assert.equal(isPublicStorefrontListingSellable(hidden), false);
  assert.equal(publicProductToDTO(hidden), null);
});

test("storefront DTO does not use leading-zero EAN values to guess public images", () => {
  const dto = publicProductToDTO(storefrontItem({ upc: "0196214136946" }));

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, null);
  assert.deepEqual(dto.images, []);
});

test("storefront DTO uses saved gallery images as the public image source of truth", () => {
  const dto = publicProductToDTO(
    storefrontItem({
      upc: "196214155787",
      imageUrl: "https://cdn.example.com/legacy-product.webp",
      productImages: [
        {
          url: "https://abc.public.blob.vercel-storage.com/clean-uploaded-product.webp",
          isPrimary: true,
          sortOrder: 0,
          showInStore: true,
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ]
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, "https://abc.public.blob.vercel-storage.com/clean-uploaded-product.webp");
  assert.deepEqual(dto.images, [
    "https://abc.public.blob.vercel-storage.com/clean-uploaded-product.webp",
    "https://cdn.example.com/legacy-product.webp"
  ]);
});

test("storefront DTO uses clean image candidates instead of low-resolution or promo-marked images", () => {
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: "https://example.com/products/pokemon-world-championship-deck/240.jpg",
      publicImages: JSON.stringify([
        "https://cdn.example.com/pokemon-world-championship-deck-preorder-badge.png",
        "https://cdn.example.com/pokemon-world-championship-deck-1280.webp"
      ])
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, "https://cdn.example.com/pokemon-world-championship-deck-1280.webp");
  assert.deepEqual(dto.images, ["https://cdn.example.com/pokemon-world-championship-deck-1280.webp"]);
});

test("storefront DTO falls back to app placeholder when every image candidate needs QA", () => {
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: "https://example.com/products/pokemon-world-championship-deck/240.jpg",
      publicImages: JSON.stringify(["https://cdn.example.com/pokemon-world-championship-deck-preorder-badge.png"])
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, null);
  assert.deepEqual(dto.images, []);
});
