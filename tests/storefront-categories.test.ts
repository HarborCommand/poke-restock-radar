import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { displayStorefrontCategory, storefrontCategoryMatches } from "../src/lib/storefront-categories";

test("ETB title maps to Elite Trainer Boxes and beats generic Pokemon Sealed", () => {
  const product = {
    title: "Pokemon Trading Card Game: Scarlet & Violet Elite Trainer Box",
    category: "Pokemon Sealed",
    tags: []
  };

  assert.equal(displayStorefrontCategory(product), "Elite Trainer Boxes");
  assert.equal(storefrontCategoryMatches(product, "Elite Trainer Boxes"), true);
  assert.equal(storefrontCategoryMatches(product, "Pokemon Sealed"), true);
});

test("specific sealed product titles map to specific storefront categories", () => {
  assert.equal(displayStorefrontCategory({ title: "Pokemon Booster Bundle", category: "Pokemon Sealed", tags: [] }), "Booster Bundles");
  assert.equal(displayStorefrontCategory({ title: "Pokemon Booster Box", category: "Pokemon Sealed", tags: [] }), "Booster Boxes");
  assert.equal(displayStorefrontCategory({ title: "Pokemon Premium Collection Box", category: "Pokemon Sealed", tags: [] }), "Premium Collections");
  assert.equal(displayStorefrontCategory({ title: "Pokemon Poke Ball Tin", category: "Pokemon Sealed", tags: [] }), "Tins");
  assert.equal(displayStorefrontCategory({ title: "Pokemon Three-Booster Blister", category: "Pokemon Sealed", tags: [] }), "Blisters");
});

test("manually assigned specific storefront category is respected", () => {
  const product = {
    title: "Pokemon Elite Trainer Box",
    category: "Premium Collections",
    tags: []
  };

  assert.equal(displayStorefrontCategory(product), "Premium Collections");
});

test("hero does not render the duplicate floating price card", () => {
  const client = fs.readFileSync("src/components/StorefrontClient.tsx", "utf8");
  const styles = fs.readFileSync("src/app/globals.css", "utf8");

  assert.doesNotMatch(client, /gdg-floating-card/);
  assert.doesNotMatch(styles, /\.gdg-floating-card/);
});

test("category preview cards use specific storefront matching rather than broad sealed matching", () => {
  const client = fs.readFileSync("src/components/StorefrontClient.tsx", "utf8");

  assert.match(client, /specificCategory = displayStorefrontCategory\(product\)/);
  assert.match(client, /category === "Pokemon Sealed" && specificCategory !== "Pokemon Sealed"/);
  assert.match(client, /storefrontCategoryMatches\(product, category\)/);
  assert.doesNotMatch(client, /function categoryMatches/);
});
