import assert from "node:assert/strict";
import test from "node:test";

import { getPrimaryProductImage, getProductImageUrls, getSavedProductImageUrls } from "../src/lib/product-images";
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

test("blob gallery primary wins over legacy imageUrl fallback", () => {
  const product = {
    imageUrl: "https://example.com/legacy.png",
    productImages: [
      { url: "https://abc.public.blob.vercel-storage.com/uploaded.png", isPrimary: true, sortOrder: 0, showInStore: true }
    ]
  };

  assert.equal(getPrimaryProductImage(product, { publicOnly: true }), "https://abc.public.blob.vercel-storage.com/uploaded.png");
});

test("product image quality warnings identify URLs that need manual image QA", () => {
  assert.deepEqual(productImageQualityWarnings("https://target.com/p/pokemon-box/A-123456"), ["product_page_url"]);
  assert.deepEqual(productImageQualityWarnings("https://cdn.example.com/pokemon-pre-order-badge.png"), [
    "preorder_or_promo_marker",
    "watermark_or_badge_marker"
  ]);
  assert.deepEqual(productImageQualityWarnings("https://example.com/products/pokemon-box/240.jpg"), ["low_resolution_marker"]);
  assert.equal(isProductImageUrlRenderable("https://target.com/p/pokemon-box/A-123456"), false);
});

test("storefront display image filter allows clean images and rejects unsafe fallbacks", () => {
  assert.equal(isStorefrontDisplayImageUrl("https://cdn.example.com/products/pokemon-box-1280.webp"), true);
  assert.equal(isStorefrontDisplayImageUrl("https://example.com/products/pokemon-box/240.jpg"), false);
  assert.equal(isStorefrontDisplayImageUrl("https://cdn.example.com/pokemon-preorder-overlay.png"), false);
  assert.equal(isStorefrontDisplayImageUrl("data:image/png;base64,AAA"), false);
});
