import assert from "node:assert/strict";
import test from "node:test";

import { getPrimaryProductImage, getProductImageUrls, getSavedProductImageUrls, syncedProductImageFields } from "../src/lib/product-images";
import { isProductImageUrlRenderable, isStorefrontDisplayImageUrl, productImageQualityWarnings } from "../src/lib/product-image-quality";

test("product with gallery primary uses gallery primary", () => {
  const product = {
    imageUrl: "https://example.com/legacy.png",
    publicImages: ["https://example.com/public.png"],
    productImages: [
      { url: "https://example.com/side.png", isPrimary: false, sortOrder: 2, showInStore: true, createdAt: "2026-06-01T00:00:00.000Z" },
      { url: "https://example.com/front.png", isPrimary: true, sortOrder: 4, showInStore: true, createdAt: "2026-06-02T00:00:00.000Z" }
    ]
  };

  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://example.com/front.png");
});

test("product with gallery images but no primary uses first gallery image by sort order", () => {
  const product = {
    imageUrl: "https://example.com/legacy.png",
    productImages: [
      { url: "https://example.com/back.png", isPrimary: false, sortOrder: 3, showInStore: true },
      { url: "https://example.com/front.png", isPrimary: false, sortOrder: 1, showInStore: true }
    ]
  };

  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://example.com/front.png");
});

test("product with no gallery uses old imageUrl instead of placeholder", () => {
  const product = {
    imageUrl: "https://example.com/old-image.webp",
    publicImages: [],
    productImages: []
  };

  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://example.com/old-image.webp");
  assert.deepEqual(getProductImageUrls(product, { publicOnly: true }), ["https://example.com/old-image.webp"]);
});

test("public image field and linked product images are fallback candidates", () => {
  const product = {
    imageUrl: null,
    publicImages: JSON.stringify(["https://example.com/public-a.png"]),
    productImages: [],
    product: {
      liveImageUrl: "https://example.com/live.png",
      imageUrl: "https://example.com/product.png"
    }
  };

  assert.deepEqual(getProductImageUrls(product, { publicOnly: true }), [
    "https://example.com/public-a.png",
    "https://example.com/live.png",
    "https://example.com/product.png"
  ]);
  assert.deepEqual(getSavedProductImageUrls(product, { publicOnly: true }), ["https://example.com/public-a.png"]);
});

test("linked product fallback images do not override existing gallery rows", () => {
  const product = {
    imageUrl: "https://example.com/deleted-legacy.png",
    publicImages: JSON.stringify(["https://example.com/deleted-legacy.png"]),
    productImages: [
      { url: "https://example.com/current-gallery.webp", isPrimary: true, sortOrder: 0, showInStore: true }
    ],
    product: {
      liveImageUrl: "https://example.com/stale-linked-live.png",
      imageUrl: "https://example.com/stale-linked-product.png"
    }
  };

  assert.deepEqual(getProductImageUrls(product, { publicOnly: true }), ["https://example.com/current-gallery.webp"]);
  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://example.com/current-gallery.webp");
});

test("blob gallery primary wins over legacy imageUrl fallback", () => {
  const product = {
    imageUrl: "https://example.com/legacy.png",
    productImages: [
      { url: "https://abc.public.blob.vercel-storage.com/uploaded.png", isPrimary: true, sortOrder: 0, showInStore: true }
    ]
  };

  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://abc.public.blob.vercel-storage.com/uploaded.png");
});

test("existing gallery rows are the saved image source of truth over stale legacy fields", () => {
  const product = {
    imageUrl: "https://example.com/deleted-legacy.png",
    publicImages: JSON.stringify(["https://example.com/deleted-legacy.png"]),
    productImages: [
      { url: "https://example.com/current-gallery.webp", isPrimary: true, sortOrder: 0, showInStore: true }
    ]
  };

  assert.deepEqual(getSavedProductImageUrls(product, { publicOnly: true }), ["https://example.com/current-gallery.webp"]);
  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://example.com/current-gallery.webp");
});

test("synced product image fields remove deleted secondary images from storefront data", () => {
  const deletedUrl = "https://cdn.example.com/wrong-secondary.webp";
  const synced = syncedProductImageFields(
    {
      imageUrl: "https://cdn.example.com/front.webp",
      publicImages: JSON.stringify(["https://cdn.example.com/front.webp", deletedUrl]),
      productImages: [{ url: "https://cdn.example.com/front.webp", isPrimary: true, sortOrder: 0, showInStore: true }]
    },
    { removedUrls: [deletedUrl] }
  );

  assert.equal(synced.imageUrl, "https://cdn.example.com/front.webp");
  assert.deepEqual(synced.publicImages, ["https://cdn.example.com/front.webp"]);
});

test("synced product image fields clean stale legacy URLs when gallery rows are authoritative", () => {
  const staleUrl = "https://cdn.example.com/deleted-gallery-image.webp";
  const currentUrl = "https://cdn.example.com/current-gallery-image.webp";
  const synced = syncedProductImageFields({
    imageUrl: staleUrl,
    publicImages: JSON.stringify([staleUrl, currentUrl]),
    productImages: [{ url: currentUrl, isPrimary: true, sortOrder: 0, showInStore: true }]
  });

  assert.equal(synced.imageUrl, currentUrl);
  assert.deepEqual(synced.publicImages, [currentUrl]);
});

test("synced product image fields promote next image after primary deletion", () => {
  const deletedPrimary = "https://cdn.example.com/wrong-primary.webp";
  const replacement = "https://cdn.example.com/replacement.webp";
  const synced = syncedProductImageFields(
    {
      imageUrl: deletedPrimary,
      publicImages: JSON.stringify([deletedPrimary, replacement]),
      productImages: [{ url: replacement, isPrimary: false, sortOrder: 1, showInStore: true }]
    },
    { removedUrls: [deletedPrimary] }
  );

  assert.equal(synced.imageUrl, replacement);
  assert.deepEqual(synced.publicImages, [replacement]);
});

test("synced product image fields clear the only deleted product image", () => {
  const deletedUrl = "https://cdn.example.com/only-image.webp";
  const synced = syncedProductImageFields(
    {
      imageUrl: deletedUrl,
      publicImages: JSON.stringify([deletedUrl]),
      productImages: []
    },
    { removedUrls: [deletedUrl] }
  );

  assert.equal(synced.imageUrl, null);
  assert.deepEqual(synced.publicImages, []);
});

test("synced product image fields do not leak hidden gallery images through legacy fields", () => {
  const privateUrl = "https://cdn.example.com/private-admin-image.webp";
  const synced = syncedProductImageFields({
    imageUrl: privateUrl,
    publicImages: JSON.stringify([privateUrl]),
    productImages: [{ url: privateUrl, isPrimary: true, sortOrder: 0, showInStore: false }]
  });

  assert.equal(synced.imageUrl, null);
  assert.deepEqual(synced.publicImages, []);
});

test("product image quality warnings identify URLs that need manual image QA", () => {
  assert.deepEqual(productImageQualityWarnings("https://target.com/p/pokemon-box/A-123456"), ["product_page_url"]);
  assert.deepEqual(productImageQualityWarnings("https://cdn.example.com/pokemon-pre-order-badge.png"), [
    "preorder_or_promo_marker",
    "watermark_or_badge_marker"
  ]);
  assert.deepEqual(productImageQualityWarnings("https://example.com/products/pokemon-box/240.jpg"), ["low_resolution_marker"]);
  assert.deepEqual(productImageQualityWarnings("https://covers1.booksamillion.com/covers/gift/1/96/214/136/196214136748.jpg"), [
    "fallback_source_marker"
  ]);
  assert.equal(isProductImageUrlRenderable("https://target.com/p/pokemon-box/A-123456"), false);
});

test("storefront display image filter allows clean images and rejects unsafe fallbacks", () => {
  assert.equal(isStorefrontDisplayImageUrl("https://cdn.example.com/products/pokemon-box-1280.webp"), true);
  assert.equal(isStorefrontDisplayImageUrl("https://example.com/products/pokemon-box/240.jpg"), false);
  assert.equal(isStorefrontDisplayImageUrl("https://cdn.example.com/pokemon-preorder-overlay.png"), false);
  assert.equal(isStorefrontDisplayImageUrl("https://target.scene7.com/is/image/Target/GUEST_123456?wid=800&hei=800&qlt=80&fmt=webp"), true);
  assert.equal(isStorefrontDisplayImageUrl("https://covers1.booksamillion.com/covers/gift/1/96/214/136/196214136748.jpg"), false);
  assert.equal(isStorefrontDisplayImageUrl("data:image/png;base64,AAA"), false);
});
