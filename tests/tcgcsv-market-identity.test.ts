import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  evaluateTcgcsvIdentityMatch,
  selectTcgcsvPriceRow,
  tcgcsvMarketPriceFromCachedProduct
} from "../src/lib/tcgcsv-market";
import type { InventoryItemDTO } from "../src/types/radar";

const benchmarkItem = {
  itemName: "Poké Ball Tin (Q4 2025)",
  setName: null,
  category: "Sealed Packs",
  upc: "196214130456",
  sku: null,
  dpci: null,
  asin: null,
  marketProviderMatchStatus: "UNMATCHED"
} satisfies Pick<InventoryItemDTO, "itemName" | "setName" | "category" | "upc" | "sku" | "dpci" | "asin" | "marketProviderMatchStatus">;

function product(overrides: Partial<Parameters<typeof evaluateTcgcsvIdentityMatch>[1]> = {}): Parameters<typeof evaluateTcgcsvIdentityMatch>[1] {
  return {
    tcgcsvProductId: "668964",
    productName: "Pokemon - Poke Ball Tin - Poke Ball (Q4 2025)",
    cleanProductName: null,
    normalizedName: "pokemon poke ball tin poke ball q4 2025 miscellaneous cards products",
    groupName: "Miscellaneous Cards & Products",
    imageUrl: "https://example.test/poke-ball-tin.png",
    productUrl: "https://www.tcgplayer.com/product/668964",
    extendedData: JSON.stringify({ upc: "196214130456" }),
    marketPrice: 29.55,
    lowPrice: 25.99,
    midPrice: 28,
    highPrice: 35,
    directLowPrice: null,
    subTypeName: "Unopened",
    lastSyncedAt: new Date("2026-07-25T00:00:00.000Z"),
    ...overrides
  };
}

test("TCGCSV identity benchmark selects exact Q4 2025 Poke Ball Tin Unopened product", () => {
  const exact = product();
  const evaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, exact);

  assert.equal(exact.tcgcsvProductId, "668964");
  assert.equal(exact.groupName, "Miscellaneous Cards & Products");
  assert.equal(exact.subTypeName, "Unopened");
  assert.equal(evaluation.statusLabel, "Exact Match");
  assert.equal(evaluation.hardRejected, false);
  assert.equal(evaluation.variant, "poke ball");
  assert.equal(evaluation.releasePeriod, "Q4 2025");
  assert.equal(tcgcsvMarketPriceFromCachedProduct(exact), 29.55);
  assert.equal(exact.lowPrice, 25.99);
});

test("TCGCSV identity benchmark rejects display, wrong release period, and wrong ball variants", () => {
  const rejected = [
    product({
      tcgcsvProductId: "display-q4-2025",
      productName: "Pokemon - Poke Ball Tin Display - Poke Ball (Q4 2025)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "poke-ball-q4-2024",
      productName: "Pokemon - Poke Ball Tin - Poke Ball (Q4 2024)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "repeat-ball-q4-2025",
      productName: "Pokemon - Poke Ball Tin - Repeat Ball (Q4 2025)",
      marketPrice: 129.13
    }),
    product({
      tcgcsvProductId: "great-ball-q4-2025",
      productName: "Pokemon - Poke Ball Tin - Great Ball (Q4 2025)",
      marketPrice: 129.13
    })
  ];

  for (const candidate of rejected) {
    const evaluation = evaluateTcgcsvIdentityMatch(benchmarkItem, candidate);
    assert.equal(evaluation.statusLabel, "No Match", candidate.productName);
    assert.equal(evaluation.hardRejected, true, candidate.productName);
  }
});

test("TCGCSV market price remains separate from low listing, mid price, and display price", () => {
  const selected = selectTcgcsvPriceRow([
    {
      productId: "668964",
      subTypeName: "Normal",
      marketPrice: 129.13,
      lowPrice: 120,
      midPrice: 125,
      highPrice: 150
    },
    {
      productId: "668964",
      subTypeName: "Unopened",
      marketPrice: 29.55,
      lowPrice: 25.99,
      midPrice: 28,
      highPrice: 35
    }
  ]);

  assert.equal(selected.subTypeName, "Unopened");
  assert.equal(selected.marketPrice, 29.55);
  assert.equal(selected.lowPrice, 25.99);
  assert.notEqual(selected.marketPrice, 129.13);

  assert.equal(
    tcgcsvMarketPriceFromCachedProduct({ marketPrice: null, lowPrice: 25.99, midPrice: 28 }),
    null,
    "low/mid prices must not become the product market estimate"
  );
});

test("manual TCGCSV locks are labeled as manually confirmed without replacing the product ID", () => {
  const locked = evaluateTcgcsvIdentityMatch({ ...benchmarkItem, marketProviderMatchStatus: "LOCKED" }, product(), {
    manuallyConfirmed: true
  });

  assert.equal(locked.statusLabel, "Manually Confirmed");
  assert.equal(locked.hardRejected, false);
  assert.equal(locked.variant, "poke ball");
  assert.equal(locked.releasePeriod, "Q4 2025");
});

test("market UI copy does not present numeric confidence or sell-now directives for TCGCSV pricing", () => {
  const source = fs.readFileSync("src/components/RadarApp.tsx", "utf8");
  assert.match(source, /TCGplayer Market Price/);
  assert.match(source, /Lowest Listing/);
  assert.match(source, /Shipping may apply/);
  assert.match(source, /Match Status/);
  assert.doesNotMatch(source, /Provider \/ Confidence/);
  assert.doesNotMatch(source, /TCGCSV Estimate/);
  assert.doesNotMatch(source, /Low Confidence Sell Now/);
});
