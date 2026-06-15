import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  cleanStorefrontDescription,
  cleanStorefrontTitle,
  generatedStorefrontDescription,
  normalizeStorefrontCopy,
  storefrontCopyWarnings,
  storefrontSoldOutNote
} from "../src/lib/storefront-copy";

test("storefront copy cleanup fixes Pokemon encoding and missing punctuation spaces", () => {
  assert.equal(cleanStorefrontTitle("Pok?mon Trading Card Game: Mega Evolution"), "Pokémon Trading Card Game: Mega Evolution");
  assert.equal(normalizeStorefrontCopy("Great item.Ships fast.home?and ready"), "Great item. Ships fast. home and ready");
  assert.equal(
    normalizeStorefrontCopy("the city? s residents in the Pokemon TCG: Mega Evolution? Perfect Order expansion!"),
    "the city's residents in the Pokémon TCG: Mega Evolution: Perfect Order expansion!"
  );
});

test("messy public description gets a customer-facing fallback", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon Elite Trainer Box",
    category: "Elite Trainer Boxes",
    publicDescription: "undefined source cost admin tracker receipt"
  });

  assert.match(description, /sealed Pokémon TCG product/);
  assert.doesNotMatch(description, /undefined|source|cost|admin|tracker|receipt/i);
});

test("clean public description is preserved with spelling cleanup", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon Booster Bundle",
    category: "Booster Bundles",
    publicDescription: "Pokemon TCG booster bundle with sealed packs. Available while supplies last."
  });

  assert.equal(description, "Pokémon TCG booster bundle with sealed packs. Available while supplies last.");
});

test("fixable punctuation glitches are cleaned without replacing useful descriptions", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon Elite Trainer Box",
    category: "Elite Trainer Boxes",
    publicDescription:
      "The pulse of the city beats in sync with the Pokemon and people who call it home and preserving the order of it all is Mega Zygarde ex. Peaceful days are ahead for the city? s residents in the Pokemon TCG: Mega Evolution? Perfect Order expansion!"
  });

  assert.match(description, /city's residents/);
  assert.match(description, /Pokémon TCG: Mega Evolution: Perfect Order expansion/);
  assert.doesNotMatch(description, /Available from GameDayGrabs LLC, this sealed Pokémon TCG product/);
});

test("sold-out copy is customer-facing and separate from private product data", () => {
  assert.equal(storefrontSoldOutNote(), "This item is currently sold out. It remains listed for catalog reference and may return if restocked.");
  assert.doesNotMatch(generatedStorefrontDescription({ title: "Pokemon Tin", category: "Tins" }), /cost|source|admin|tracker|receipt/i);
});

test("admin listing editor exposes preview, regenerate, and risky-copy warnings", () => {
  const app = fs.readFileSync("src/components/RadarApp.tsx", "utf8");

  assert.match(app, /Preview cleaned description/);
  assert.match(app, /Regenerate description/);
  assert.match(app, /storefrontCopyWarnings/);
  assert.deepEqual(storefrontCopyWarnings("Pok?mon undefined tracker receipt").length > 0, true);
});

test("public detail copy sections are present and private terms are not rendered as guidance", () => {
  const client = fs.readFileSync("src/components/StorefrontClient.tsx", "utf8");

  for (const heading of ["Product Description", "What&apos;s included", "Product condition", "Product Details", "Shipping summary", "Checkout hold", "Product issue support"]) {
    assert.match(client, new RegExp(`<h2>${heading}</h2>`));
  }
  assert.match(client, /Shipping is calculated from product weight and package size/);
  assert.match(client, /Final shipping is shown before payment/);
  assert.match(client, /Items are held for 15 minutes once checkout starts/);
  assert.match(client, /Listings show only customer-facing availability, condition, and checkout details/);
  assert.doesNotMatch(client, /internal purchase notes|private inventory details/i);
});
