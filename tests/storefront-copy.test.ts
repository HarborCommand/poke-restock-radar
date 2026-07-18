import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  cleanStorefrontDescription,
  cleanStorefrontTitle,
  generatedStorefrontDescription,
  normalizeStorefrontCopy,
  soldOutCatalogHistoryDescription,
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

  assert.match(description, /Pok.*mon Elite Trainer Box is a elite trainer boxes listed by GameDayGrabs/);
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
  assert.doesNotMatch(description, /Available from GameDayGrabs LLC/);
});

test("sold-out copy is customer-facing and separate from private product data", () => {
  assert.equal(storefrontSoldOutNote(), "This item is currently sold out and is not available for checkout. It may return if restocked.");
  assert.doesNotMatch(generatedStorefrontDescription({ title: "Pokemon Tin", category: "Tins" }), /cost|source|admin|tracker|receipt/i);
});

test("fallback descriptions are factual and based only on known merchandising fields", () => {
  const description = generatedStorefrontDescription({
    title: "Pokemon Mega Evolution Booster Bundle",
    category: "Booster Bundles",
    setName: "Mega Evolution",
    condition: "New sealed",
    shippingAvailable: true,
    localPickupEligible: true,
    status: "active",
    availableQuantity: 3
  });

  assert.match(description, /listed by GameDayGrabs/);
  assert.match(description, /Condition: New sealed/);
  assert.match(description, /shipping or Local Pickup/);
  assert.doesNotMatch(description, /guaranteed|pulls|investment|appreciation|official|authorized/i);
});

test("admin labels, raw HTML, and scripts are stripped from public descriptions", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon Booster Bundle",
    category: "Booster Bundles",
    publicDescription: "Product Details Card Text: <script>alert('x')</script><p>Public description: Factory sealed booster bundle with clean customer-facing product details.</p>"
  });

  assert.equal(description, "Factory sealed booster bundle with clean customer-facing product details.");
  assert.doesNotMatch(description, /Product Details Card Text|Public description|script|alert|<p>/i);
});

test("sold-out fallback is explicit without creating urgency or checkout claims", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon Sold Out Tin",
    category: "Tins",
    status: "sold_out",
    availableQuantity: 0,
    publicDescription: ""
  });

  assert.match(description, /Currently sold out and not available for checkout/);
  assert.doesNotMatch(description, /while supplies last|hurry|limited time|scarcity/i);
});

test("sold-out risky counterfeit wording is replaced with neutral catalog history copy", () => {
  const description = cleanStorefrontDescription({
    title: "Pokemon World Championship Deck 2025",
    category: "Pokemon Sealed",
    status: "sold_out",
    publicDescription: "Choose one of four decks, each a card-for-card replica of a title contender deck."
  });

  assert.equal(description, soldOutCatalogHistoryDescription());
  assert.doesNotMatch(description, /replica|copy|fake|faux|knockoff|knock-off|clone|mirror image|unofficial|unauthorized/i);
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

  for (const heading of ["Product Description", "What&apos;s included", "Product condition", "Product Details", "Seller and authenticity", "Shipping summary", "Checkout hold", "Product issue support"]) {
    assert.match(client, new RegExp(`<h2>${heading}</h2>`));
  }
  assert.match(client, /Shipping is calculated from product weight and package size/);
  assert.match(client, /Final shipping is shown before payment/);
  assert.match(client, /Items are held for 15 minutes once checkout starts/);
  assert.match(client, /Listings show only customer-facing availability, condition, and checkout details/);
  assert.match(client, /Product names, brands, characters, and trademarks belong to their respective owners/);
  assert.doesNotMatch(client, /internal purchase notes|private inventory details/i);
});
