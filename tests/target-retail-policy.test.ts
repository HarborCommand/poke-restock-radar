import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTargetRetailPolicy } from "../src/lib/target-retail-policy";

function policy(input: {
  title: string;
  productType?: string;
  price: number;
  sellerType?: "target" | "marketplace" | "unknown";
}) {
  return evaluateTargetRetailPolicy({
    retailerName: "Target",
    title: input.title,
    productType: input.productType ?? null,
    price: input.price,
    sellerType: input.sellerType ?? "unknown",
    confidenceScore: 96,
    exactUrl: true,
    isPokemonTcg: true
  });
}

test("Target single sleeved booster at MSRP is eligible", () => {
  const result = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Sleeved Booster Pack",
    productType: "Sleeved Booster",
    price: 4.99
  });
  assert.equal(result.alertEligibility, "eligible");
  assert.equal(result.priceStatus, "msrp");
});

test("Target single sleeved booster over MSRP is suppressed", () => {
  const result = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Sleeved Booster Pack",
    productType: "Sleeved Booster",
    price: 14.99
  });
  assert.equal(result.alertEligibility, "suppressed_over_msrp");
  assert.equal(result.priceStatus, "over_msrp");
});

test("Target four sleeved boosters allow retail multi-pack math but suppress vendor pricing", () => {
  const retail = policy({
    title: "Pokemon ME4 Mega Evolution Chaos Rising Art Set | 4 Sleeved Booster Packs (One of Each Artwork)",
    productType: "Sleeved Booster",
    price: 19.99
  });
  const overpriced = policy({
    title: "Pokemon ME4 Mega Evolution Chaos Rising Art Set | 4 Sleeved Booster Packs (One of Each Artwork)",
    productType: "Sleeved Booster",
    price: 59.99
  });
  assert.equal(retail.alertEligibility, "eligible");
  assert.equal(overpriced.alertEligibility, "suppressed_over_msrp");
});

test("Target booster bundle MSRP is eligible and high vendor price is suppressed", () => {
  const retail = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
    productType: "Booster Bundle",
    price: 29.99
  });
  const overpriced = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
    productType: "Booster Bundle",
    price: 59.99
  });
  assert.equal(retail.alertEligibility, "eligible");
  assert.equal(overpriced.alertEligibility, "suppressed_over_msrp");
});

test("Target ETBs at retail are eligible", () => {
  assert.equal(
    policy({
      title: "Pokemon TCG Mega Evolution Chaos Rising Elite Trainer Box",
      productType: "ETB",
      price: 49.99,
      sellerType: "target"
    }).alertEligibility,
    "eligible"
  );
  assert.equal(
    policy({
      title: "Pokemon TCG Mega Evolution Chaos Rising Elite Trainer Box",
      productType: "ETB",
      price: 59.99,
      sellerType: "target"
    }).alertEligibility,
    "eligible"
  );
});

test("Target marketplace seller is suppressed regardless of price", () => {
  const result = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
    productType: "Booster Bundle",
    price: 29.99,
    sellerType: "marketplace"
  });
  assert.equal(result.alertEligibility, "suppressed_marketplace");
  assert.equal(result.priceStatus, "marketplace_price");
});

test("Target unknown seller with retail price is eligible, high price suppressed", () => {
  const retail = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
    productType: "Booster Bundle",
    price: 29.99,
    sellerType: "unknown"
  });
  const high = policy({
    title: "Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
    productType: "Booster Bundle",
    price: 69.99,
    sellerType: "unknown"
  });
  assert.equal(retail.alertEligibility, "eligible");
  assert.equal(high.alertEligibility, "suppressed_over_msrp");
});
