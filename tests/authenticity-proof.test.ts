import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasPartialAuthenticityProof, isAuthenticityProofReady } from "../src/lib/authenticity-proof";

function readProjectFile(path: string) {
  return readFileSync(path, "utf8");
}

function sourceSlice(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `missing end token: ${endToken}`);
  return source.slice(start, end);
}

test("authenticity proof helper defaults old products to missing", () => {
  assert.equal(isAuthenticityProofReady({}), false);
  assert.equal(hasPartialAuthenticityProof({}), false);
  assert.equal(isAuthenticityProofReady({ authenticityProofStatus: null, authenticityReceiptStatus: null, authenticityPhotoStatus: null, authenticityUpcVerified: null }), false);
});

test("authenticity proof helper requires complete source, photo, and UPC proof", () => {
  assert.equal(
    isAuthenticityProofReady({
      authenticityProofStatus: "complete",
      authenticityReceiptStatus: "invoice",
      authenticityPhotoStatus: "front_back_upc",
      authenticityUpcVerified: true
    }),
    true
  );
  assert.equal(
    isAuthenticityProofReady({
      authenticityProofStatus: "complete",
      authenticityReceiptStatus: "missing",
      authenticityPhotoStatus: "front_back_upc",
      authenticityUpcVerified: true
    }),
    false
  );
});

test("inventory authenticity proof schema migration is additive only", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260705093000_inventory_authenticity_proof_status/migration.sql");
  for (const field of ["authenticityProofStatus", "authenticityReceiptStatus", "authenticityPhotoStatus", "authenticityNotes"]) {
    assert.match(schema, new RegExp(`${field}\\s+String\\?`));
    assert.match(migration, new RegExp(`ADD COLUMN "${field}" TEXT`));
  }
  assert.match(schema, /authenticityUpcVerified\s+Boolean\?/);
  assert.match(migration, /ADD COLUMN "authenticityUpcVerified" BOOLEAN/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER COLUMN|DELETE FROM|UPDATE\s+"InventoryItem"/i);
});

test("admin inventory update can save proof status fields without price or quantity mutation", () => {
  const validation = readProjectFile("src/lib/validation.ts");
  const service = readProjectFile("src/lib/radar-service.ts");
  const updateInventoryItem = sourceSlice(service, "export async function updateInventoryItem", "async function findInventoryItemForImageEdit");

  assert.match(validation, /authenticityProofStatusSchema = z\.enum\(\["missing", "partial", "complete"\]\)/);
  assert.match(validation, /authenticityReceiptStatusSchema = z\.enum\(\["missing", "receipt", "invoice", "order_history", "other"\]\)/);
  assert.match(validation, /authenticityPhotoStatusSchema = z\.enum\(\["missing", "front_only", "front_back", "front_back_upc"\]\)/);
  assert.match(validation, /authenticityUpcVerified: checkboxBoolean\.default\(false\)/);

  for (const field of ["authenticityProofStatus", "authenticityReceiptStatus", "authenticityPhotoStatus", "authenticityUpcVerified", "authenticityNotes"]) {
    assert.match(updateInventoryItem, new RegExp(`${field}: input\\.${field}`));
  }
  const proofUpdateBlock = sourceSlice(updateInventoryItem, "authenticityProofStatus: input.authenticityProofStatus", "expectedPlan: input.expectedPlan");
  assert.doesNotMatch(proofUpdateBlock, /quantity|publicPrice|targetSellPrice|minimumAcceptablePrice/);
});

test("admin UI renders proof badge and private authenticity proof editor", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const editProduct = sourceSlice(app, "function InventoryEditProductModal", "function StoreListingModal");

  assert.match(app, /function inventoryAuthenticityProofRowBadge\(item: InventoryItemDTO\)/);
  assert.match(app, /inventoryAuthenticityProofRowBadge\(item\)/);
  assert.match(editProduct, /<h3>Authenticity proof<\/h3>/);
  assert.match(editProduct, /name="authenticityProofStatus"/);
  assert.match(editProduct, /name="authenticityReceiptStatus"/);
  assert.match(editProduct, /name="authenticityPhotoStatus"/);
  assert.match(editProduct, /name="authenticityUpcVerified" type="checkbox"/);
  assert.match(editProduct, /name="authenticityNotes"/);
  assert.match(editProduct, /Do not upload receipts or invoices publicly/);
});

test("authenticity proof fields stay out of public storefront, feed, schema, and customer surfaces", () => {
  const publicType = sourceSlice(readProjectFile("src/types/radar.ts"), "export type PublicStoreProductDTO", "export type StorefrontSettingsDTO");
  const storefront = readProjectFile("src/lib/storefront.ts");
  const feed = readProjectFile("src/lib/storefront-product-feed.ts");
  const seo = readProjectFile("src/lib/storefront-seo.ts");
  const storefrontClient = readProjectFile("src/components/StorefrontClient.tsx");
  const customerPages = readProjectFile("src/components/CustomerAccountPages.tsx");
  const privateFieldPattern = /authenticityProofStatus|authenticityReceiptStatus|authenticityPhotoStatus|authenticityUpcVerified|authenticityNotes/;

  assert.doesNotMatch(publicType, privateFieldPattern);
  assert.doesNotMatch(feed, privateFieldPattern);
  assert.doesNotMatch(seo, privateFieldPattern);
  assert.doesNotMatch(storefrontClient, privateFieldPattern);
  assert.doesNotMatch(customerPages, privateFieldPattern);
  assert.doesNotMatch(sourceSlice(storefront, "function publicProductToDTO", "export async function getStorefrontSettings"), privateFieldPattern);
});
