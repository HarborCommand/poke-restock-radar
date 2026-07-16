import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPosTaxQuoteMatches,
  createPosTaxQuoteToken,
  posTaxCartFingerprint,
  verifyPosTaxQuoteToken
} from "../src/lib/pos-tax-quote";
import { calculateConfiguredPosTax } from "../src/lib/tax";
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
      idempotencyKey: "pos-quote-test-1",
      items: [{ inventoryItemId: "item-1", quantity: 2, adjustedUnitPrice: 9.5, discountReason: "owner_override" }],
      taxExempt: false
    })
  );
  assert.throws(
    () => posTaxQuoteSchema.parse({ idempotencyKey: "pos-quote-test-2", items: [{ inventoryItemId: "item-1", quantity: 1 }], clientTax: 99 }),
    /Unrecognized key/
  );
  assert.throws(
    () => posTaxQuoteSchema.parse({ idempotencyKey: "pos-quote-test-3", items: [{ inventoryItemId: "item-1", quantity: 1 }], taxExempt: true }),
    /reason|reference/i
  );
});

test("signed POS quote binds workspace, cart, profile, idempotency key, and expiration", () => {
  const fingerprintInput = {
    userId: "workspace-owner-1",
    idempotencyKey: "pos-finalize-1",
    selectedCustomerAccountId: "customer-1",
    fulfillmentMode: "in_person" as const,
    taxExempt: false,
    taxExemptReason: null,
    taxExemptionReference: null,
    items: [{
      inventoryItemId: "item-1",
      quantity: 2,
      originalUnitPriceCents: 2500,
      adjustedUnitPriceCents: 2000,
      discountReason: "owner_override",
      taxable: true,
      taxCategory: "txcd_99999999"
    }],
    profile: {
      runtimeEnabled: true,
      profileEnabled: true,
      country: "US",
      state: "FL",
      county: "Orange",
      stateRateBasisPoints: 600,
      countyRateBasisPoints: 50,
      effectiveAt: "2026-07-01T00:00:00.000Z",
      sourceNote: "Preview-only approved rate source"
    }
  };
  const now = Date.UTC(2026, 6, 14, 12);
  const fingerprint = posTaxCartFingerprint(fingerprintInput);
  const quote = createPosTaxQuoteToken(fingerprintInput.userId, fingerprint, now);
  const encodedPayload = quote.quoteId.split(".")[0] ?? "";
  const publicPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(publicPayload, "userId"), false);
  assert.equal(typeof publicPayload.userBinding, "string");
  const verified = verifyPosTaxQuoteToken(quote.quoteId, fingerprintInput.userId, now + 1);
  assert.doesNotThrow(() => assertPosTaxQuoteMatches(verified, fingerprint));
  assert.throws(() => verifyPosTaxQuoteToken(`${quote.quoteId.slice(0, -1)}x`, fingerprintInput.userId, now + 1), /invalid/i);
  assert.throws(() => verifyPosTaxQuoteToken(quote.quoteId, "other-workspace", now + 1), /invalid/i);
  assert.throws(() => verifyPosTaxQuoteToken(quote.quoteId, fingerprintInput.userId, now + (5 * 60 * 1000)), /expired/i);

  const replayFingerprint = posTaxCartFingerprint({ ...fingerprintInput, idempotencyKey: "pos-finalize-2" });
  assert.throws(() => assertPosTaxQuoteMatches(verified, replayFingerprint), /stale/i);
  const changedRateFingerprint = posTaxCartFingerprint({
    ...fingerprintInput,
    profile: { ...fingerprintInput.profile, countyRateBasisPoints: 100 }
  });
  assert.throws(() => assertPosTaxQuoteMatches(verified, changedRateFingerprint), /stale/i);
});

test("Florida configured POS tax uses integer cents and reconciles rounding boundaries", () => {
  const profile = {
    country: "US",
    state: "FL",
    county: "Orange",
    stateRateBasisPoints: 600,
    countyRateBasisPoints: 100,
    effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
    sourceNote: "Preview-only approved rate source",
    enabled: true
  };
  const calculate = (subtotalCents: number, discountCents = 0, taxableSubtotalCents?: number) =>
    calculateConfiguredPosTax({ subtotalCents, discountCents, taxableSubtotalCents, profile });

  for (const [subtotalCents, expectedTaxCents] of [[0, 0], [1, 0], [99, 7], [100, 7], [2500, 175]] as const) {
    const result = calculate(subtotalCents);
    assert.equal(result.taxCents, expectedTaxCents);
    assert.equal(result.stateTaxCents + result.countySurtaxCents, result.taxCents);
    assert.equal(result.totalCents, subtotalCents + expectedTaxCents);
  }
  assert.deepEqual(calculate(1000, 1000), { subtotalCents: 1000, discountCents: 1000, taxableSubtotalCents: 0, stateTaxCents: 0, countySurtaxCents: 0, taxCents: 0, totalCents: 0, combinedRateBasisPoints: 700 });
  assert.equal(calculate(1000, 1500).totalCents, 0);
  assert.deepEqual(calculate(2500, 0, 0), { subtotalCents: 2500, discountCents: 0, taxableSubtotalCents: 0, stateTaxCents: 0, countySurtaxCents: 0, taxCents: 0, totalCents: 2500, combinedRateBasisPoints: 700 });
  assert.equal(calculate(10_000_000).taxCents, 700_000);
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
  const quote = sourceSlice(service, "export async function quotePosSaleTax", "async function ensurePosStripeTaxTransaction");
  assert.match(quote, /getStorefrontSettings\(currentUser\.id\)/);
  assert.match(quote, /userId: currentUser\.id/);
  assert.match(quote, /inventoryItemToDTO/);
  assert.match(quote, /posUnitPrice/);
  assert.match(quote, /createStripeTaxCalculation/);
  assert.match(quote, /verifiedStoreTaxAddress/);
  assert.match(quote, /shippingCents/);
  assert.match(quote, /stripeTaxCode/);
  assert.match(quote, /createPosTaxQuoteToken/);
  assert.match(quote, /canComplete: !misconfigured && !blockedZero/);
  assert.match(quote, /manualFallbackActive \? calculateConfiguredPosTax/);
  assert.match(quote, /Cashiers cannot select or change this mode/);
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
  assert.match(posPanel, /taxQuote\.tax/);
  assert.match(posPanel, /Calculating tax with Stripe/);
  assert.match(posPanel, /money\(quotedTotal\)/);
  const completionBody = sourceSlice(posPanel, "async function completeSale", "const adjustmentLine");
  assert.match(completionBody, /quoteId: taxQuote\.quoteId/);
  assert.doesNotMatch(completionBody, /cartTotals\.(tax|total)|taxQuote\.(tax|total)|clientTax/);
});

test("receipt is itemized, customer contact is masked, and tax/refund details stay separate", () => {
  const app = readSource("src/components/RadarApp.tsx");
  const summary = sourceSlice(app, "function maskPosReceiptEmail", "function PosPanel");
  const receipt = sourceSlice(app, "function PosReceipt", "function ProfitLossPanel");
  assert.match(summary, /maskPosReceiptEmail/);
  assert.match(summary, /maskPosReceiptPhone/);
  assert.match(summary, /receipt\.tax/);
  assert.match(summary, /receipt\.shipping/);
  assert.match(summary, /refundedTax/);
  assert.match(receipt, /gamedaygrabs-logo-horizontal\.png/);
  assert.match(receipt, /receipt\.cashierName/);
  assert.match(receipt, /receipt\.registerLabel/);
  assert.match(receipt, /receipt\.tax/);
  assert.match(receipt, /receipt\.shipping/);
  assert.match(receipt, /receipt\.refundedAmount/);
  assert.match(receipt, /receipt\.refundedTax/);
  assert.match(receipt, /Thank you for collecting with us/);
  assert.doesNotMatch(summary + receipt, /Customer account ID|internal ID/i);
});

test("receipt reconstruction exposes partial/full refund and tax reversal metadata", () => {
  const service = readSource("src/lib/radar-service.ts");
  const receipt = sourceSlice(service, "async function receiptForExistingPosSale", "function inventorySaleAvailability");
  assert.match(receipt, /const refundStatus =/);
  assert.match(receipt, /refundStatus,/);
  assert.match(receipt, /refundedAmount,/);
  assert.match(receipt, /refundedTax,/);
  assert.match(receipt, /refundedMerchandise,/);
  assert.match(receipt, /netTotal,/);
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
