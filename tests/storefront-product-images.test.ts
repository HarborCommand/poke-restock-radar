import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { syncedProductImageFields } from "../src/lib/product-images";
import {
  isPreviewQaStorefrontListing,
  isPublicStorefrontListingSellable,
  isPublicStorefrontListingVisible,
  publicProductToDTO,
  shouldHidePreviewListingFromPublicProduction
} from "../src/lib/storefront";
import { storefrontProductFeedXml } from "../src/lib/storefront-product-feed";

const storefrontClient = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");

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

test("storefront product images have meaningful alt text and accessible missing-image fallbacks", () => {
  assert.match(storefrontClient, /alt=\{product\.title\}/);
  assert.match(storefrontClient, /alt=\{productTitle\}/);
  assert.match(storefrontClient, /alt=""/);
  assert.match(storefrontClient, /role="img" aria-label=\{`\$\{cleanStorefrontTitle\(product\.title\)\} image unavailable`\}/);
  assert.match(storefrontClient, /role="img" aria-label=\{`\$\{productTitle\} image unavailable`\}/);
  assert.match(storefrontClient, /Package size=\{size === "thumb" \? 18 : 30\} aria-hidden="true"/);
  assert.match(storefrontClient, /Package size=\{42\} aria-hidden="true"/);
  assert.match(storefrontClient, /Link href=\{`\/product\/\$\{product\.slug\}`\} aria-label=\{productTitle\}/);
  assert.doesNotMatch(storefrontClient, /alt="(?:image|picture|product image)"/i);
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
    "https://abc.public.blob.vercel-storage.com/clean-uploaded-product.webp"
  ]);
});

test("storefront DTO falls back to legacy imageUrl when gallery rows have no public image", () => {
  const legacyUrl = "https://cdn.example.com/legacy-restored-product.webp";
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: legacyUrl,
      publicImages: null,
      productImages: [
        {
          url: "https://cdn.example.com/internal-hidden-gallery.webp",
          isPrimary: true,
          sortOrder: 0,
          showInStore: false,
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ]
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, legacyUrl);
  assert.deepEqual(dto.images, [legacyUrl]);
});

test("storefront DTO keeps hidden gallery URLs from reappearing through legacy imageUrl", () => {
  const hiddenUrl = "https://cdn.example.com/hidden-deleted-gallery.webp";
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: hiddenUrl,
      publicImages: JSON.stringify([hiddenUrl]),
      productImages: [
        {
          url: hiddenUrl,
          isPrimary: true,
          sortOrder: 0,
          showInStore: false,
          createdAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ]
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, null);
  assert.deepEqual(dto.images, []);
});

test("preview QA storefront listings are blocked from public production output", () => {
  const previewItem = storefrontItem({
    itemName: "Preview Stripe Webhook Test Booster Box",
    publicTitle: "Preview Stripe Webhook Test Booster Box",
    setName: "Preview QA Set",
    brand: "GameDayGrabs Preview",
    manufacturer: "Preview QA",
    sku: "PREVIEW-WEBHOOK-TEST-001",
    upc: "000000000001",
    storefrontTags: JSON.stringify(["preview", "qa", "stripe-test"])
  });

  assert.equal(isPreviewQaStorefrontListing(previewItem), true);
  assert.equal(shouldHidePreviewListingFromPublicProduction(previewItem, { VERCEL_ENV: "production" }), true);
  assert.equal(shouldHidePreviewListingFromPublicProduction(previewItem, { VERCEL_ENV: "preview" }), false);
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

test("deleted product image is absent from storefront DTO and product feed after image sync", () => {
  const deletedUrl = "https://cdn.example.com/deleted-wrong-image.webp";
  const replacementUrl = "https://cdn.example.com/replacement-image.webp";
  const synced = syncedProductImageFields(
    {
      imageUrl: deletedUrl,
      publicImages: JSON.stringify([deletedUrl, replacementUrl]),
      productImages: [{ url: replacementUrl, isPrimary: true, sortOrder: 0, showInStore: true }]
    },
    { removedUrls: [deletedUrl] }
  );
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: synced.imageUrl,
      publicImages: JSON.stringify(synced.publicImages),
      productImages: [{ url: replacementUrl, isPrimary: true, sortOrder: 0, showInStore: true }],
      upc: "196214155787"
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, replacementUrl);
  assert.deepEqual(dto.images, [replacementUrl]);
  assert.doesNotMatch(JSON.stringify(dto), /deleted-wrong-image/);

  const feed = storefrontProductFeedXml([dto]);
  assert.match(feed, /replacement-image\.webp/);
  assert.doesNotMatch(feed, /deleted-wrong-image/);
});

test("stale legacy product images do not reappear when gallery rows already exist", () => {
  const deletedUrl = "https://cdn.example.com/already-deleted-legacy-image.webp";
  const replacementUrl = "https://cdn.example.com/current-gallery-image.webp";
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: deletedUrl,
      publicImages: JSON.stringify([deletedUrl, replacementUrl]),
      productImages: [{ url: replacementUrl, isPrimary: true, sortOrder: 0, showInStore: true }],
      upc: "196214155787"
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, replacementUrl);
  assert.deepEqual(dto.images, [replacementUrl]);
  assert.doesNotMatch(JSON.stringify(dto), /already-deleted-legacy-image/);

  const feed = storefrontProductFeedXml([dto]);
  assert.match(feed, /current-gallery-image\.webp/);
  assert.doesNotMatch(feed, /already-deleted-legacy-image/);
});

test("storefront detail images stay consistent with feed primary when legacy images are stale", () => {
  const staleUrl = "https://cdn.example.com/stale-related-product-image.webp";
  const primaryUrl = "https://cdn.example.com/valid-gallery-primary.webp";
  const secondaryUrl = "https://cdn.example.com/valid-gallery-secondary.webp";
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: staleUrl,
      publicImages: JSON.stringify([staleUrl, primaryUrl, secondaryUrl]),
      productImages: [
        { url: primaryUrl, isPrimary: true, sortOrder: 0, showInStore: true },
        { url: secondaryUrl, isPrimary: false, sortOrder: 1, showInStore: true }
      ],
      upc: "196214155787"
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, primaryUrl);
  assert.deepEqual(dto.images, [primaryUrl, secondaryUrl]);
  assert.doesNotMatch(JSON.stringify(dto), /stale-related-product-image/);

  const feed = storefrontProductFeedXml([dto]);
  assert.match(feed, /valid-gallery-primary\.webp/);
  assert.doesNotMatch(feed, /stale-related-product-image/);
});

test("storefront DTO shows no image when the only product image was deleted", () => {
  const deletedUrl = "https://cdn.example.com/only-deleted-image.webp";
  const synced = syncedProductImageFields(
    {
      imageUrl: deletedUrl,
      publicImages: JSON.stringify([deletedUrl]),
      productImages: []
    },
    { removedUrls: [deletedUrl] }
  );
  const dto = publicProductToDTO(
    storefrontItem({
      imageUrl: synced.imageUrl,
      publicImages: JSON.stringify(synced.publicImages),
      productImages: []
    })
  );

  assert.ok(dto);
  assert.equal(dto.primaryImageUrl, null);
  assert.deepEqual(dto.images, []);
  assert.doesNotMatch(JSON.stringify(dto), /only-deleted-image/);
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
