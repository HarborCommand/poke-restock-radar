import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  calculateCartShipping,
  explainCartShippingCalculation,
  shippingRatePackageFromCalculation
} from "../src/lib/shipping";
import { applyMerchantShippingPolicyToCarrierQuote } from "../src/lib/shipping-policy";
import { shippingLabelWorkflowConfig } from "../src/lib/shipping-labels";
import { fetchShippoUspsQuote, normalizeShippoUspsQuote, shippingRateProviderConfig } from "../src/lib/shipping-rate-provider";

function shippableItem(overrides: Parameters<typeof calculateCartShipping>[0][number] = {}) {
  return {
    id: "item-1",
    title: "Test Product",
    quantity: 1,
    shippingProfile: "single_card_or_light_item",
    packageWeightOz: 4,
    packageLengthIn: 6,
    packageWidthIn: 4,
    packageHeightIn: 1,
    shippingAvailable: true,
    localPickupAvailable: true,
    freeShippingEligible: false,
    requiresBox: false,
    insuranceRecommended: false,
    ...overrides
  };
}

function defaultAmount(weightOz: number) {
  const result = calculateCartShipping([shippableItem({ packageWeightOz: weightOz })]);
  assert.ok(result.defaultShippingOption, "expected default shipping option");
  return result.defaultShippingOption.amount;
}

function shippoQuote(amountCents: number) {
  return {
    provider: "shippo" as const,
    carrier: "USPS" as const,
    service: "USPS Ground Advantage",
    amountCents,
    currency: "USD" as const,
    estimatedDays: 3,
    rateProviderRef: "rate_test",
    shipmentProviderRef: "shipment_test",
    expiresAt: new Date("2026-06-30T01:51:24.021Z"),
    fallbackUsed: false,
    warning: null
  };
}

function internalFallbackQuote(amountCents: number) {
  return {
    provider: "internal_profile" as const,
    carrier: "STANDARD" as const,
    service: "Boxed Shipping",
    amountCents,
    currency: "USD" as const,
    estimatedDays: null,
    rateProviderRef: null,
    shipmentProviderRef: null,
    expiresAt: new Date("2026-06-30T01:51:24.021Z"),
    fallbackUsed: true,
    warning: "USPS quote is temporarily unavailable. A safe standard shipping estimate is shown."
  };
}

test("smart shipping calculator includes packing weight for packages up to 8 oz", () => {
  assert.equal(defaultAmount(8), 5.99);
});

test("smart shipping calculator includes packing weight for packages up to 16 oz", () => {
  assert.equal(defaultAmount(16), 7.99);
});

test("smart shipping calculator includes packing weight for packages up to 32 oz", () => {
  assert.equal(defaultAmount(32), 9.99);
});

test("smart shipping calculator includes packing weight for packages up to 80 oz", () => {
  assert.equal(defaultAmount(80), 12.99);
});

test("smart shipping calculator flags heavy package manual review", () => {
  const result = calculateCartShipping([shippableItem({ packageWeightOz: 81, shippingProfile: "heavy_box" })]);

  assert.equal(result.defaultShippingOption?.amount, 12.99);
  assert.equal(result.defaultShippingOption?.label, "Heavy Package Shipping");
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.warnings.some((warning) => warning.includes("manual review")), true);
});

test("smart shipping calculator supports local pickup at $0", () => {
  const result = calculateCartShipping([shippableItem()], { fulfillmentMethod: "pickup" });

  assert.equal(result.defaultShippingOption?.id, "local_pickup");
  assert.equal(result.defaultShippingOption?.label, "Local Pickup");
  assert.equal(result.defaultShippingOption?.amount, 0);
  assert.equal(result.localPickupEligible, true);
});

test("smart shipping calculator only offers local pickup when every cart item is eligible", () => {
  const result = calculateCartShipping([
    shippableItem({ id: "pickup-ok", localPickupAvailable: true }),
    shippableItem({ id: "ship-only", localPickupAvailable: false })
  ]);

  assert.equal(result.localPickupEligible, false);
  assert.equal(result.shippingOptions.some((option) => option.id === "local_pickup"), false);
  assert.equal(result.shippingOptions.some((option) => option.label === "Standard Shipping"), true);
});

test("smart shipping packs every product in a multi-item cart for carrier quotes", () => {
  const cart = [
    shippableItem({
      id: "three-booster-blister",
      title: "Perfect Order 3-Booster Blister",
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 6,
      packageLengthIn: 9,
      packageWidthIn: 7,
      packageHeightIn: 1.2
    }),
    shippableItem({
      id: "premium-collection",
      title: "Mega Zygarde ex Premium Collection",
      shippingProfile: "large_box",
      packageWeightOz: 36,
      packageLengthIn: 13,
      packageWidthIn: 10,
      packageHeightIn: 3.5
    }),
    shippableItem({
      id: "booster-bundle",
      title: "Mega Evolution Perfect Order Booster Bundle",
      shippingProfile: "small_box",
      packageWeightOz: 24,
      packageLengthIn: 7,
      packageWidthIn: 5,
      packageHeightIn: 4
    })
  ];
  const result = calculateCartShipping(cart);
  const audit = explainCartShippingCalculation(cart);

  assert.equal(result.totalWeightOz, 72);
  assert.equal(result.packingWeightOz, 6);
  assert.equal(result.billableWeightOz, 72);
  assert.equal(result.packageProfile, "large_box");
  assert.equal(result.packageTierKey, "box_16x12x8");
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 8);
  assert.equal(result.defaultShippingOption?.amount, 9.99);
  assert.equal(audit.selectedPackageTier, "box_16x12x8");
  assert.equal(audit.items.find((item) => item.id === "booster-bundle")?.selectedProfile, "small_box");
  assert.equal(audit.items.find((item) => item.id === "booster-bundle")?.packageWeightOz, 24);
});

test("smart shipping quantity greater than one uses the full packed cart weight and height", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "seven-blisters",
      quantity: 7,
      shippingProfile: "sealed_pack_small",
      packageWeightOz: 6,
      packageLengthIn: 9,
      packageWidthIn: 7,
      packageHeightIn: 1
    })
  ]);

  assert.equal(result.totalWeightOz, 46);
  assert.equal(result.packingWeightOz, 4);
  assert.equal(result.packageProfile, "medium_box");
  assert.equal(result.packageTierKey, "box_14x10x6");
  assert.equal(result.packageLengthIn, 14);
  assert.equal(result.packageWidthIn, 10);
  assert.equal(result.packageHeightIn, 6);
  assert.equal(result.defaultShippingOption?.amount, 9.99);
});

test("reported five-item sealed cart applies merchant minimum when Shippo returns a low local-zone rate", () => {
  const cart = [
    shippableItem({
      id: "ascended-heroes-booster-bundle",
      title: "Pokemon TCG: Mega Evolution- Ascended Heroes Booster Bundle",
      category: "Booster Bundles",
      shippingProfile: "small_box",
      packageWeightOz: 6,
      packageLengthIn: 6,
      packageWidthIn: 4,
      packageHeightIn: 2
    }),
    shippableItem({
      id: "mega-zygarde-premium-collection",
      title: "Pokemon Trading Card Game: Mega Zygarde ex Premium Collection",
      category: "Premium Collections",
      shippingProfile: "medium_box",
      packageWeightOz: 16,
      packageLengthIn: 9,
      packageWidthIn: 15,
      packageHeightIn: 1
    }),
    shippableItem({
      id: "mega-moonlit-tin",
      title: "Pokemon TCG: Mega Moonlit Tin",
      category: "Tins",
      shippingProfile: "regular_tin",
      packageWeightOz: 10,
      packageLengthIn: 7,
      packageWidthIn: 3,
      packageHeightIn: 5
    }),
    shippableItem({
      id: "makuhita-checklane",
      title: "Pokemon Perfect Order (Makuhita) Checklane",
      category: "Blisters",
      shippingProfile: "large_box",
      packageWeightOz: 5,
      packageLengthIn: 9,
      packageWidthIn: 1,
      packageHeightIn: 7
    }),
    shippableItem({
      id: "chaos-rising-booster-bundle",
      title: "Pokemon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
      category: "Booster Bundles",
      shippingProfile: "small_box",
      packageWeightOz: 5.3,
      packageLengthIn: 6,
      packageWidthIn: 4,
      packageHeightIn: 2
    })
  ];
  const result = calculateCartShipping(cart, { subtotal: 249.97, fulfillmentMethod: "shipping" });
  const audit = explainCartShippingCalculation(cart);
  const policyResult = applyMerchantShippingPolicyToCarrierQuote(shippoQuote(570), result);

  assert.equal(audit.lineCount, 5);
  assert.equal(audit.totalUnits, 5);
  assert.deepEqual(
    audit.items.map((item) => item.id),
    [
      "ascended-heroes-booster-bundle",
      "mega-zygarde-premium-collection",
      "mega-moonlit-tin",
      "makuhita-checklane",
      "chaos-rising-booster-bundle"
    ]
  );
  assert.equal(audit.totalItemWeightOz, 42.3);
  assert.equal(audit.actualPackedWeightOz, 46.8);
  assert.equal(audit.selectedPackageTier, "box_16x12x4");
  assert.deepEqual(audit.shippoParcelPayload, {
    weightOz: 46.8,
    lengthIn: 16,
    widthIn: 12,
    heightIn: 4,
    profileKey: "medium_box"
  });
  assert.equal(result.defaultShippingOption?.amount, 9.99);
  assert.equal(result.shippingOptions.find((option) => option.id === "local_pickup")?.amount, 0);
  assert.equal(policyResult.baseAmountCents, 570);
  assert.equal(policyResult.minimumAmountCents, 999);
  assert.equal(policyResult.policyApplied, true);
  assert.equal(policyResult.quote.amountCents, 999);
  assert.equal(policyResult.quote.provider, "shippo");
  assert.equal(policyResult.quote.service, "USPS Ground Advantage");
  assert.equal(policyResult.quote.fallbackUsed, false);
});

test("merchant shipping policy leaves carrier quotes above the server minimum unchanged", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "premium-collection",
      shippingProfile: "medium_box",
      packageWeightOz: 16,
      packageLengthIn: 15,
      packageWidthIn: 9,
      packageHeightIn: 1
    })
  ]);
  const policyResult = applyMerchantShippingPolicyToCarrierQuote(shippoQuote(1299), result);

  assert.equal(policyResult.minimumAmountCents, 799);
  assert.equal(policyResult.policyApplied, false);
  assert.equal(policyResult.quote.amountCents, 1299);
});

test("merchant shipping policy does not double-adjust fallback internal quotes", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "boxed-fallback",
      shippingProfile: "medium_box",
      packageWeightOz: 16,
      packageLengthIn: 15,
      packageWidthIn: 9,
      packageHeightIn: 1
    })
  ]);
  const policyResult = applyMerchantShippingPolicyToCarrierQuote(internalFallbackQuote(570), result);

  assert.equal(policyResult.minimumAmountCents, 799);
  assert.equal(policyResult.policyApplied, false);
  assert.equal(policyResult.quote.amountCents, 570);
  assert.equal(policyResult.quote.provider, "internal_profile");
  assert.equal(policyResult.quote.fallbackUsed, true);
});

test("system profile defaults complete missing item dimensions before carrier quotes", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "ready-box",
      shippingProfile: "small_box",
      packageWeightOz: 16,
      packageLengthIn: 8,
      packageWidthIn: 6,
      packageHeightIn: 4
    }),
    shippableItem({
      id: "missing-dimensions",
      shippingProfile: "medium_box",
      packageWeightOz: 18,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.totalWeightOz, 40);
  assert.equal(result.packageTierKey, "box_16x12x8");
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 8);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), false);
});

test("missing package profile uses safe fallback and warning", () => {
  const result = calculateCartShipping([shippableItem({ shippingProfile: "standard", packageWeightOz: null })]);

  assert.equal(result.packageProfile, "small_box");
  assert.equal(result.packageProfileLabel, "Small Box");
  assert.equal(result.totalWeightOz, 18);
  assert.equal(result.packageTierKey, "box_10x8x4");
  assert.equal(result.defaultShippingOption?.amount, 7.99);
  assert.equal(result.needsShippingProfile, true);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), true);
});

test("missing package profile uses category-aware fallback for larger sealed products", () => {
  const result = calculateCartShipping([
    shippableItem({
      shippingProfile: "standard",
      category: "Premium Collections",
      title: "Mega Zygarde ex Premium Collection",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.packageProfile, "medium_box");
  assert.equal(result.packageTierKey, "box_16x12x4");
  assert.equal(result.totalWeightOz, 22.5);
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 4);
  assert.equal(result.packageCubicFeet, 0.444);
  assert.equal(result.defaultShippingOption?.amount, 7.99);
  assert.equal(result.needsShippingProfile, true);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), true);
});

test("category-aware fallback recognizes real sealed product category variations", () => {
  const cases = [
    {
      title: "Pokémon Trading Card Game: Mega Zygarde ex Premium Collection",
      category: "Premium Collections",
      expectedProfile: "medium_box"
    },
    {
      title: "Pokémon Trading Card Game: Mega Zygarde ex Premium Collection",
      category: "Premium Collection",
      expectedProfile: "medium_box"
    },
    {
      title: "Pokémon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
      category: "Blisters",
      expectedProfile: "sealed_pack_small"
    },
    {
      title: "Pokemon Trading Card Game Mega Evolution Perfect Order 3 Booster Blister",
      category: "Blister",
      expectedProfile: "sealed_pack_small"
    },
    {
      title: "Mega Evolution Perfect Order Booster Bundle",
      category: "Booster Bundles",
      expectedProfile: "small_box"
    },
    {
      title: "Mega Evolution Perfect Order Booster Bundle",
      category: "Booster Bundle",
      expectedProfile: "small_box"
    },
    {
      title: "Pokémon TCG: Mega Moonlit Tin",
      category: "Tins",
      expectedProfile: "small_box"
    },
    {
      title: "Pokemon TCG Mega Moonlit Tin",
      category: "Tin",
      expectedProfile: "small_box"
    },
    {
      title: "Pokemon TCG Elite Trainer Box",
      category: "Elite Trainer Boxes",
      expectedProfile: "medium_box"
    },
    {
      title: "Pokemon TCG ETB",
      category: "ETB",
      expectedProfile: "medium_box"
    },
    {
      title: "Pokemon TCG Collector Collection",
      category: "Collections",
      expectedProfile: "medium_box"
    },
    {
      title: "Pokemon TCG Boxed Set",
      category: "Boxed Sets",
      expectedProfile: "medium_box"
    }
  ];

  for (const entry of cases) {
    const audit = explainCartShippingCalculation([
      shippableItem({
        title: entry.title,
        category: entry.category,
        shippingProfile: "standard",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ]);
    assert.equal(audit.items[0].selectedProfile, entry.expectedProfile, `${entry.category} should map to ${entry.expectedProfile}`);
  }
});

test("category-aware fallback uses conservative packed boxes for mixed sealed carts with missing metadata", () => {
  const result = calculateCartShipping([
    shippableItem({
      id: "premium",
      title: "Pokemon Trading Card Game: Mega Zygarde ex Premium Collection",
      category: "Premium Collections",
      shippingProfile: "standard",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    }),
    shippableItem({
      id: "bundle",
      title: "Mega Evolution Perfect Order Booster Bundle",
      category: "Booster Bundles",
      shippingProfile: "standard",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    }),
    shippableItem({
      id: "tin",
      title: "Pokemon TCG: Mega Moonlit Tin",
      category: "Tins",
      shippingProfile: "standard",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    }),
    shippableItem({
      id: "blister",
      title: "Pokemon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
      category: "Blisters",
      shippingProfile: "standard",
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null
    })
  ]);

  assert.equal(result.packageProfile, "medium_box");
  assert.equal(result.packageTierKey, "box_16x12x4");
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 4);
  assert.equal(result.packageCubicFeet, 0.444);
  assert.equal(result.actualWeightOz, 44.5);
  assert.equal(result.billableWeightOz, 44.5);
  assert.equal(result.defaultShippingOption?.label, "Boxed Shipping");
  assert.equal(result.manualReviewRequired, false);
  assert.equal(result.localPickupEligible, true);
});

test("reported premium collection carts use realistic flat parcels instead of oversized dimensional boxes", () => {
  const premiumCollection = shippableItem({
    id: "premium",
    title: "Pokémon Trading Card Game: Mega Zygarde ex Premium Collection",
    category: "Premium Collections",
    shippingProfile: "standard",
    packageWeightOz: 16,
    packageLengthIn: 15,
    packageWidthIn: 9,
    packageHeightIn: 1
  });
  const blister = shippableItem({
    id: "blister",
    title: "Pokémon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
    category: "Blisters",
    shippingProfile: "standard",
    packageWeightOz: 5.3,
    packageLengthIn: 15,
    packageWidthIn: 4,
    packageHeightIn: 10
  });
  const boosterBundle = shippableItem({
    id: "bundle",
    title: "Mega Evolution Perfect Order Booster Bundle",
    category: "Booster Bundles",
    shippingProfile: "standard",
    packageWeightOz: 4.8,
    packageLengthIn: 4.6,
    packageWidthIn: 2.9,
    packageHeightIn: 2
  });

  const single = calculateCartShipping([premiumCollection]);
  const twoItem = calculateCartShipping([premiumCollection, blister]);
  const threeItem = calculateCartShipping([premiumCollection, blister, boosterBundle]);
  const threeItemAudit = explainCartShippingCalculation([premiumCollection, blister, boosterBundle]);

  for (const result of [single, twoItem, threeItem]) {
    assert.equal(result.packageTierKey, "box_16x12x4");
    assert.equal(result.packageLengthIn, 16);
    assert.equal(result.packageWidthIn, 12);
    assert.equal(result.packageHeightIn, 4);
    assert.equal(result.dimensionalWeightOz, 0);
    assert.equal(result.packageCubicFeet, 0.444);
    assert.notEqual(result.packageTierKey, "box_22x16x14");
  }

  assert.equal(single.actualWeightOz, 20.5);
  assert.equal(twoItem.actualWeightOz, 25.8);
  assert.equal(threeItem.actualWeightOz, 30.6);
  assert.deepEqual(threeItemAudit.shippoParcelPayload, {
    weightOz: 30.6,
    lengthIn: 16,
    widthIn: 12,
    heightIn: 4,
    profileKey: "medium_box"
  });
  assert.deepEqual(threeItemAudit.items.find((item) => item.id === "blister")?.packageDimensions, {
    lengthIn: 11,
    widthIn: 8,
    heightIn: 1
  });
});

test("measured product package metadata overrides category fallback dimensions", () => {
  const audit = explainCartShippingCalculation([
    shippableItem({
      id: "measured-blister",
      title: "Pokemon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
      category: "Blisters",
      shippingProfile: "standard",
      packageWeightOz: 5.3,
      packageLengthIn: 15,
      packageWidthIn: 4,
      packageHeightIn: 10,
      shippingMetadataSource: "measured"
    })
  ]);

  const item = audit.items.find((entry) => entry.id === "measured-blister");
  assert.equal(item?.shippingMetadataSource, "measured");
  assert.equal(item?.fallbackProfileUsed, false);
  assert.deepEqual(item?.packageDimensions, {
    lengthIn: 15,
    widthIn: 4,
    heightIn: 10
  });
  assert.equal(audit.cacheRelevantFields[0].shippingMetadataSource, "measured");
  assert.equal(audit.cacheRelevantFields[0].packageLengthIn, 15);
});

test("incomplete product package metadata merges safely with selected profile defaults", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        id: "estimated-blister",
        shippingProfile: "three_booster_blister",
        packageWeightOz: 12,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null,
        shippingMetadataSource: "estimated"
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );
  const audit = explainCartShippingCalculation(
    [
      shippableItem({
        id: "estimated-blister",
        shippingProfile: "three_booster_blister",
        packageWeightOz: 12,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null,
        shippingMetadataSource: "estimated"
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );

  assert.equal(result.needsShippingProfile, false);
  assert.equal(result.packageTierKey, "box_10x8x4");
  assert.equal(audit.items[0].packageWeightOz, 12);
  assert.deepEqual(audit.items[0].packageDimensions, {
    lengthIn: 9,
    widthIn: 7,
    heightIn: 1
  });
  assert.equal(audit.items[0].shippingMetadataSource, "estimated");
});

test("quote cache fingerprint changes when SKU package metadata changes", () => {
  const baseItem = shippableItem({
    id: "sku-metadata",
    shippingProfile: "small_box",
    packageWeightOz: 8,
    packageLengthIn: 6,
    packageWidthIn: 4,
    packageHeightIn: 3,
    shippingMetadataSource: "estimated"
  });
  const baseAudit = explainCartShippingCalculation([baseItem]);
  const weightChangedAudit = explainCartShippingCalculation([{ ...baseItem, packageWeightOz: 9 }]);
  const dimensionChangedAudit = explainCartShippingCalculation([{ ...baseItem, packageLengthIn: 7 }]);
  const sourceChangedAudit = explainCartShippingCalculation([{ ...baseItem, shippingMetadataSource: "measured" }]);

  assert.notDeepEqual(baseAudit.cacheRelevantFields, weightChangedAudit.cacheRelevantFields);
  assert.notDeepEqual(baseAudit.cacheRelevantFields, dimensionChangedAudit.cacheRelevantFields);
  assert.notDeepEqual(baseAudit.cacheRelevantFields, sourceChangedAudit.cacheRelevantFields);
  assert.equal(sourceChangedAudit.cacheRelevantFields[0].shippingMetadataSource, "measured");
});

test("removing items changes the shipping parcel fingerprint even when the fitted box tier is unchanged", () => {
  const premiumCollection = shippableItem({
    id: "premium",
    title: "Pokémon Trading Card Game: Mega Zygarde ex Premium Collection",
    category: "Premium Collections",
    shippingProfile: "standard",
    packageWeightOz: 16,
    packageLengthIn: 15,
    packageWidthIn: 9,
    packageHeightIn: 1
  });
  const blister = shippableItem({
    id: "blister",
    title: "Pokémon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
    category: "Blisters",
    shippingProfile: "standard",
    packageWeightOz: 5.3,
    packageLengthIn: 15,
    packageWidthIn: 4,
    packageHeightIn: 10
  });
  const boosterBundle = shippableItem({
    id: "bundle",
    title: "Mega Evolution Perfect Order Booster Bundle",
    category: "Booster Bundles",
    shippingProfile: "standard",
    packageWeightOz: 4.8,
    packageLengthIn: 4.6,
    packageWidthIn: 2.9,
    packageHeightIn: 2
  });
  const twoItemAudit = explainCartShippingCalculation([premiumCollection, blister]);
  const threeItemAudit = explainCartShippingCalculation([premiumCollection, blister, boosterBundle]);

  assert.equal(twoItemAudit.selectedPackageTier, threeItemAudit.selectedPackageTier);
  assert.notDeepEqual(twoItemAudit.shippoParcelPayload, threeItemAudit.shippoParcelPayload);
  assert.notDeepEqual(twoItemAudit.cacheRelevantFields, threeItemAudit.cacheRelevantFields);
  assert.equal(twoItemAudit.shippoParcelPayload.weightOz, 25.8);
  assert.equal(threeItemAudit.shippoParcelPayload.weightOz, 30.6);
});

test("six to seven mixed sealed products still use a boxed parcel instead of a tiny mailer", () => {
  const cart = [
    shippableItem({
      id: "premium",
      title: "Pokémon Trading Card Game: Mega Zygarde ex Premium Collection",
      category: "Premium Collections",
      shippingProfile: "standard",
      packageWeightOz: 16,
      packageLengthIn: 15,
      packageWidthIn: 9,
      packageHeightIn: 1
    }),
    shippableItem({
      id: "blister",
      title: "Pokémon Trading Card Game: Mega Evolution Perfect Order 3-Booster Blister",
      category: "Blisters",
      shippingProfile: "standard",
      packageWeightOz: 5.3,
      packageLengthIn: 15,
      packageWidthIn: 4,
      packageHeightIn: 10
    }),
    shippableItem({
      id: "bundle",
      title: "Mega Evolution Perfect Order Booster Bundle",
      category: "Booster Bundles",
      shippingProfile: "standard",
      packageWeightOz: 4.8,
      packageLengthIn: 4.6,
      packageWidthIn: 2.9,
      packageHeightIn: 2
    }),
    shippableItem({
      id: "tin",
      title: "Pokémon TCG: Mega Moonlit Tin",
      category: "Tins",
      shippingProfile: "standard",
      packageWeightOz: 10,
      packageLengthIn: 7,
      packageWidthIn: 3,
      packageHeightIn: 5
    }),
    shippableItem({
      id: "poke-ball-tin",
      title: "Poké Ball Tin (Q4 2025)",
      category: "Tins",
      shippingProfile: "standard",
      packageWeightOz: 6,
      packageLengthIn: 9,
      packageWidthIn: 1,
      packageHeightIn: 7
    }),
    shippableItem({
      id: "checklane",
      title: "Chaos Rising Premium Checklane Blister",
      category: "Blisters",
      quantity: 2,
      shippingProfile: "standard",
      packageWeightOz: 5,
      packageLengthIn: 9,
      packageWidthIn: 1,
      packageHeightIn: 7
    })
  ];
  const result = calculateCartShipping(cart);
  const audit = explainCartShippingCalculation(cart);

  assert.equal(result.packageTierKey, "box_16x12x4");
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 4);
  assert.equal(result.actualWeightOz, 56.6);
  assert.equal(result.packageCubicFeet, 0.444);
  assert.equal(result.localPickupEligible, true);
  assert.notEqual(result.packageTierKey, "padded_mailer");
  assert.equal(audit.totalUnits, 7);
  assert.equal(audit.shippoParcelPayload.weightOz, 56.6);
});

test("missing package dimensions are surfaced for calculated shipping fallback", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "dimensionless_profile",
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        dimensionless_profile: {
          label: "Dimensionless Profile",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: null,
          packageWidthIn: null,
          packageHeightIn: null
        }
      }
    }
  );

  assert.equal(result.packageLengthIn, null);
  assert.equal(result.packageWidthIn, null);
  assert.equal(result.packageHeightIn, null);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), true);
});

test("selected shipping profile defaults complete blank product package data", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "three_booster_blister",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 7);
  assert.equal(result.packageProfile, "sealed_pack_small");
  assert.equal(result.packageTierKey, "padded_mailer");
  assert.equal(result.packageLengthIn, 10);
  assert.equal(result.packageWidthIn, 8);
  assert.equal(result.packageHeightIn, 2);
  assert.equal(result.needsShippingProfile, false);
  assert.equal(result.defaultShippingOption?.amount, 4.99);
  assert.equal(result.warnings.some((warning) => warning.includes("safe package fallback")), false);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), false);
});

test("incomplete DB-backed default profiles merge with built-in package dimensions", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "medium_box",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        medium_box: {
          label: "Medium Box",
          defaultWeightOz: 32,
          rank: 4,
          requiresBox: true,
          insuranceRecommended: false,
          packageLengthIn: null,
          packageWidthIn: null,
          packageHeightIn: null
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 38);
  assert.equal(result.packageProfile, "large_box");
  assert.equal(result.packageTierKey, "box_16x12x8");
  assert.equal(result.packageLengthIn, 16);
  assert.equal(result.packageWidthIn, 12);
  assert.equal(result.packageHeightIn, 8);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), false);
});

test("product-level package data overrides selected profile defaults", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "three_booster_blister",
        packageWeightOz: 12,
        packageLengthIn: 10,
        packageWidthIn: 8,
        packageHeightIn: 2
      })
    ],
    {
      profileDefinitions: {
        three_booster_blister: {
          label: "3-Booster Blister",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: 9,
          packageWidthIn: 7,
          packageHeightIn: 1
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 15);
  assert.equal(result.packageTierKey, "box_12x9x4");
  assert.equal(result.packageLengthIn, 12);
  assert.equal(result.packageWidthIn, 9);
  assert.equal(result.packageHeightIn, 4);
  assert.equal(result.defaultShippingOption?.amount, 5.99);
});

test("Shippo quote payload uses the packed actual package instead of a small one-item parcel", async () => {
  const shippingCalculation = calculateCartShipping([
    shippableItem({
      id: "premium-collection",
      title: "Mega Zygarde ex Premium Collection",
      shippingProfile: "large_box",
      packageWeightOz: 36,
      packageLengthIn: 13,
      packageWidthIn: 10,
      packageHeightIn: 3.5
    }),
    shippableItem({
      id: "booster-bundle",
      title: "Mega Evolution Perfect Order Booster Bundle",
      shippingProfile: "small_box",
      packageWeightOz: 24,
      packageLengthIn: 7,
      packageWidthIn: 5,
      packageHeightIn: 4
    })
  ]);
  let shippoPayload = null as { parcels?: Array<Record<string, string>> } | null;
  const quote = await fetchShippoUspsQuote(
    {
      destination: { zip: "33135", country: "US" },
      package: shippingRatePackageFromCalculation(shippingCalculation)
    },
    {
      env: {
        CALCULATED_USPS_SHIPPING_ENABLED: "true",
        SHIPPING_RATE_PROVIDER: "shippo",
        SHIPPO_API_TOKEN: "secret_token_not_returned",
        SHIP_FROM_NAME: "GameDayGrabs",
        SHIP_FROM_STREET1: "123 Test St",
        SHIP_FROM_CITY: "Miami",
        SHIP_FROM_STATE: "FL",
        SHIP_FROM_ZIP: "33101",
        SHIP_FROM_COUNTRY: "US"
      },
      fetchImpl: async (_url, init) => {
        shippoPayload = JSON.parse(String(init?.body || "{}")) as { parcels?: Array<Record<string, string>> };
        return new Response(
          JSON.stringify({
            object_id: "shipment_safe_ref",
            rates: [
              {
                object_id: "ground_safe_ref",
                provider: "USPS",
                servicelevel: { name: "USPS Ground Advantage" },
                amount: "11.20",
                currency: "USD",
                estimated_days: 5
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.ok(shippoPayload?.parcels);
  const parcels = shippoPayload.parcels;
  assert.equal(parcels[0].weight, String(shippingCalculation.actualWeightOz));
  assert.equal(parcels[0].length, String(shippingCalculation.packageLengthIn));
  assert.equal(parcels[0].width, String(shippingCalculation.packageWidthIn));
  assert.equal(parcels[0].height, String(shippingCalculation.packageHeightIn));
  assert.ok(Number(parcels[0].weight) > 16);
  assert.ok(shippingCalculation.billableWeightOz >= shippingCalculation.actualWeightOz);
  assert.equal(quote?.service, "USPS Ground Advantage");
  assert.equal(quote?.amountCents, 1120);
  assert.doesNotMatch(JSON.stringify(shippoPayload), /secret_token_not_returned/);
});

test("selected profile without dimension defaults still flags missing dimensions", () => {
  const result = calculateCartShipping(
    [
      shippableItem({
        shippingProfile: "dimensionless_profile",
        packageWeightOz: null,
        packageLengthIn: null,
        packageWidthIn: null,
        packageHeightIn: null
      })
    ],
    {
      profileDefinitions: {
        dimensionless_profile: {
          label: "Dimensionless Profile",
          defaultWeightOz: 6,
          rank: 2,
          requiresBox: false,
          insuranceRecommended: false,
          packageLengthIn: null,
          packageWidthIn: null,
          packageHeightIn: null
        }
      }
    }
  );

  assert.equal(result.totalWeightOz, 6);
  assert.equal(result.needsShippingProfile, false);
  assert.equal(result.packageLengthIn, null);
  assert.equal(result.warnings.some((warning) => warning.includes("Package dimensions are missing")), true);
});

test("Shippo USPS quote normalizer prefers Ground Advantage without exposing raw provider payloads", () => {
  const quote = normalizeShippoUspsQuote(
    {
      object_id: "shippo_shipment_safe_ref",
      rates: [
        {
          object_id: "priority_rate",
          provider: "USPS",
          servicelevel: { name: "USPS Priority Mail" },
          amount: "9.99",
          currency: "USD",
          estimated_days: 3
        },
        {
          object_id: "ground_rate",
          provider: "USPS",
          servicelevel: { name: "USPS Ground Advantage" },
          amount: "6.45",
          currency: "USD",
          estimated_days: 5
        },
        {
          object_id: "ups_rate",
          provider: "UPS",
          servicelevel: { name: "UPS Ground" },
          amount: "4.00",
          currency: "USD"
        }
      ]
    },
    {
      now: new Date("2026-06-18T12:00:00.000Z"),
      env: { SHIPPING_QUOTE_TTL_MINUTES: "30" }
    }
  );

  assert.ok(quote);
  assert.equal(quote.provider, "shippo");
  assert.equal(quote.carrier, "USPS");
  assert.equal(quote.service, "USPS Ground Advantage");
  assert.equal(quote.amountCents, 645);
  assert.equal(quote.rateProviderRef, "ground_rate");
  assert.equal(quote.shipmentProviderRef, "shippo_shipment_safe_ref");
  assert.equal(quote.expiresAt.toISOString(), "2026-06-18T12:30:00.000Z");
  assert.equal("rates" in quote, false);
});

test("shipping rate provider config is feature flagged and reports configured booleans only", () => {
  const disabled = shippingRateProviderConfig({});
  assert.equal(disabled.calculatedUspsEnabled, false);
  assert.equal(disabled.provider, "shippo");
  assert.equal(disabled.shippoConfigured, false);
  assert.equal(disabled.fallbackEnabled, true);

  const configured = shippingRateProviderConfig({
    CALCULATED_USPS_SHIPPING_ENABLED: "true",
    SHIPPING_RATE_PROVIDER: "shippo",
    SHIPPO_API_TOKEN: "secret_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US",
    SHIPPING_FALLBACK_ENABLED: "false",
    SHIPPING_QUOTE_TTL_MINUTES: "999"
  });

  assert.equal(configured.calculatedUspsEnabled, true);
  assert.equal(configured.provider, "shippo");
  assert.equal(configured.shippoConfigured, true);
  assert.equal(configured.shipFromZipConfigured, true);
  assert.equal(configured.fallbackEnabled, false);
  assert.equal(configured.quoteTtlMinutes, 120);
  assert.deepEqual(
    configured.envVars.includes("SHIPPO_API_TOKEN"),
    true,
    "env var names may be reported but values must not be returned"
  );
  assert.doesNotMatch(JSON.stringify(configured), /secret_token_not_returned/);
});

test("Shippo label purchase workflow is disabled by default and reports booleans only", () => {
  const disabled = shippingLabelWorkflowConfig({});
  assert.equal(disabled.shippingLabelsEnabled, false);
  assert.equal(disabled.shippoLabelPurchaseEnabled, false);
  assert.equal(disabled.provider, "shippo");
  assert.equal(disabled.labelProviderConfigured, false);
  assert.equal(disabled.purchaseReady, false);

  const providerConfiguredButDisabled = shippingLabelWorkflowConfig({
    SHIPPO_API_TOKEN: "secret_shippo_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US"
  });
  assert.equal(providerConfiguredButDisabled.labelProviderConfigured, true);
  assert.equal(providerConfiguredButDisabled.shippoLabelPurchaseEnabled, false);
  assert.equal(providerConfiguredButDisabled.purchaseReady, false);

  const enabled = shippingLabelWorkflowConfig({
    SHIPPO_LABEL_PURCHASE_ENABLED: "true",
    SHIPPO_API_TOKEN: "secret_shippo_token_not_returned",
    SHIP_FROM_NAME: "GameDayGrabs",
    SHIP_FROM_STREET1: "123 Test St",
    SHIP_FROM_CITY: "Miami",
    SHIP_FROM_STATE: "FL",
    SHIP_FROM_ZIP: "33101",
    SHIP_FROM_COUNTRY: "US"
  });
  assert.equal(enabled.shippoLabelPurchaseEnabled, true);
  assert.equal(enabled.labelProviderConfigured, true);
  assert.equal(enabled.purchaseReady, true);
  assert.deepEqual(enabled.envVars.includes("SHIPPO_LABEL_PURCHASE_ENABLED"), true);
  assert.doesNotMatch(JSON.stringify(enabled), /secret_shippo_token_not_returned/);
});

test("shipping calculator does not depend on the old flat five dollar setting", () => {
  const source = fs.readFileSync(new URL("../src/lib/shipping.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /defaultShippingPrice/);
  assert.doesNotMatch(source, /settings\.defaultShippingPrice/);
  assert.doesNotMatch(source, /amount:\s*5(?:\.00)?(?:[,;\n])/);
  assert.doesNotMatch(source, /prisma|inventoryItem\.(update|updateMany|upsert)|inventorySale|stockReservation/i);
});

test("smart shipping schema and order snapshots are wired without raw payment details", () => {
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types/radar.ts", import.meta.url), "utf8");
  const calculator = fs.readFileSync(new URL("../src/lib/shipping.ts", import.meta.url), "utf8");
  const inventorySchema = schema.slice(schema.indexOf("model InventoryItem"), schema.indexOf("model InventoryProductImage"));
  const storefrontOrderSchema = schema.slice(schema.indexOf("model StorefrontOrder"), schema.indexOf("model Fulfillment"));
  const storefrontOrderTypes = types.slice(types.indexOf("export type StorefrontOrderDTO"), types.indexOf("export type StorefrontSummaryDTO"));

  for (const field of ["packageWeightOz", "packageLengthIn", "packageWidthIn", "packageHeightIn"]) {
    assert.match(schema, new RegExp(`${field}\\s+Float\\?`));
    assert.match(types, new RegExp(`${field}: number \\| null`));
  }

  for (const field of ["freeShippingEligible", "requiresBox", "insuranceRecommended"]) {
    assert.match(schema, new RegExp(`${field}\\s+Boolean\\s+@default\\(false\\)`));
    assert.match(types, new RegExp(`${field}: boolean`));
  }

  for (const field of ["shippingMethodLabel", "shippingRateSource", "shippingPackageWeightOz", "shippingPackageProfile", "shippingWarnings"]) {
    assert.match(schema, new RegExp(`${field}\\s+`));
    assert.match(storefront, new RegExp(`${field}:`));
  }

  for (const field of [
    "shippingQuoteId",
    "shippingQuoteProvider",
    "shippingCarrier",
    "shippingService",
    "shippingQuotedAmountCents",
    "shippingQuotedZip",
    "shippingQuoteFallbackUsed",
    "shippingZipMismatchReview"
  ]) {
    assert.match(schema, new RegExp(`${field}\\s+`));
    assert.match(types, new RegExp(`${field}:`));
  }

  assert.match(storefront, /calculateCartShipping/);
  assert.match(storefront, /shippingWarnings: stringifyList\(shippingCalculation\.warnings\)/);
  assert.match(types, /needsShippingProfile: boolean/);

  for (const source of [inventorySchema, storefrontOrderSchema, storefront, storefrontOrderTypes, calculator]) {
    assert.doesNotMatch(source, /cardNumber|card_number|cvc|cvv|payment_method_data/i);
  }
});

test("storefront checkout passes smart shipping options to Stripe instead of a flat shipping line item", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const createCheckoutSession = storefront.slice(
    storefront.indexOf("export async function createCheckoutSession"),
    storefront.indexOf("export async function createInvoiceRequest")
  );
  const sessionCreateParams = createCheckoutSession.slice(
    createCheckoutSession.indexOf("const session = await stripe.checkout.sessions.create({"),
    createCheckoutSession.indexOf("    });", createCheckoutSession.indexOf("const session = await stripe.checkout.sessions.create({"))
  );

  assert.match(storefront, /function stripeShippingOptions\(shippingCalculation: ShippingCalculation\)/);
  assert.match(createCheckoutSession, /const checkoutShippingOptions = stripeShippingOptionsForCheckout\(shippingCalculation, calculatedQuote\)/);
  assert.match(sessionCreateParams, /shipping_options: checkoutShippingOptions/);
  assert.match(sessionCreateParams, /shipping_address_collection: \{\s*allowed_countries: stripeShippingAllowedCountries\s*\}/);
  assert.doesNotMatch(sessionCreateParams, /product_data: \{ name: "Shipping" \}/);
  assert.doesNotMatch(createCheckoutSession, /\.\.\.\(shippingCharged > 0/);

  assert.match(client, /Shipping calculated at checkout/);
  assert.match(client, /Checkout notes/);
  assert.match(client, /Shipping is calculated by ZIP before payment\./);
  assert.match(client, /Items are reserved when checkout starts\./);
  assert.match(client, /Secure checkout by Stripe\. Guest checkout available\./);
  assert.match(client, /Enter ZIP code to calculate USPS shipping\./);
  assert.match(client, /\/api\/storefront\/shipping\/quote/);
  assert.match(client, /shippingQuoteToken/);
  assert.match(client, /Cart changed\. Recalculate shipping\./);
  assert.match(client, /previousQuoteResetKey/);
  assert.doesNotMatch(client, /<b>Shipping estimate<\/b>\s*\{money\(shipping\)\}/);
});

test("calculated USPS quote API and checkout enforce server-side quote safety", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8");
  const route = fs.readFileSync(new URL("../src/app/api/storefront/shipping/quote/route.ts", import.meta.url), "utf8");
  const provider = fs.readFileSync(new URL("../src/lib/shipping-rate-provider.ts", import.meta.url), "utf8");
  const policy = fs.readFileSync(new URL("../src/lib/shipping-policy.ts", import.meta.url), "utf8");
  const createQuote = storefront.slice(storefront.indexOf("export async function createStorefrontShippingQuote"), storefront.indexOf("function shippingOptionFromQuote"));
  const quoteHelper = storefront.slice(storefront.indexOf("async function quoteForCalculatedShipping"), storefront.indexOf("export async function createStorefrontShippingQuote"));
  const createCheckoutSession = storefront.slice(
    storefront.indexOf("export async function createCheckoutSession"),
    storefront.indexOf("export async function createInvoiceRequest")
  );

  assert.match(validation, /storefrontShippingQuoteSchema/);
  assert.match(validation, /destinationZip: z\.string\(\)\.trim\(\)\.regex\(\/\^\\d\{5\}\$\//);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /createStorefrontShippingQuote\(input\)/);
  assert.match(createQuote, /const cart = await getCartProducts\(input\.items, \{ profileDefinitions \}\)/);
  assert.match(createQuote, /calculateCartShipping/);
  assert.doesNotMatch(createQuote, /packageWeightOz: input|packageLengthIn: input|amountCents: input/);
  assert.match(quoteHelper, /fetchShippoUspsQuote/);
  assert.match(quoteHelper, /applyMerchantShippingPolicyToCarrierQuote\(quote, shippingCalculation\)\.quote/);
  assert.match(quoteHelper, /fallbackShippingQuote/);
  assert.match(createQuote, /fallbackShippingQuote/);
  assert.match(createQuote, /cartHash: shippingCartHash\(cart, input\.destinationZip, profileDefinitions\)/);
  assert.match(storefront, /formulaVersion: shippingFormulaVersion/);
  assert.match(storefront, /fallbackProfileVersion: shippingFallbackProfileVersion/);
  assert.match(storefront, /selectedPackageTier/);
  assert.match(storefront, /shippoParcelPayload/);
  assert.match(storefront, /destinationZip: String\(destinationZip \|\| ""\)\.replace\(\/\\D\/g, ""\)\.slice\(0, 5\)/);
  for (const field of [
    "packageWeightOz",
    "packageLengthIn",
    "packageWidthIn",
    "packageHeightIn",
    "shippingAvailable",
    "localPickupAvailable",
    "freeShippingEligible",
    "requiresBox",
    "insuranceRecommended"
  ]) {
    assert.match(storefront, new RegExp(field), `shipping cart hash should include ${field}`);
  }
  assert.match(createCheckoutSession, /if \(input\.fulfillmentMethod === "shipping" && shippingRates\.calculatedUspsEnabled\)/);
  assert.match(createCheckoutSession, /if \(!input\.shippingQuoteToken\)/);
  assert.match(createCheckoutSession, /calculatedQuote\.expiresAt\.getTime\(\) <= checkoutStartedAt\.getTime\(\)/);
  assert.match(createCheckoutSession, /calculatedQuote\.usedAt/);
  assert.match(createCheckoutSession, /calculatedQuote\.cartHash !== shippingCartHash\(cart, calculatedQuote\.destinationZip, profileDefinitions\)/);
  assert.match(createCheckoutSession, /shippingQuote\.update/);
  assert.match(provider, /authorization: `ShippoToken/);
  assert.match(policy, /merchantMinimumShippingCents/);
  assert.match(policy, /option\.id !== "local_pickup"/);
  assert.match(policy, /quote\.provider !== "shippo"/);
  assert.doesNotMatch(provider, /console\.(log|warn|error).*SHIPPO_API_TOKEN/);
});

test("paid checkout webhook persists selected Stripe Checkout shipping result", () => {
  const storefront = fs.readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
  const persistPaidCheckoutSession = storefront.slice(
    storefront.indexOf("async function persistPaidCheckoutSession"),
    storefront.indexOf("export async function handleStripeWebhook")
  );

  assert.match(storefront, /async function checkoutShippingSnapshot\(session: Stripe\.Checkout\.Session, order: StorefrontOrderWithItems\)/);
  assert.match(storefront, /shippingCost\.amount_total/);
  assert.match(storefront, /total_details\?\.amount_shipping/);
  assert.match(storefront, /stripeClient\(\)\.shippingRates\.retrieve\(shippingRate\)/);
  assert.match(persistPaidCheckoutSession, /const shippingSnapshot = await checkoutShippingSnapshot\(session, order\)/);
  assert.match(persistPaidCheckoutSession, /shippingCharged,/);
  assert.match(persistPaidCheckoutSession, /shippingMethodLabel: shippingSnapshot\.shippingMethodLabel/);
  assert.match(persistPaidCheckoutSession, /shippingRateSource: shippingSnapshot\.shippingRateSource \?\? "stripe_checkout"/);
  assert.match(persistPaidCheckoutSession, /shippingPackageWeightOz: shippingSnapshot\.shippingPackageWeightOz/);
  assert.match(persistPaidCheckoutSession, /shippingPackageLengthIn: shippingSnapshot\.shippingPackageLengthIn/);
  assert.match(persistPaidCheckoutSession, /shippingQuotedZip: shippingSnapshot\.shippingQuotedZip/);
  assert.match(persistPaidCheckoutSession, /shippingZipMismatchReview/);
  assert.match(persistPaidCheckoutSession, /shippingPackageProfile: shippingSnapshot\.shippingPackageProfile/);
  assert.match(persistPaidCheckoutSession, /shippingWarnings: stringifyList\(shippingSnapshot\.shippingWarnings\)/);
  assert.match(persistPaidCheckoutSession, /total,/);
  assert.match(persistPaidCheckoutSession, /stripeFeeEstimate: estimateStripeFee\(total\)/);
});
