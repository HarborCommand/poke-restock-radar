import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { displayStorefrontCategory, STOREFRONT_CATEGORY_OPTIONS, storefrontCategoryMatches } from "../src/lib/storefront-categories";

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

test("storefront category options expose existing public categories for admin selection", () => {
  assert.deepEqual([...new Set(STOREFRONT_CATEGORY_OPTIONS)], [...STOREFRONT_CATEGORY_OPTIONS]);
  for (const category of ["Pokemon Sealed", "Booster Bundles", "Blisters", "Tins", "Premium Collections", "Accessories"]) {
    assert.equal(STOREFRONT_CATEGORY_OPTIONS.includes(category as (typeof STOREFRONT_CATEGORY_OPTIONS)[number]), true, `missing ${category}`);
  }
});

test("manually assigned specific storefront category is respected", () => {
  const product = {
    title: "Pokemon Elite Trainer Box",
    category: "Premium Collections",
    tags: []
  };

  assert.equal(displayStorefrontCategory(product), "Premium Collections");
});

test("explicit storefront category overrides stale tags and title inference for collection matching", () => {
  const blister = {
    title: "Chaos Rising Premium Checklane Blister",
    category: "Blisters",
    tags: ["Premium Collections"]
  };

  assert.equal(displayStorefrontCategory(blister), "Blisters");
  assert.equal(storefrontCategoryMatches(blister, "Blisters"), true);
  assert.equal(storefrontCategoryMatches(blister, "Premium Collections"), false);
  assert.equal(storefrontCategoryMatches(blister, "Pokemon Sealed"), true);
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

test("homepage hero product image links to the same product page as View Product", () => {
  const client = fs.readFileSync("src/components/StorefrontClient.tsx", "utf8");

  assert.match(client, /className="gdg-hero-product-link"/);
  assert.match(client, /aria-label=\{`View \$\{heroProductTitle\}`\}/);
  assert.match(client, /<Link href=\{`\/product\/\$\{heroProduct\.slug\}`\} className="gdg-hero-product-link"/);
  assert.match(client, /<Link href=\{`\/product\/\$\{heroProduct\.slug\}`\} className="gdg-secondary-button compact"/);
  assert.match(client, /gdg-hero-placeholder/);
});

test("public header includes Home before Shop and mobile nav uses the same nav map", () => {
  const client = fs.readFileSync("src/components/StorefrontClient.tsx", "utf8");

  assert.match(client, /const nav:[\s\S]*= \[\s*\{ href: homeHref, label: "Home", external: false \},\s*\{ href: "\/shop", label: "Shop", external: false \}/);
  assert.match(client, /className=\{`gdg-nav \$\{menuOpen \? "open" : ""\}`\}/);
  assert.match(client, /label: "Pokémon"/);
  assert.match(client, /nav\.push\(\{ href: accountHref, label: accountLabel, external: false, className: "gdg-mobile-account-nav" \}\)/);
});

test("homepage hero image has hover and keyboard focus affordances", () => {
  const styles = fs.readFileSync("src/app/globals.css", "utf8");

  assert.match(styles, /\.gdg-hero-product-link:hover[\s\S]*transform: translateY\(-4px\)/);
  assert.match(styles, /\.gdg-hero-product-link:focus-visible[\s\S]*outline: 3px solid #16a34a/);
  assert.match(styles, /\.gdg-hero-product-link:hover \.gdg-product-image-hero img[\s\S]*transform: scale\(1\.045\)/);
  assert.match(styles, /\.gdg-hero-view-cue/);
});
