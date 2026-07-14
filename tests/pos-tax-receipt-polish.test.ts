import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { posTaxQuoteSchema } from "../src/lib/validation";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

function sourceSlice(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("POS tax quote input is strict and exemption evidence is explicit", () => {
  assert.doesNotThrow(() =>
    posTaxQuoteSchema.parse({
      items: [{ inventoryItemId: "item-1", quantity: 2, adjustedUnitPrice: 9.5, discountReason: "owner_override" }],
      taxExempt: false
    })
  );
  assert.throws(
    () => posTaxQuoteSchema.parse({ items: [{ inventoryItemId: "item-1", quantity: 1 }], clientTax: 99 }),
    /Unrecognized key/
  );
  assert.throws(
    () => posTaxQuoteSchema.parse({ items: [{ inventoryItemId: "item-1", quantity: 1 }], taxExempt: true }),
    /reason|reference/i
  );
});

test("POS tax quote route is authenticated, same-origin admin-only, and private", () => {
  const route = readSource("src/app/api/radar/pos/tax-quote/route.ts");
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /authorizeAdminMutation\(request, user\)/);
  assert.match(route, /posTaxQuoteSchema\.parse/);
  assert.match(route, /privateOk/);
  assert.match(route, /safeMutationError/);
});

test("server quote owns pricing, inventory scope, jurisdiction, and tax arithmetic", () => {
  const service = readSource("src/lib/radar-service.ts");
  const quote = sourceSlice(service, "export async function quotePosSaleTax", "export async function createPosSale");
  assert.match(quote, /getStorefrontSettings\(currentUser\.id\)/);
  assert.match(quote, /userId: currentUser\.id/);
  assert.match(quote, /inventoryItemToDTO/);
  assert.match(quote, /posUnitPrice/);
  assert.match(quote, /calculateConfiguredPosTax/);
  assert.match(quote, /stateTax:/);
  assert.match(quote, /countySurtax:/);
  assert.match(quote, /combinedRateBasisPoints/);
  assert.match(quote, /canComplete: !misconfigured/);
  assert.doesNotMatch(quote, /\.create\(|\.update\(|\.delete\(/);
});

test("POS client waits for the newest server quote and never submits browser tax totals", () => {
  const app = readSource("src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");
  assert.match(posPanel, /taxQuoteSequenceRef/);
  assert.match(posPanel, /new AbortController\(\)/);
  assert.match(posPanel, /controller\.abort\(\)/);
  assert.match(posPanel, /taxQuoteSequenceRef\.current !== sequence/);
  assert.match(posPanel, /\/api\/radar\/pos\/tax-quote/);
  assert.match(posPanel, /taxQuoteStatus === "loading"/);
  assert.match(posPanel, /Server tax calculation is required before confirming the sale/);
  assert.match(posPanel, /taxQuote\?\.stateTax/);
  assert.match(posPanel, /taxQuote\?\.countySurtax/);
  assert.match(posPanel, /money\(quotedTotal\)/);
  const completionBody = sourceSlice(posPanel, "async function completeSale", "const adjustmentLine");
  assert.doesNotMatch(completionBody, /cartTotals\.(tax|total)|taxQuote\.(tax|total)|clientTax/);
});

test("receipt is itemized, customer contact is masked, and tax/refund details stay separate", () => {
  const app = readSource("src/components/RadarApp.tsx");
  const summary = sourceSlice(app, "function maskPosReceiptEmail", "function PosPanel");
  const receipt = sourceSlice(app, "function PosReceipt", "function ProfitLossPanel");
  assert.match(summary, /maskPosReceiptEmail/);
  assert.match(summary, /maskPosReceiptPhone/);
  assert.match(summary, /stateTax/);
  assert.match(summary, /countySurtax/);
  assert.match(summary, /refundedTax/);
  assert.match(receipt, /gamedaygrabs-logo-horizontal\.png/);
  assert.match(receipt, /receipt\.cashierName/);
  assert.match(receipt, /receipt\.registerLabel/);
  assert.match(receipt, /receipt\.stateTax/);
  assert.match(receipt, /receipt\.countySurtax/);
  assert.match(receipt, /receipt\.refundedAmount/);
  assert.match(receipt, /receipt\.refundedTax/);
  assert.match(receipt, /Thank you for collecting with us/);
  assert.doesNotMatch(summary + receipt, /Customer account ID|internal ID/i);
});

test("receipt reconstruction exposes partial/full refund and tax reversal metadata", () => {
  const service = readSource("src/lib/radar-service.ts");
  const receipt = sourceSlice(service, "async function receiptForExistingPosSale", "function inventorySaleAvailability");
  assert.match(receipt, /refundStatus: firstSale\.refundStatus/);
  assert.match(receipt, /refundedAmount:/);
  assert.match(receipt, /refundedTax:/);
  assert.match(receipt, /refundedAt:/);
  assert.match(receipt, /cashierName:/);
  assert.match(receipt, /registerLabel:/);
  assert.match(receipt, /const subtotal = centsToMoney\(subtotalCents\)/);
});

test("receipt supports responsive screens and standard 80mm printing without actions", () => {
  const css = readSource("src/app/globals.css");
  assert.match(css, /\.pos-tax-profile-card/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /body:has\(\.pos-receipt-print\)/);
  assert.match(css, /width:\s*80mm/);
  assert.match(css, /max-width:\s*80mm/);
  assert.match(css, /\.no-print/);
  assert.match(css, /break-inside:\s*avoid/);
});
